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
    const {
      aws_access_key, aws_secret_key, sf_client_id, sf_client_secret,
      sf_username, sf_password, aws_file_title, sf_parent_id,
      aws_folder_key, aws_bucket_name, aws_bucket_region,
      sf_content_document_id, sf_file_size, sf_file_id
    } = req.body; 

    // We are sending the request immediately because we cannot wait untill the whole migration is completed. It will timeout the API request in Apex.
    res.send(`Heroku service to migrate Salesforce File has been started successfully.`);

    // Get salesforce response
    const migrateSalesforceResult = migrateSalesforce(sf_file_id, aws_access_key, aws_secret_key, sf_client_id, sf_client_secret, sf_username, sf_password, aws_bucket_name, aws_bucket_region, aws_folder_key, aws_file_title, sf_file_size, sf_content_document_id, sf_parent_id);

  } catch(error){
    // Send failure email 
    console.log(error);
  }
});

// This methiod is used to handle all combine methods
const migrateSalesforce = async (sfFileId, awsAccessKey, awsSecretKey, sfClientId, sfClientSecret, sfUsername, sfPassword, awsBucketName, awsBucketRegion, awsFolderKey, awsFileTitle, sfFileSize, sfContentDocumentId, sfParentId) =>{
      
  // Check required parameters
  if(sfFileSize &&  sfFileId && sfParentId && awsFileTitle){

    // Get access token of salesforce
    const { accessToken, instanceUrl } = await getToken(sfClientId, sfClientSecret, sfUsername, sfPassword);
    
    // Get salesforce file information 
    const getSalesforceFileResult = await getSalesforceFile(accessToken, instanceUrl, sfFileId);

    // Prepare aws file key, upload to s3 result
    var uploadToS3Result;
    var awsFileKey;

    // Check if folder is created or not for uploading sf file id
    if(awsFolderKey){
      // Prepare aws file key
      awsFileKey = awsFolderKey + '/' + awsFileTitle;

      // If folder is created then upload it to Amazon S3
      uploadToS3Result = await uploadToS3(getSalesforceFileResult, awsFolderKey, awsFileTitle, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey);
    } else {

      // If folder is not created then create folder then upload it to Amazon S3
      const { getRecordHomeFolderResult } = await getRecordHomeFolder(accessToken, instanceUrl, sfParentId);
 
      // Check reponse
      if(getRecordHomeFolderResult.sObjects != null && getRecordHomeFolderResult.sObjects.length > 0){
        // Prepare aws folder key
        var awsFolderKey = getRecordHomeFolderResult.sObjects[0].NEILON__Amazon_File_Key__c;
        awsFileKey = awsFolderKey + '/' + awsFileTitle;
        uploadToS3Result = await uploadToS3(getSalesforceFileResult, awsFolderKey, awsFileTitle, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey);
      }
    }

    // Create S3-File record in Salesforce org
    if(uploadToS3Result.$metadata.httpStatusCode === 200){
      const createS3FilesInSalesforceResult = await createS3FilesInSalesforce(accessToken, instanceUrl, awsBucketName, awsFileKey, sfFileSize, sfContentDocumentId, sfFileId);
    }
  } else {
    throw new Error(`Salesforce File Id, Salesforce File Size, AWS Bucket Name, AWS Bucket Region or AWS File Path is missing.`);
  }
}

// This method is used to get access token of Salesforce org and instance url of the org
const getToken = (sfClientId, sfClientSecret, sfUsername, sfPassword) => {
    return new Promise((resolve, reject) => {
      const postData = `grant_type=password&client_id=${sfClientId}&client_secret=${sfClientSecret}&username=${sfUsername}&password=${sfPassword}`;
      const xhr = new XMLHttpRequest();
  
      xhr.open('POST', 'https://login.salesforce.com/services/oauth2/token', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  
      xhr.onload = function(){
        if(xhr.readyState === 4){
          if(xhr.status === 200){
            const response = JSON.parse(xhr.responseText);
            resolve({
              accessToken: response.access_token,
              instanceUrl: response.instance_url
            });
          } else {
            reject(new Error('We are not able to get the Salesforce Authentication Token. This happens if the Salesforce Client Id, Client Secret, User Name, Password or Security Token is invalid.'));
          }
        }
      };
  
      xhr.onerror = function(e){
        reject(new Error(`Your request to get Salesforce Authentication Token failed. This happens if the Salesforce Client Id, Client Secret, User Name, Password or Security Token is invalid. : ${e.message}`));
      };
  
      xhr.send(postData);
    });
};

// This method is used to get salesforce file information with the help of access token of that org, URL, provided salesforce file id  
const getSalesforceFile = async (accessToken, instanceUrl, sfFileId) => {
  
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
      throw new Error(`We are not able to fetch the Salesforce File Content. Error: ${response.statusText}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  } catch(error){
    console.error('We are not able to fetch the Salesforce File Content. Error: ', error);
    throw error;
  }
};

// This method is used to upload Salesforce file into Amazon S3 with the help of provided AWS data
const uploadToS3 = async (buffer, folderPath, fileTitle, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey) => {
  try {

    var key = folderPath + '/' + fileTitle;
    // Prepare AWS data
    const command = new PutObjectCommand({
        Bucket: awsBucketName,
        Key: key,
        Body: buffer,
    });

    // Create client credentails
    const s3Client = new S3Client({
      region: awsBucketRegion,
      credentials: {
          accessKeyId: awsAccessKey,
          secretAccessKey: awsSecretKey
      }
    });

    // Uploading file in Amazon S3
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    console.error('Your request to upload file in Amazon S3 has failed. Error: ', error.message);
    throw error.message; 
  }
};

// This method used to create record home folder for parent id
const getRecordHomeFolder = (accessToken, instanceUrl, sfParentId) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/recordfolder/${sfParentId}`;

    xhr.open('GET', url, true); 
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');  

    xhr.onload = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          const getRecordHomeFolderResult = JSON.parse(xhr.responseText);
          resolve({
            getRecordHomeFolderResult: getRecordHomeFolderResult,
          });  // Resolve the Promise on success
        }  else {
          reject(new Error(`ERROR: ${xhr.status} - ${xhr.statusText}`));  // Reject on error
        }
      }
    };

    xhr.onerror = function(e) {
      // Handle network error
      reject(new Error(`Your request to create S3-Folder for the record failed. Error: ${e}`));
    };

    xhr.send();  // Send the request
  });
};

// This method used to create S3-Files record in salesforce
const createS3FilesInSalesforce = (accessToken, instanceUrl, awsBucketName, awsFileKey, sfFileSize, sfContentDocumentId, sfFileId) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/creates3files/`;

    // Open the request
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    // Prepare the request body with S3-File data
    const body = [
      {
        "NEILON__Bucket_Name__c": awsBucketName,
        "NEILON__Amazon_File_Key__c": awsFileKey,
        "NEILON__Size__c": sfFileSize,
        "NEILON__Content_Document_Id__c": sfContentDocumentId, 
        "NEILON__Export_Attachment_Id__c": sfFileId
      }
    ];

    // Handle the response
    xhr.onload = function() {
      if (xhr.readyState === 4) {  
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          resolve(response);  // Resolve the promise on success
        } else {
          reject(new Error(`ERROR: ${xhr.status} - ${xhr.statusText}`));  // Reject on error
        }
      }
    };

    // Handle network errors
    xhr.onerror = function(e) {
      reject(new Error('Your request to create S3-Files in Salesforce failed. Error: ' + e));
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

      // We are sending the request immediately because we cannot wait untill the whole migration is completed. It will timeout the API request in Apex.
      res.send(`Heroku service to migrate Salesforce File has been started successfully.`);
      
      const reponse = await migrateSalesforce (sfFileId, awsAccessKey, awsSecretKey, sfClientId, sfClientSecret, sfUsername, sfPassword, awsBucketName, awsBucketRegion, awsFolderKey, awsFileTitle, sfFileSize, sfContentDocumentId, sfParentId);

    } catch (error) {
      console.error(error);
    }
});

const port = process.env.PORT || 3008;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

