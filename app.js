const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const nforce = require('nforce');
const cors = require('cors');
const app = express();

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cors());

// Configure AWS SDK with your credentials and region
const s3Client = new S3Client({
    region: 'ap-south-1', // Region code (Mumbai)
    credentials: {
        accessKeyId: 'AKIA3HJD3T3REEHJPVAU',
        secretAccessKey: 'zjUBWEmN49TGhVempmKq0ksK9JhkC08/Gipw+0gt'
    }
});

app.get('/uploadFiles', async (req, res) => {
    try {
        const fileId = req.headers['file-id']; 
        console.log('Headers:', req.headers); // Log the headers to ensure the File-ID is received
        console.log('Body:', req.body); // Log the body (if any)
        try {
          const { accessToken, instanceUrl } = await getToken();
          const contentVersionId = fileId; // Replace with your ContentVersion ID
          const contentVersionData = await getContentVersion(accessToken, instanceUrl, contentVersionId);
            // Define your S3 bucket name and the key (filename) for the object
    
            const bucketName = 'neilon-dev2';
            const key = 'Account/VMware LLC/image.png'; 
    
            // Upload the Blob to S3
            const uploadResult = await uploadToS3(bucketName, key, contentVersionData);
            
            console.log(JSON.stringify(uploadResult));
            res.send(`File uploaded successfully. Location:`);
        } catch (error) {
          console.error('Error fetching Salesforce data:', error);
          res.status(500).send('Error fetching Salesforce data');
        }
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).send('Internal Server Error'); // Send a proper error response
    }
});

const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

// Replace these values with your own Salesforce Connected App credentials
const client_id = '3MVG9fe4g9fhX0E5LBSFIgRVGpgTpFyOVSLBuH_hpDdIQt_a3.d_KtAQV6Q1h5mTBb3DcNMzYXw==';
const client_secret = '042C809B03668A3E01B44DCBB5E81CAA664FF6545598D27C42A30C2F0DEAF628';
const username = 'abhishek@123457.com';
const password = 'Abhi@12345L7QSLBs8JFFsUTgVWe9FP9gR';

const getToken = () => {
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
            const response = JSON.parse(xhr.responseText);
            // Include instance_url in the resolved data
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
  const url = `${instanceUrl}/services/data/v58.0/sobjects/ContentVersion/${contentVersionId}/VersionData`;

  try {
      const response = await fetch(url, {
          headers: {
              'Authorization': `Bearer ${accessToken}`
          }
      });
      if (!response.ok) {
          throw new Error(`Failed to fetch ContentVersion data: ${response.statusText}`);
      }
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log('Buffer length:', buffer.length);
      return buffer;
  } catch (error) {
      console.error('Error fetching ContentVersion data:', error);
      throw error;
  }
};

const uploadToS3 = (bucketName, key, buffer) => {
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        //ContentType: contentType // Set the content type if available
    });

    return s3Client.send(command);
};

app.get('/', async (req, res) => {
    try {
      const { accessToken, instanceUrl } = await getToken();
      const contentVersionId = '0685g00000Kyji3AAB'; // Replace with your ContentVersion ID
      const contentVersionData = await getContentVersion(accessToken, instanceUrl, contentVersionId);
        // Define your S3 bucket name and the key (filename) for the object

        const bucketName = 'neilon-dev2';
        const key = 'Account/VMware LLC/image.png'; 

        // Upload the Blob to S3
        const uploadResult = await uploadToS3(bucketName, key, contentVersionData);
        
        console.log(JSON.stringify(uploadResult));
        res.send(`File uploaded successfully. Location:`);
    } catch (error) {
      console.error('Error fetching Salesforce data:', error);
      res.status(500).send('Error fetching Salesforce data');
    }
});

const port = process.env.PORT || 3008;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
