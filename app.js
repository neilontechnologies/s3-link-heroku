const express = require('express');
const cors = require('cors');
const app = express();

// Use the PORT environment variable or default to 3001
const port = process.env.PORT || 3000;

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cors());

app.get('/country/:country_name', (req, res) => {
    console.log('Route params:', req.params.country_name);
    res.send('Country is set');
});

app.get('/name', (req, res) => {
    res.send({name:'Sakshi', address:'Mumbai'});dir
});

app.get('/', (req, res) => {
    res.send('Welcome to the homepage!');
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
