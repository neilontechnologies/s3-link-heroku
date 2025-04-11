const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const cors = require('cors');
const app = express();

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cors());
const bodyParser = require('body-parser');
app.use(bodyParser.json())

const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

// Use to authenticate heroku access key
app.use((req, res, next) => {
  const apiKey = process.env.API_KEY;
  const { heroku_api_key } = req.body;

  if(heroku_api_key === apiKey){
    next(); 
  } else{
    res.status(403).send('Forbidden: Invalid Heroku API Key');
  }
});

// This service is used to upload salesforce files and attachments into Amazon S3
app.post('/uploadsalesforcefile', async (req, res) => {
  try{
    // Get all headers from apex
    const {
      aws_access_key, aws_secret_key, sf_client_id, sf_client_secret,
      sf_username, sf_password, aws_file_title, sf_parent_id,
      aws_folder_key, aws_bucket_name, aws_bucket_region,
      sf_content_document_id, sf_file_size, sf_file_id, sf_content_document_link_id, sf_namespace, sf_delete_file, sf_create_log, s3_file, aws_kms_key, aws_file_meta_data, aws_session_token, sf_instance_url
    } = req.body;

    // We are sending the request immediately because we cannot wait untill the whole migration is completed. It will timeout the API request in Apex.
    res.send(`Heroku service to migrate Salesforce File has been started successfully.`);

    // Get salesforce response
    const migrateSalesforceResult = migrateSalesforce(sf_file_id, aws_access_key, aws_secret_key, aws_session_token, sf_client_id, sf_client_secret, sf_username, sf_password, aws_bucket_name, aws_bucket_region, aws_folder_key, aws_file_title, sf_file_size, sf_content_document_id, sf_parent_id, sf_content_document_link_id, sf_namespace, sf_delete_file, sf_create_log, s3_file, aws_kms_key, aws_file_meta_data, sf_instance_url);

  } catch(error){
    console.log(error);
  }
});

// This methiod is used to handle all combine methods
const migrateSalesforce = async (sfFileId, awsAccessKey, awsSecretKey, awsSessionToken, sfClientId, sfClientSecret, sfUsername, sfPassword, awsBucketName, awsBucketRegion, awsFolderKey, awsFileTitle, sfFileSize, sfContentDocumentId, sfParentId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, s3File, awsKMSKey, awsFileMetadata, sfInstanceUrl) =>{
  let accessToken;
  let instanceUrl;
  
  // Get access token of salesforce
  const tokenResponse = await getToken(sfClientId, sfClientSecret, sfUsername, sfPassword, sfInstanceUrl);

  // Check if access token and instance URL are available or not
  if(!tokenResponse.accessToken || !tokenResponse.instanceUrl){
    console.error(tokenResponse);
    return;
  } else {
    accessToken = tokenResponse.accessToken;
    instanceUrl = tokenResponse.instanceUrl
  }

  // Check required parameters
  if(sfFileSize &&  sfFileId && (awsFolderKey || sfParentId) && awsFileTitle){
    // Get salesforce file information 
    const getSalesforceFileResult = await getSalesforceFile(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog);

    // Prepare aws file key, upload to s3 result
    var uploadToS3Result;
    var awsFileKey;

    // Check if folder is created or not for uploading sf file id
    if(awsFolderKey){
      // Prepare aws file key
      awsFileKey = awsFolderKey + '/' + awsFileTitle;

      // If folder is created then upload it to Amazon S3
      uploadToS3Result = await uploadToS3(getSalesforceFileResult, awsFolderKey, awsFileTitle, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey, awsSessionToken, accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog, s3File, awsKMSKey, awsFileMetadata);
    } else {

      // If folder is not created then create folder then upload it to Amazon S3
      const { getRecordHomeFolderResult } = await getRecordHomeFolder(accessToken, instanceUrl, sfParentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog);
 
      // Check reponse
      if(getRecordHomeFolderResult.sObjects != null && getRecordHomeFolderResult.sObjects.length > 0){
        // Prepare aws folder key
        var awsFolderKey

        // Check namespace is available or not
        awsFolderKey = getRecordHomeFolderResult.sObjects[0][sfNamespace + 'Amazon_File_Key__c'];
        awsFileKey = awsFolderKey + '/' + awsFileTitle;
        uploadToS3Result = await uploadToS3(getSalesforceFileResult, awsFolderKey, awsFileTitle, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey, awsSessionToken, accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog, s3File, awsKMSKey, awsFileMetadata);
      } else{
          // Prepare failure rason with error message of API
          const failureReason = 'Your request to create S3-Folder for the record failed. ERROR: ' + getRecordHomeFolderResult.message ;

          if(sfCreateLog){
            // Create File Migration Logs
            const createFileMigrationLogResult = await createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }
      }
    }

    // Create S3-File record in Salesforce org
    if(uploadToS3Result && uploadToS3Result.$metadata.httpStatusCode === 200){
      const createS3FilesInSalesforceResult = await createS3FilesInSalesforce(accessToken, instanceUrl, awsBucketName, awsFileKey, sfFileSize, sfContentDocumentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, s3File);
    }
  } else {
    if(sfCreateLog){
      // Prepare failure rason with error message of API
      const failureReason = 'Salesforce File Id, Salesforce File Size, AWS Bucket Name, AWS Bucket Region or AWS File Path is missing.';

      // Create File Migration Logs
      const createFileMigrationLogResult = await createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
      throw new Error(failureReason);
    }
  }
}

// This method is used to get access token of Salesforce org and instance url of the org
const getToken = (sfClientId, sfClientSecret, sfUsername, sfPassword, sfInstanceUrl) => {
    return new Promise((resolve, reject) => {
      const postData = `grant_type=password&client_id=${sfClientId}&client_secret=${sfClientSecret}&username=${sfUsername}&password=${sfPassword}`;
      const xhr = new XMLHttpRequest();
  
      xhr.open('POST', sfInstanceUrl + '/services/oauth2/token', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  
      xhr.onload = function(){
        if(xhr.readyState === 4){
          const response = JSON.parse(xhr.responseText);
          if(xhr.status === 200){
            resolve({
              accessToken: response.access_token,
              instanceUrl: response.instance_url
            });
          } else {
            reject(new Error('We are not able to get the Salesforce Authentication Token. This happens if the Salesforce Client Id, Client Secret, User Name, Password or Security Token is invalid. ERROR: ' + response.error_description));
          }
        }
      };
  
      xhr.onerror = function(e){
        reject(new Error('We are not able to get the Salesforce Authentication Token. This happens if the Salesforce Client Id, Client Secret, User Name, Password or Security Token is invalid. ERROR: ' + e.message));
      };
  
      xhr.send(postData);
    });
};

// This method is used to get salesforce file information with the help of access token of that org, URL, provided salesforce file id  
const getSalesforceFile = async (accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog) => {
  var url;
  // Prepare url of attachments or content document
  if(sfFileId.startsWith('00P')){
    url = `${instanceUrl}/services/data/v58.0/sobjects/Attachment/${sfFileId}/Body`;
  } else {
    url = `${instanceUrl}/services/data/v58.0/sobjects/ContentVersion/${sfFileId}/VersionData`;
  }
  
  // To authenticate salesforce
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    // Returns the response status code
    if(!response.ok){
      throw new Error(`We are not able to fetch the Salesforce File Content. ERROR: ${response.statusText}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  } catch(error){
    // Create File Migration Logs
    if(sfCreateLog){
      const createFileMigrationLogResult = await createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, error.message, sfNamespace);
      console.error(error);
      throw error;
    }
  }
};

// This method is used to upload Salesforce file into Amazon S3 with the help of provided AWS data
const uploadToS3 = async (buffer, folderPath, fileTitle, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey, awsSessionToken, accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog, s3File, awsKMSKey, awsFileMetadata) => {
  try {
	
	// Check S3-File
	if(!s3File){
      s3File = {};
    }
	
	// Prepare file path
    var key = folderPath + '/' + fileTitle;

    // Define the parameters for the PutObjectCommand
    const commandParams = {
      Bucket: awsBucketName,
      Key: key,
      Body: buffer,
      ACL: s3File[sfNamespace + 'Public_On_Amazon__c'] ? 'public-read' : 'private',
      ServerSideEncryption: awsKMSKey != null ? 'aws:kms' : 'AES256'
    };

    // Conditionally add StorageClass if it has a valid value
    const storageClass = s3File[sfNamespace + 'Storage_Class__c'];
    if (storageClass) {
        commandParams.StorageClass = storageClass;
    }

    // Conditionally add ContentType if it has a valid value
    const contentType = s3File[sfNamespace + 'Content_Type__c'];
    if (contentType) {
        commandParams.ContentType = contentType;
    }

    // Conditionally add Metadata if it has a valid value
    if (awsFileMetadata) {
      commandParams.Metadata = awsFileMetadata;
    }

    // Conditionally add KMS key if ServerSideEncryption is set to 'aws:kms'
    if (awsKMSKey) {
      commandParams.SSEKMSKeyId = awsKMSKey;
    }

    // Put aws data
    const command = new PutObjectCommand(commandParams);

    // Create client credentails
    const s3Client = new S3Client({
      region: awsBucketRegion,
      credentials: {
          accessKeyId: awsAccessKey,
          secretAccessKey: awsSecretKey,
          sessionToken: awsSessionToken
      }
    });

    // Uploading file in Amazon S3
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    // Prepare failure rason with error message of API
    const failureReason = 'Your request to upload file in Amazon S3 has failed. ERROR: '+ error.message;

    // Check sf create log is true or not
    if(sfCreateLog){
      // Create File Migration Logs
      const createFileMigrationLogResult = await createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
      console.error(failureReason);
      throw error.message; 
    }
  }
};

// This method used to create record home folder for parent id
const getRecordHomeFolder = (accessToken, instanceUrl, sfParentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfCreateLog) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let url;

    // Check namespace is available or not
    if(sfNamespace){
      url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/recordfolder/${sfParentId}`;
    } else{
      url = `${instanceUrl}/services/apexrest/S3Link/v1/recordfolder/${sfParentId}`;
    }

    xhr.open('GET', url, true); 
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');  

    xhr.onload = function() {
      if (xhr.readyState === 4) {
        const response = JSON.parse(xhr.responseText);
        console.log(response);
        if (xhr.status === 200) {
          resolve({
            getRecordHomeFolderResult: response
          });  // Resolve the Promise on success
        }  else {
          // Prepare failure rason with error message of API
          const failureReason = 'Your request to create S3-Folder for the record failed. ERROR: ' + response[0].message;

          if(sfCreateLog){
            // Create File Migration Logs
            const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }
          reject(new Error(failureReason));
        }
      }
    };

    xhr.onerror = function(e) {
      // Prepare failure rason with error message of API
      const failureReason = 'Your request to create S3-Folder for the record failed. ERROR: ' + e;

      // Check sf create log is true or false
      if(sfCreateLog){
        // Create File Migration Logs
        const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
      }

      // Handle network error
      reject(new Error(failureReason));
    };
    xhr.send();
  });
};

// This method used to create S3-Files record in salesforce
const createS3FilesInSalesforce = async (accessToken, instanceUrl, awsBucketName, awsFileKey, sfFileSize, sfContentDocumentId, sfFileId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, s3File) => {
  return new Promise((resolve, reject) => {
    let url;
    const xhr = new XMLHttpRequest();

    // Check namespace is available or not
    if(sfNamespace != ''){
      url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/creates3files/`;
    } else {
      url = `${instanceUrl}/services/apexrest/S3Link/v1/creates3files/`;
    }
    
    var body = [];

    // Check s3 file is availbe or not
    if(!s3File){
      s3File = {};
    }

    s3File[sfNamespace + 'Bucket_Name__c'] = awsBucketName;
    s3File[sfNamespace + 'Amazon_File_Key__c'] = awsFileKey;
    s3File[sfNamespace + 'Size__c'] = sfFileSize;
    s3File[sfNamespace + 'Content_Document_Id__c'] = sfContentDocumentId;
    s3File[sfNamespace + 'Export_Attachment_Id__c'] = sfFileId;
    body.push(s3File);

    // Open the request
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    if(sfDeleteFile){
      xhr.setRequestHeader('delete-salesforce-file', 'true');
    }

    // Handle the response
    xhr.onload = function() {
      if (xhr.readyState === 4) {  
        const response = JSON.parse(xhr.responseText);
        console.log(response);
        if (xhr.status === 200) {
          if(response.sObjects && response.sObjects.length > 0 && !response.sObjects[0].Id){
            // Prepare failure rason with error message of API
            const failureReason = 'Your request to create S3-Files in Salesforce failed. ERROR: ' + response.sObjects[0][sfNamespace + 'Description__c'];

            // Check sf create log is true or false
            if(sfCreateLog){
              // Create File Migration Logs
              const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
            }
          } else{
            resolve(response);
          }
        } else {
          // Prepare failure rason with error message of API
          const failureReason = 'Your request to create S3-Files in Salesforce failed. ERROR: ' + response[0].message;
          
          // Check sf create log is true or false
          if(sfCreateLog){
            // Create File Migration Logs
            const createFileMigrationLogResult =  createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
          }

          reject(new Error(failureReason));
        }
      }
    };

    // Handle network errors
    xhr.onerror = function(e) {
      // Prepare failure rason with error message of API
      const failureReason = 'Your request to create S3-Files in Salesforce failed. ERROR: ' + e;

      // Check sf create log is true or false
      if(sfCreateLog){
        // Create File Migration Logs
        const createFileMigrationLogResult = createFileMigrationLog(accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace);
      }
      reject(new Error(failureReason));
    };

    // Send the request with the JSON body
    xhr.send(JSON.stringify(body));
  });
};

// This method used to create Salesforce File Migration Log record in salesforce
const createFileMigrationLog = (accessToken, instanceUrl, sfFileId, sfContentDocumentLinkId, failureReason, sfNamespace) => {
  return new Promise((resolve, reject) => {
    let url;
    const xhr = new XMLHttpRequest();
    if(sfNamespace != ''){
      url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/createmigrationlog/`;
    } else {
      url = `${instanceUrl}/services/apexrest/S3Link/v1/createmigrationlog/`;
    }
    
    // Open the request
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    // Create body
    const body = {}

    // Check file type is attachment or content document link
    if (sfFileId.startsWith('00P')) {
        body.SalesforceFileId = sfFileId;
    } else {
        body.SalesforceFileId = sfContentDocumentLinkId;
    }
    body.FailureReason = failureReason;

    // Handle the response
    xhr.onload = function() {
      if (xhr.readyState === 4) {  
        const response = JSON.parse(xhr.responseText);
        console.log(response);
        if (xhr.status === 200) {
          resolve(response);
        } else {
          reject(new Error('Your request to create Salesforce Files Migration log in Salesforce failed. ERROR: ' + xhr.statusText));
        }
      }
    };

    // Handle network errors
    xhr.onerror = function(e) {
      reject(new Error('Your request to create Salesforce Files Migration log in Salesforce failed. ERROR: ' + e));
    };

    // Send the request with the JSON body
    xhr.send(JSON.stringify(body));
  });
};

// This service is used to upload salesforce files and attachments into Amazon S3 from local host
app.get('/', async (req, res) => {
    try {
      // Replace these values with your own Salesforce Connected App credentials

      const sfFileId = '{SALESFORCE_CONTENT_VERSION_ID}'; 
      const awsAccessKey = '{AWS_ACCESS_KEY}';
      const awsSecretKey = '{AWS_SECRET_KEY}';
      const sfClientId = '{SALESFORCE_CLIENT_ID}';
      const sfClientSecret = '{SALESFORCE_CLIENT_SECRET_KEY}';
      const sfUsername = '{SALESFORCE_USERNAME}';
      const sfPassword = '{SALESFORCE_PASSWORD}';
      const awsBucketName = '{AWS_BUCKET_NAME}';
      const awsBucketRegion = '{AWS_BUCKET_REGION}';
      const sfFileSize = '{SALESFORCE_FILE_SIZE}';
      const sfContentDocumentId = '{SALESFORCE_CONTENT_DOCUMENT_ID}';
      const awsFolderKey = '{AWS_FOLDER_KEY}';
      const awsFileTitle = '{AWS_FILE_TITLE}';
      const sfParentId = '{SALESFORCE_PARENT_ID}';
      const sfContentDocumentLinkId = '{SALESFORCE_CONTENT_DOCUMENT_LINK_ID}';
      const sfNamespace = '{SALESFORCE_NAMESPACE}';
      const sfDeleteFile = '{SALESFORCE_DELETE_FILE}';
      const sfCreateLog = '{SALESFORCE_CREATE_LOG}';
      const s3File = '{S3_FILE}';
      const awsKMSKey = '{AWS_KMS_KEY}';
      const awsFileMetadata = '{AWS_FILE_METADATA}';
      const awsSessionToken = '{AWS_SESSION_TOKEN}';
	  const sfInstanceUrl = '{SALESFORCE_INSTANCE_URL}';

      // We are sending the request immediately because we cannot wait untill the whole migration is completed. It will timeout the API request in Apex.
      res.send(`Heroku service to migrate Salesforce File has been started successfully.`);
      
      const reponse = await migrateSalesforce (sfFileId, awsAccessKey, awsSecretKey, awsSessionToken, sfClientId, sfClientSecret, sfUsername, sfPassword, awsBucketName, awsBucketRegion, awsFolderKey, awsFileTitle, sfFileSize, sfContentDocumentId, sfParentId, sfContentDocumentLinkId, sfNamespace, sfDeleteFile, sfCreateLog, s3File, awsKMSKey, awsFileMetadata, sfInstanceUrl);
    } catch (error) {
      console.error(error);
    }
});

const port = process.env.PORT || 3008;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
