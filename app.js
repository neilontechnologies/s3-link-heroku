const express = require('express');
const app = express();

// Use the PORT environment variable or default to 3000
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Hello Node API ABC My name');
});

app.get('/uploadsalesforcefile', async (req, res) => {
    try{
      const sfFileId = req.headers['sf-file-id']; 
      console.log(`name of id----:${sfFileId}`) ;
      res.send(`name of id----:${sfFileId}`);
    } catch(error){
      // Send failure email 
      console.log(error);
    }
  });

app.listen(port, () => {
    console.log(`Node App.js Running at http://localhost:${port}`);
});
