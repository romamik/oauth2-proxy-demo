const express = require('express');
const app = express();

app.get('/{*path}', (req, res) => {
  const data = {
    cookies: req.cookies,
    headers: req.headers,
    params: req.params,
    query: req.query,
    body: req.body
  };
  
  res.send(`
    <pre>
    ${JSON.stringify(data, null, 2)}
    </pre>
  `);
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});