const express = require('express');
const nforce = require('nforce');
const cors = require('cors');
const app = express();

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cors());

app.get('/country/:country_name', (req, res) => {
    console.log('Route params:', req.params.country_name);
    res.send('Country is set');
});

app.get('/name', (req, res) => {
    res.send({name:'Sakshi', address:'Mumbai'});
});

app.get('/', async (req, res) => {
    //res.send('Welcome to the homepage!');
    try {
        const accessToken = await getToken();
        res.send({ accessToken });
      } catch (error) {
        console.error('Error fetching Salesforce access token:', error);
        res.status(500).send('Error fetching Salesforce access token');
      }
});


app.get('/uploadFiles', (req, res) => {
    try {
        const fileId = req.headers['file-id']; 
        console.log('Headers:', req.headers); // Log the headers to ensure the File-ID is received
        console.log('Body:', req.body); // Log the body (if any)

        // Sending JSON response
        //res.send(`File-ID: ${fileId}`);
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
const password = 'Abhi@12345xM9sk4P9LAY6jC9yhNTyKNMn';

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
            console.log(xhr);
            const response = JSON.parse(xhr.responseText);
            resolve(response.access_token);
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

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
