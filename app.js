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

  if (providedAccessKey === apiKey) {
    next(); 
  } else {
    res.status(403).send('Forbidden: Invalid Heroku API Key');
  }
});

// This service is used to upload salesforce files and attachments into Amazon S3
app.get('/uploadFiles', async (req, res) => {
  try {
    const sfFileId = req.headers['sf-file-id']; 
    const awsAccessKey = req.headers['aws-access-key'];
    const awsSecretKey = req.headers['aws-secret-key'];
    const sfClientId = req.headers['sf-client-id'];
    const sfClientSecret = req.headers['sf-client-secret'];
    const sfUsername = req.headers['sf-username'];
    const sfPassword = req.headers['sf-password'];
    const awsBucketName = req.headers['aws-bucket-name'];
    const awsBucketRegion = req.headers['aws-bucket-region'];
    const awsFileKey = req.headers['aws-file-key'];
    const sfFileSize = parseInt(req.headers['sf-file-size'], 10)
    const sfContentDocumentId = req.headers['sf-content-document-id']; 

    // Check required parameters
    if(sfFileSize &&  sfFileId && awsBucketName && awsBucketRegion && awsFileKey){// TODO 

      // TODO Reponse send
      res.send(`Heroku service to migrate Salesforce File has been started successfully.`);

      // Get access token of salesforce
      const { accessToken, instanceUrl } = await getToken(sfClientId, sfClientSecret, sfUsername, sfPassword);

      // Get salesforce file information 
      const salesforceFileContent = await getSalesforceFile(accessToken, instanceUrl, sfFileId);// TODO , 

      // Upload salesforce file into Amazon S3
      const uploadResult = await uploadToS3(salesforceFileContent, awsFileKey, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey);

      // Create S3-File record in Salesforce org
      if(uploadResult.$metadata.httpStatusCode === 200){
        const xhr = new XMLHttpRequest();
        const url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/creates3files/`
        xhr.open('POST', url, true);// TODO msg 
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
            console.log('ERROR:', xhr.status, xhr.statusText); // TODO ERROR+xhr.status+xhr.statusText
          }
        };
  
        xhr.onerror = function(e){
          // Send failure email
          console.error('Request failed:', e);// TODO add msg
        };
  
        xhr.send(JSON.stringify(body));
      }
    } else {
      throw new Error(`Incorrect salesforce or AWS data:`);// TODO
    }
  } catch (error) {
    // Send failure email 
    console.log('---'+error);
    res.status(500).send(`Error: ${error || 'An unexpected error occurred.'}`);// TODO CONSOLE loG
  }
});


// This method is used to get access token of Salesforce org and instance url of the org
const getToken = (sfClientId, sfClientSecret, sfUsername, sfPassword) => {
    return new Promise((resolve, reject) => {
      const postData = `grant_type=password&client_id=${sfClientId}&client_secret=${sfClientSecret}&username=${sfUsername}&password=${sfPassword}`;
      const xhr = new XMLHttpRequest();
      const url = 'https://login.salesforce.com/services/oauth2/token';
  
      xhr.open('POST', url, true);// TODO url
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  
      xhr.onreadystatechange = function(){// TODO onload
        if(xhr.readyState === 4){
          if(xhr.status === 200){
            const response = JSON.parse(xhr.responseText);
            resolve({
              accessToken: response.access_token,
              instanceUrl: response.instance_url
            });
          } else {
            reject(new Error('Failed to get access token'));// Todo msg
          }
        }
      };
  
      xhr.onerror = function(e){
        reject(new Error(`Problem with request: ${e.message}`));// Todo msg
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
      throw new Error(`Failed to fetch ContentVersion data: ${response.statusText}`); // TODO msg
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  } catch(error){
    console.error('Error fetching ContentVersion data:', error); // TODO msg
    throw error;
  }
};

// This method is used to upload Salesforce file into Amazon S3 with the help of provided AWS data
const uploadToS3 = async (buffer, key, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey) => {
  try {

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
    console.error('Error uploading to S3:', error.message); // TODO
    throw error.message; 
  }
};

app.get('/', async (req, res) => {
    try {
      // Replace these values with your own Salesforce Connected App credentials
      const client_id = '3MVG94Jqh209Cp4Sg3eoGq6oVTXS4yYiy8RI5iwedUxsx0ZoBtZLqGQEJV0Kf8TbgoE2LjBJgR4JkY3Q6P1_u';
      const client_secret = 'B4BE0F88F30DAB575A0649AB915A43CC21B29CFD1765DFEB78BA539BE0F1E946';
      const username = 'dev2@neilon.com';
      const password = 'welcom12!53PcZzDygiBq4vKp5WtSK8mAD';

      const { accessToken, instanceUrl } = await getToken(client_id, client_secret, username, password);
      const contentVersionId = '068GB00000oZ3ADYA0'; // Replace with your ContentVersion ID//
      const salesforceFileContent = await getSalesforceFile(accessToken, instanceUrl, contentVersionId);
      const awsAccessKey = 'AKIA3HJD3T3REEHJPVAU'
      const awsSecretKey = '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'
      const awsBucketRegion = 'ap-south-1';

      const awsBucketName = 'neilon-dev2';
      const key = 'Account/VMware LLC/Appex String.png'; 
      const name = 'Appex String.png'

      // Upload the Blob to S3
      const uploadResult = await uploadToS3(salesforceFileContent, key, awsBucketName, awsBucketRegion, awsAccessKey, awsSecretKey);
      console.log(JSON.stringify(uploadResult));
      
      res.send(`File uploaded successfully. Location:`);
      console.log('ACESSS TOKEN  ---'+JSON.stringify(accessToken))
      const xhr = new XMLHttpRequest();
      const url = `${instanceUrl}/services/apexrest/NEILON/S3Link/v1/creates3files/`

      xhr.open('POST', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.setRequestHeader('Content-Type', 'application/json');

      const body = [
        {
          "Name": "Appex String",
          "NEILON__Bucket_Name__c": "neilon-dev2",
          "NEILON__Amazon_File_Key__c": "Accounts/Burlington Textiles Corp of America/Appex String.png",
          "NEILON__Size__c": 178893,
          "NEILON__Account__c": "001GB00003B1jEgYAJ"
        }
      ];

      xhr.onload = function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
          debugger;
          const response = JSON.parse(xhr.responseText);
          console.log('Method Success', response);
        } else {
          console.log('ERROR:', xhr.status, xhr.statusText);
        }
      };

      xhr.onerror = function (e) {
        console.error('Request failed:', e);
      };

      xhr.send(JSON.stringify(body));
    } catch (error) {
      console.error('Error fetching Salesforce 124 data:', error);
      res.status(500).send(`Error: ${error || 'An unexpected error occurred.'}`);
    }
});

const port = process.env.PORT || 3008;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
