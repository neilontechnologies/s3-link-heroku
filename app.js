const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const cors = require('cors');
const app = express();

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cors());

// Method to upload salesforce files into AWS S3 dynamatically from salesforce method
app.get('/uploadFiles', async (req, res) => {
  try {
    const sfContentVersionId = req.headers['sf-content-version-id']; 
    const awsAccessKey = req.headers['aws-access-key'];
    const awsSecretKey = req.headers['aws-secret-key'];
    const sfClientId = req.headers['sf-client-id'];
    const sfClientSecret = req.headers['sf-client-secret'];
    const sfUsername = req.headers['sf-username'];
    const sfPassword = req.headers['sf-password'];

    // Get access token of salesforce
    const { accessToken, instanceUrl } = await getToken(sfClientId, sfClientSecret, sfUsername, sfPassword);
    const contentVersionId = sfContentVersionId; 

    // Get salesforce file information 
    const contentVersionData = await getContentVersion(accessToken, instanceUrl, contentVersionId);

    const bucketName = 'neilon-dev2';
    const key = 'Account/VMware LLC/image.png'; 

    // Upload salesforce file into AWS S3
    const uploadResult = await uploadToS3(bucketName, key, contentVersionData, awsAccessKey, awsSecretKey);
    
    res.send(`File uploaded successfully. Location:`);
  } catch (error) {
    console.error('Error fetching Salesforce 124 data:', error);
    console.log(JSON.stringify(error));
    res.status(500).send(`Error: ${error || 'An unexpected error occurred.'}`);
  }
});

const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

// Method to get access token of Salesforce
const getToken = (client_id, client_secret, username, password) => {
    return new Promise((resolve, reject) => {
      const postData = `grant_type=password&client_id=${client_id}&client_secret=${client_secret}&username=${username}&password=${password}`;
      const xhr = new XMLHttpRequest();
      const url = 'https://login.salesforce.com/services/oauth2/token';
  
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            debugger
            console.log('tokenn ____'+response.access_token);
            resolve({
              accessToken: response.access_token,
              instanceUrl: response.instance_url
            });
          } else {
            reject(new Error('Failed to get access token'));
          }
        }
      };
  
      xhr.onerror = function (e) {
        reject(new Error(`Problem with request: ${e.message}`));
      };
  
      xhr.send(postData);
    });
  };

const getContentVersion = async (accessToken, instanceUrl, contentVersionId) => {
  console.log('Method Calling get content version');
  const url = `${instanceUrl}/services/data/v58.0/sobjects/ContentVersion/${contentVersionId}/VersionData`;

  try {
      const response = await fetch(url, {
          headers: {
              'Authorization': `Bearer ${accessToken}`
          }
      });
      //Returns the response status code
      if (!response.ok) {
          console.log('GETTING AN ERROR');
          throw new Error(`Failed to fetch ContentVersion data: ${response.statusText}`);
      }
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer;
  } catch (error) {
    console.log(error, 'GETTING');
    console.error('Error fetching ContentVersion data:', error);
    throw error;
  }
};

const uploadToS3 = async (bucketName, key, buffer, awsAccessKey, awsSecretKey) => {
  try {
    console.log('Uploading to S3...');
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
    });

    const s3Client = new S3Client({
      region: 'ap-south-1',
      credentials: {
          accessKeyId: awsAccessKey,
          secretAccessKey: awsSecretKey
      }
    });
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    console.error('Error uploading to S3:', error.message);
    throw error.message; 
  }
};

app.get('/', async (req, res) => {
    try {
      // Replace these values with your own Salesforce Connected App credentials
      const client_id = '3MVG9fe4g9fhX0E5LBSFIgRVGpgTpFyOVSLBuH_hpDdIQt_a3.d_KtAQV6Q1h5mTBb3DcNMzYXw==';
      const client_secret = '042C809B03668A3E01B44DCBB5E81CAA664FF6545598D27C42A30C2F0DEAF628';
      const username = 'abhishek@123457.com';
      const password = 'Abhi@12345HLTQen8eCoiN5TBV8nVOlIfnf';

      const { accessToken, instanceUrl } = await getToken(client_id, client_secret, username, password);
      const contentVersionId = '0685g00000Kyji3AAB'; // Replace with your ContentVersion ID//
      const contentVersionData = await getContentVersion(accessToken, instanceUrl, contentVersionId);
      const awsAccessKey = 'AKIA3HJD3T3REEHJPVAU'
      const awsSecretKey = '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'

      const bucketName = 'neilon-dev2';
      const key = 'Account/VMware LLC/image.png'; 

      // Upload the Blob to S3
      const uploadResult = await uploadToS3(bucketName, key, contentVersionData, awsAccessKey, awsSecretKey);
      
      res.send(`File uploaded successfully. Location:`);
    } catch (error) {
      console.error('Error fetching Salesforce 124 data:', error);
      res.status(500).send(`Error: ${error || 'An unexpected error occurred.'}`);
    }
});

const port = process.env.PORT || 3008;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
