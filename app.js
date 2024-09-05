const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const cors = require('cors');
const app = express();

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cors());

const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

// Use to authenticate heroku access key
app.use((req, res, next) => {
  const apiKey = process.env.API_KEY;
  const providedAccessKey = req.headers['heroku-api-key'];

  if(providedAccessKey === apiKey){
    next(); 
  } else{
    res.status(403).send('Forbidden: Invalid Heroku API Key');
  }
});

// This service is used to upload salesforce files and attachments into Amazon S3
app.get('/uploadsalesforcefile', async (req, res) => {
  try{
    const sfFileId = req.headers['sf-file-id']; 
    const awsAccessKey = req.headers['aws-access-key'];
    const awsSecretKey = req.headers['aws-secret-key'];
    const sfClientId = req.headers['sf-client-id'];
    const sfClientSecret = req.headers['sf-client-secret'];
    const sfUsername = req.headers['sf-username'];
    const sfPassword = req.headers['sf-password'];
    const awsBucketName = req.headers['aws-bucket-name'];
    const awsBucketRegion = req.headers['aws-bucket-region'];
    const awsFileKey = req.headers['aws-file-key'];// awsFolderKey, awsFitleTitle
    const sfFileSize = parseInt(req.headers['sf-file-size'], 10)
    const sfContentDocumentId = req.headers['sf-content-document-id']; // 
    // const awsFolderKey 
    // const awsFitleTitle

    res.send(`Heroku service to migrate Salesforce File has been started successfully. `);
    // TODO migrateSalesforce
    const reponse = generateResponse(sfFileId, awsAccessKey, awsSecretKey, sfClientId, sfClientSecret, sfUsername, sfPassword, awsBucketName, awsBucketRegion, awsFileKey, awsFitleTitle, sfFileSize, sfContentDocumentId);

  } catch(error){
    // Send failure email 
    console.log(error);
    // res.status(500).send(`Error: ${error || 'An unexpected error occurred.'}`);
  }
});

// This methiod is used to handle all combine methods
const generateResponse = async (sfFileId, awsAccessKey, awsSecretKey, sfClientId, sfClientSecret, sfUsername, sfPassword, awsBucketName, awsBucketRegion, awsFolderKey, awsFitleTitle, sfFileSize, sfContentDocumentId) =>{
      
  // Check required parameters
  if(sfFileSize &&  sfFileId && awsBucketName && awsBucketRegion && awsFitleTitle){

    // Get access token of salesforce
    const { accessToken, instanceUrl } = await getToken(sfClientId, sfClientSecret, sfUsername, sfPassword);
    
    // Get salesforce file information 
    const salesforceFileContent = await getSalesforceFile(accessToken, instanceUrl, sfFileId);

    // Upload salesforce file into Amazon S3

    // check awsFolderKey availbale or not 
    // TODO create new API for folder to get folder path
    var awsFileKey = awsFolderKey + '/' + awsFitleTitle;
    const uploadResult = await uploadToS3(salesforceFileContent, awsFolderKey, awsFitleTitle, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey);

    // Create S3-File record in Salesforce org
    if(uploadResult.$metadata.httpStatusCode === 200){
      // TODO create method
      const xhr = new XMLHttpRequest();
      const url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/creates3files/`// recordHome
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.setRequestHeader('Content-Type', 'application/json');

      // Prepare S3-File data
      const body = [
        {
          "NEILON__Bucket_Name__c": awsBucketName,
          "NEILON__Amazon_File_Key__c": awsFileKey,
          "NEILON__Size__c": sfFileSize,
          "NEILON__Content_Document_Id__c": sfContentDocumentId, 
          "NEILON__Export_Attachment_Id__c": sfFileId
        }
      ];

      xhr.onload = function(){
        if(xhr.readyState === 4 && xhr.status === 200){
          const response = JSON.parse(xhr.responseText);
        } else {
          // Send failure email
          console.log('ERROR:'+xhr.status+xhr.statusText);
        }
      };

      xhr.onerror = function(e){
        // Send failure email
        console.error('Your request to create S3-Files in Salesforce failed. Error: ', e);
      };

      xhr.send(JSON.stringify(body));
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

// This service is used to upload salesforce files and attachments into Amazon S3 from local host
app.get('/', async (req, res) => {
    try {
      // Replace these values with your own Salesforce Connected App credentials
      const sfFileId = '068GB00000oZ3ADYA0'; 
      const awsAccessKey = 'AKIA3HJD3T3REEHJPVAU';
      const awsSecretKey = 'zjUBWEmN49TGhVempmKq0ksK9JhkC08/Gipw+0gt';
      const sfClientId = '3MVG94Jqh209Cp4Sg3eoGq6oVTedfg_fgyjYgP_EZSZ2S5FbZF83M9O5hpQIcPaxUM.QfAvRMFcqsloah6N64';
      const sfClientSecret = '31A129DE199480F96179017876FE4A92F8907309C2F556CAE530C2CA27966950';
      const sfUsername = 'dev2@neilon.com';
      const sfPassword = 'welcom12!53PcZzDygiBq4vKp5WtSK8mAD';
      const awsBucketName = 'neilon-dev2';
      const awsBucketRegion = 'ap-south-1';
      const awsFileKey = 'Accounts/Burlington Textiles Corp of America/Appex String.png'; 
      const sfFileSize = 178893;
      const sfContentDocumentId = '06AGB000018by5X2AQ';
      const awsFolderKey = "Accounts/Burlington Textiles Corp of America"
      const awsFitleTitle = "Appex String.png"

      res.send(`Heroku service to migrate Salesforce File has been started successfully.`);
      const reponse = await generateResponse (sfFileId, awsAccessKey, awsSecretKey, sfClientId, sfClientSecret, sfUsername, sfPassword, awsBucketName, awsBucketRegion, awsFolderKey, awsFitleTitle, sfFileSize, sfContentDocumentId);

    } catch (error) {
      console.error(error);
    }
});

const port = process.env.PORT || 3008;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
