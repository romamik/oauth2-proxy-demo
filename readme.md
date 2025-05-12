# OAuth2 Proxy demo

This is a simple example of how to use the [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/) in a Docker Compose setup. 

## Run and test OAuth2 Proxy with github

Create Github OAuth App here: https://github.com/settings/developers. Set the Authorization callback URL to: `"http://localhost:4180/oauth2/callback"`. Write down client id and secret from there.

Create `docker-compose.yml` file:
```yml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.9.0-alpine
    ports:
      - "4180:4180"
    environment:
      OAUTH2_PROXY_PROVIDER: ${OAUTH2_PROXY_PROVIDER}
      OAUTH2_PROXY_CLIENT_ID: ${OAUTH2_PROXY_CLIENT_ID}
      OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH2_PROXY_CLIENT_SECRET}
      OAUTH2_PROXY_COOKIE_SECRET: "${OAUTH2_PROXY_COOKIE_SECRET}"
      OAUTH2_PROXY_REDIRECT_URL: "http://localhost:4180/oauth2/callback"
      OAUTH2_PROXY_EMAIL_DOMAINS: "*"
      OAUTH2_PROXY_HTTP_ADDRESS: "0.0.0.0:4180"
```

Create cookie secret with the following command:
```
openssl rand -base64 32 | tr -- '+/' '-_'
```

Create `.env` file:
```
OAUTH2_PROXY_PROVIDER=github
OAUTH2_PROXY_CLIENT_ID={{client id from github}}
OAUTH2_PROXY_CLIENT_SECRET={{client secret from github}}
OAUTH2_PROXY_COOKIE_SECRET={{cookie secret}}
```

Run the container:
```
docker-compose up --build
```

In the browser, go to http://localhost:4180. It will show a page with the `Login with github` button. After clicking the button you will be redirected to your github account and then back to the server.

Test if everything works as expected.
* http://localhost:4180/oauth2/userinfo - should show your user info from github.
* http://localhost:4180/oauth2/sign_out - should sign you out. After this the userinfo endpoint will return 401 Unauthorized error.
* http://localhost:4180/oauth2/start - should sign you in just like clicking the `Login with github` button.
* http://localhost:4180/oauth2/auth - will respond with 202 Accepted or 401 Unauthorized.

## Proxify the server

The server is a simple node app that shows information about the request. The full code is as follows:
```js
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
```

We can add the server to the `docker-compose.yml` file:
```yml
services:
  server:
    build: ./server
    command: npm run start
```
This assumes that the server code is in the `./server` directory and there is a Dockerfile for it. It is present in the repo.

Also, we need to configure the OAuth2 Proxy in `docker-compose.yml`:
```yml
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.9.0-alpine
    ports:
      # expose oauth2-proxy on port 80
      - "80:4180" 
    environment:
      OAUTH2_PROXY_PROVIDER: ${OAUTH2_PROXY_PROVIDER}
      OAUTH2_PROXY_CLIENT_ID: ${OAUTH2_PROXY_CLIENT_ID}
      OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH2_PROXY_CLIENT_SECRET}
      OAUTH2_PROXY_COOKIE_SECRET: "${OAUTH2_PROXY_COOKIE_SECRET}"
      # change the redirect url to just localhost instead of localhost:4180
      OAUTH2_PROXY_REDIRECT_URL: "http://localhost/oauth2/callback"
      # server address
      OAUTH2_PROXY_UPSTREAMS: "http://server:3000"
      # pass x-forwarded headers
      OAUTH2_PROXY_PASS_USER_HEADERS: "true"
      # strip x-forwarded headers set from outside
      OAUTH2_PROXY_SKIP_AUTH_STRIP_HEADERS: "true"
```

Also, we need to change callback url in the [github app settings](https://github.com/settings/developers) accordingly.

Now, when navigating to `http://localhost` we should either see the login page or our server page in case if we are already logged in.

And there should be `x-forwarded-user` and `x-forwarded-email` headers set that can be used in the server code to identify the user.

In this setup OAuth2 Proxy is running as a reverse proxy and only allows access for the authentificated users. The server can use request headers `x-forwarded-user` and `x-forwarded-email` to identify the user.
