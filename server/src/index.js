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
  
  const user = req.headers['x-user'];
  const email = req.headers['x-email'];

  let userStatus;
  if (user) {
    userStatus = `Signed in as ${user}. <a href="/oauth2/sign_out">Sign out</a>`;
  }
  else {
    userStatus = 'Not signed in. <a href="/oauth2/start">Sign in</a>';
  }
  
  res.send(`${userStatus}
<pre>
${JSON.stringify(data, null, 2)}
</pre>
`);
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});