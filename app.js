const express = require('express');
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

app.get('/', (req, res) => {
    res.send('Welcome to the homepage!');
});


app.get('/uploadFiles', (req, res) => {
    try {
        const fileId = req.headers['file-id']; 
        console.log('Headers:', req.headers); // Log the headers to ensure the File-ID is received
        console.log('Body:', req.body); // Log the body (if any)

        // Sending JSON response
        res.send(`File-ID: ${fileId}`);
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).send('Internal Server Error'); // Send a proper error response
    }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
