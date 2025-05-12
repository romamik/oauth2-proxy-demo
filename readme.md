# OAuth2 Proxy Demo

This is a simple example of how to use the [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/) in a Docker Compose setup.

## Run and Test OAuth2 Proxy with GitHub

Create a GitHub OAuth App here: https://github.com/settings/developers. Set the Authorization callback URL to: `"http://localhost:4180/oauth2/callback"`. Write down the client ID and secret from there.

Create a `docker-compose.yml` file:
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

Create a cookie secret with the following command:
```
openssl rand -base64 32 | tr -- '+/' '-_'
```

Create a `.env` file:
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

In the browser, go to http://localhost:4180. It will show a page with the `Login with GitHub` button. After clicking the button, you will be redirected to your GitHub account and then back to the server.

Test if everything works as expected:
* http://localhost:4180/oauth2/userinfo - should show your user info from GitHub.
* http://localhost:4180/oauth2/sign_out - should sign you out. After this, the userinfo endpoint will return a 401 Unauthorized error.
* http://localhost:4180/oauth2/start - should sign you in just like clicking the `Login with GitHub` button.
* http://localhost:4180/oauth2/auth - will respond with 202 Accepted or 401 Unauthorized.

## Proxify the Server

The server is a simple Node app that shows information about the request. The full code is as follows:
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
      # change the redirect URL to just localhost instead of localhost:4180
      OAUTH2_PROXY_REDIRECT_URL: "http://localhost/oauth2/callback"
      # server address
      OAUTH2_PROXY_UPSTREAMS: "http://server:3000"
      # pass X-Forwarded headers
      OAUTH2_PROXY_PASS_USER_HEADERS: "true"
      # strip X-Forwarded headers set from outside
      OAUTH2_PROXY_SKIP_AUTH_STRIP_HEADERS: "true"
```

Also, we need to change the callback URL in the [GitHub app settings](https://github.com/settings/developers) accordingly.

Now, when navigating to `http://localhost`, we should either see the login page or our server page in case we are already logged in.

And there should be `x-forwarded-user` and `x-forwarded-email` headers set that can be used in the server code to identify the user.

In this setup, OAuth2 Proxy is running as a reverse proxy and only allows access for authenticated users. The server can use request headers `x-forwarded-user` and `x-forwarded-email` to identify the user.

## Running Both the OAuth2 Proxy and the Server Behind Nginx

It is possible to set up both the OAuth2 Proxy and the server behind Nginx. Nginx is often already used as a reverse proxy, so using OAuth2 Proxy as an additional proxy may not be necessary.

Nginx configuration is taken straight from the [OAuth2 Proxy website](https://oauth2-proxy.github.io/oauth2-proxy/configuration/integration), with some address and port adjustments:
```
server {
  listen 80;

  location /oauth2/ {
    proxy_pass       http://oauth2-proxy:4180;
    proxy_set_header Host                    $host;
    proxy_set_header X-Real-IP               $remote_addr;
    proxy_set_header X-Auth-Request-Redirect $request_uri;
  }

  location = /oauth2/auth {
    proxy_pass       http://oauth2-proxy:4180;
    proxy_set_header Host             $host;
    proxy_set_header X-Real-IP        $remote_addr;
    proxy_set_header X-Forwarded-Uri  $request_uri;
    proxy_set_header Content-Length   "";
    proxy_pass_request_body           off;
  }

  location / {
    auth_request /oauth2/auth;
    error_page 401 =403 /oauth2/sign_in;

    auth_request_set $user   $upstream_http_x_auth_request_user;
    auth_request_set $email  $upstream_http_x_auth_request_email;
    proxy_set_header X-User  $user;
    proxy_set_header X-Email $email;

    auth_request_set $token  $upstream_http_x_auth_request_access_token;
    proxy_set_header X-Access-Token $token;

    auth_request_set $auth_cookie $upstream_http_set_cookie;
    add_header Set-Cookie $auth_cookie;

    auth_request_set $auth_cookie_name_upstream_1 $upstream_cookie_auth_cookie_name_1;

    if ($auth_cookie ~* "(; .*)") {
        set $auth_cookie_name_0 $auth_cookie;
        set $auth_cookie_name_1 "auth_cookie_name_1=$auth_cookie_name_upstream_1$1";
    }

    if ($auth_cookie_name_upstream_1) {
        add_header Set-Cookie $auth_cookie_name_0;
        add_header Set-Cookie $auth_cookie_name_1;
    }

    proxy_pass http://server:3000/;
  }
}
```

We also need to add Nginx to the `docker-compose.yml` file:
```yml
services:

  nginx:
    image: nginx:1.27.5-alpine
    ports:
     - "80:80"
    volumes:
     - ./nginx/default.conf:/etc/nginx/conf.d/default.conf
```

And change the `oauth2-proxy` configuration in the same `docker-compose.yml` file:
```yml
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.9.0-alpine
    # do not expose the ports
    environment:
      OAUTH2_PROXY_PROVIDER: ${OAUTH2_PROXY_PROVIDER}
      OAUTH2_PROXY_CLIENT_ID: ${OAUTH2_PROXY_CLIENT_ID}
      OAUTH2_PROXY_CLIENT_SECRET: ${OAUTH2_PROXY_CLIENT_SECRET}
      OAUTH2_PROXY_COOKIE_SECRET: "${OAUTH2_PROXY_COOKIE_SECRET}"
      OAUTH2_PROXY_REDIRECT_URL: "http://localhost/oauth2/callback"
      OAUTH2_PROXY_EMAIL_DOMAINS: "*"
      OAUTH2_PROXY_HTTP_ADDRESS: "0.0.0.0:4180"

      # set response headers that will be read by Nginx and used to set X-User and X-Email headers for our server
      OAUTH2_PROXY_SET_XAUTHREQUEST: "true"
      # make sure oauth2-proxy is aware it is behind a reverse proxy
      OAUTH2_PROXY_REVERSE_PROXY: "true"
```

Now, everything should work as in the previous example, except now the server receives `X-User` and `X-Email` headers instead of `x-forwarded-user` and `x-forwarded-email`.

## Calling Our Server Even for Non-Authenticated Users

Sometimes we want non-authenticated users to have access to the server, just to be able to know which user is logged in, if any.

This can be done by changing the Nginx configuration so that it does not respond with 401 Unauthorized if OAuth2 Proxy responded with 401.

In the Nginx configuration file:
```
  ...

  # fallback for non-authenticated requests
  location @noauth {
    # explicitly clear any headers
    proxy_set_header X-User  "";
    proxy_set_header X-Email "";
    proxy_pass http://server:3000;
  }

  location / {
    auth_request /oauth2/auth;

    # replace 403 /oauth2/sign_in with @noauth
    error_page 401 = @noauth;

    ...
```

Now even non-authenticated users can access the server, and the server can still check `X-User` and `X-Email` headers to know which user is logged in.

## Sign In / Sign Out Links

As we now do not have an automatic sign-in page, we need a way for users to sign in. So let's modify the server code:
```
  ...
  const user = req.headers['x-user'];
  const email = req.headers['x-email'];

  let userStatus;
  if (user) {
    userStatus = `Signed in as ${user}. <a href="/oauth2/sign_out">Sign out</a>`;
  }
  else {
    userStatus = 'Not signed in. <a href="/oauth2/start">Sign in</a>';
  }
  
  res.send(`
    ${userStatus}
    <pre>
      ${JSON.stringify(data, null, 2)}
    </pre>
  `);
```

Now we can see who is signed in and have a link to sign in or out.
