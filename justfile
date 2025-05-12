# start prod
start:
    docker-compose up --build --detach

# start dev
start-dev:
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build --detach

# stop prod/dev
stop:
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml down

# show logs 
logs:
    docker-compose logs --follow

create-cookie-secret:
    openssl rand -base64 32 | tr -- '+/' '-_'