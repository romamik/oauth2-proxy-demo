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

## Running both the OAuth2 Proxy and the server behind nginx

It is possible to setup both the OAuth2 Proxy and the server behind nginx. Nginx is often already used as a reverse proxy, so using oauth2-proxy as an additional proxy can be not necessary. 

Nginx configuration is taken straight from the [oauth2-proxy website](https://oauth2-proxy.github.io/oauth2-proxy/configuration/integration). With just changing some addresses and ports:
```
server {
  listen 80;

  location /oauth2/ {
    proxy_pass       http://oauth2-proxy:4180;
    proxy_set_header Host                    $host;
    proxy_set_header X-Real-IP               $remote_addr;
    proxy_set_header X-Auth-Request-Redirect $request_uri;
    # or, if you are handling multiple domains:
    # proxy_set_header X-Auth-Request-Redirect $scheme://$host$request_uri;
  }
  location = /oauth2/auth {
    proxy_pass       http://oauth2-proxy:4180;
    proxy_set_header Host             $host;
    proxy_set_header X-Real-IP        $remote_addr;
    proxy_set_header X-Forwarded-Uri  $request_uri;
    # nginx auth_request includes headers but not body
    proxy_set_header Content-Length   "";
    proxy_pass_request_body           off;
  }

  location / {
    auth_request /oauth2/auth;
    error_page 401 =403 /oauth2/sign_in;

    # pass information via X-User and X-Email headers to backend,
    # requires running with --set-xauthrequest flag
    auth_request_set $user   $upstream_http_x_auth_request_user;
    auth_request_set $email  $upstream_http_x_auth_request_email;
    proxy_set_header X-User  $user;
    proxy_set_header X-Email $email;

    # if you enabled --pass-access-token, this will pass the token to the backend
    auth_request_set $token  $upstream_http_x_auth_request_access_token;
    proxy_set_header X-Access-Token $token;

    # if you enabled --cookie-refresh, this is needed for it to work with auth_request
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    add_header Set-Cookie $auth_cookie;

    # When using the --set-authorization-header flag, some provider's cookies can exceed the 4kb
    # limit and so the OAuth2 Proxy splits these into multiple parts.
    # Nginx normally only copies the first `Set-Cookie` header from the auth_request to the response,
    # so if your cookies are larger than 4kb, you will need to extract additional cookies manually.
    auth_request_set $auth_cookie_name_upstream_1 $upstream_cookie_auth_cookie_name_1;

    # Extract the Cookie attributes from the first Set-Cookie header and append them
    # to the second part ($upstream_cookie_* variables only contain the raw cookie content)
    if ($auth_cookie ~* "(; .*)") {
        set $auth_cookie_name_0 $auth_cookie;
        set $auth_cookie_name_1 "auth_cookie_name_1=$auth_cookie_name_upstream_1$1";
    }

    # Send both Set-Cookie headers now if there was a second part
    if ($auth_cookie_name_upstream_1) {
        add_header Set-Cookie $auth_cookie_name_0;
        add_header Set-Cookie $auth_cookie_name_1;
    }

    proxy_pass http://server:3000/;
    # or "root /path/to/site;" or "fastcgi_pass ..." etc
  }
}
```

We also need to add nginx to `docker-compose.yml` file:
```yml
services:

  nginx:
    image: nginx:1.27.5-alpine
    ports:
     - "80:80"
    volumes:
     - ./nginx/default.conf:/etc/nginx/conf.d/default.conf
```

And to change `oauth2-proxy` configuration in the same `docker-compose.yml` file:
```yml
  auth2-proxy:
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
      
      # remove unneeded environment variables: 
      # OAUTH2_PROXY_UPSTREAMS: "http://server:3000"
      # OAUTH2_PROXY_PASS_USER_HEADERS: "true"
      # OAUTH2_PROXY_SKIP_AUTH_STRIP_HEADERS: "true"

      # set response headers that will be read by nginx and used to set x-user and x-email header for our server
      OAUTH2_PROXY_SET_XAUTHREQUEST: "true"
      # make sure oauth2-proxy is aware it is behind a reverse proxy, otherwise it can behave incorrectly
      OAUTH2_PROXY_REVERSE_PROXY: "true"

```

Now, everything should work as in previous example, except now the server receives `X-User` and `X-Email` headers instead of `x-forwarded-user` and `x-forwarded-email`.