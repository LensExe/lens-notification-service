# Portainer notification stack

Stack này deploy image `lens-notification`, Kafka và MongoDB. Redis không được
nhân bản trong stack; service dùng Redis chung `lens-redis` của
`lens-infra` trên mạng `lens-network`.

## Chuẩn bị

Tạo hai external network một lần trên Docker host nếu chưa có:

```sh
docker network create lens-network
docker network create lens-proxy
```

Deploy `lens-infra` trước để có `lens-redis`. Sau đó trong Portainer chọn
**Stacks → Add stack → Git repository**, dùng đường dẫn Compose:
`deploy/portainer/notification-stack.yml`.

Mẫu biến môi trường nằm ở `deploy/portainer/env.production.example`. Copy thành
`deploy/portainer/env.production`, thay tất cả `CHANGE_ME`, rồi nạp các biến đó
vào Portainer. File `env.production` đã được Git ignore.

Khi chạy bằng Docker Compose trên máy chủ, dùng trực tiếp:

```sh
docker compose --env-file deploy/portainer/env.production \
  -f deploy/portainer/notification-stack.yml up -d
```

Image mặc định là `ghcr.io/lensexe/lens-notification:latest`. Để dùng image
registry khác, đặt `NOTIFICATION_IMAGE`; để dùng image import cục bộ, đặt:

```dotenv
NOTIFICATION_IMAGE=lens-notification:local
NOTIFICATION_PULL_POLICY=never
```

## Biến bắt buộc

Đặt các biến sau trong phần Environment variables của Portainer. Không commit
giá trị thật vào Git:

```dotenv
KAFKA_PASSWORD=change-me
KAFKA_CONTROLLER_PASSWORD=change-me
MONGO_ROOT_USERNAME=noti_system_db_user
MONGO_ROOT_PASSWORD=change-me
MONGO_URI=mongodb://noti_system_db_user:change-me@notification-mongodb:27017/?authSource=admin
REDIS_PASSWORD=the-password-used-by-lens-redis
KEYCLOAK_ISSUER=https://auth.example.com/realms/lens
KEYCLOAK_AUDIENCE=notification-service
KEYCLOAK_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
MAIL_PROVIDER_NAME=mailgun
MAILGUN_API_KEY=change-me
MAILGUN_DOMAIN=example.com
MAILGUN_FROM_EMAIL=noreply@example.com
```

`MONGO_URI` phải dùng hostname `notification-mongodb`, `REDIS_HOST` mặc định
là `lens-redis`, và `KAFKA_BROKERS` mặc định là `kafka:9094`. Không dùng
`localhost` bên trong container. Nếu mật khẩu Mongo có ký tự đặc biệt, URL
encode mật khẩu trong `MONGO_URI`.

`kafka-init` tự tạo sáu topic notification/chat và chạy một lần sau khi Kafka
sẵn sàng. Các service phát event khác trong `lens-network` phải dùng
`kafka:9094` cùng `KAFKA_USERNAME`/`KAFKA_PASSWORD`.

Port `3001` chỉ bind vào loopback host. Kong/Caddy truy cập service qua Docker
DNS `notification:3001` trên `lens-network`/`lens-proxy`; đổi
`NOTIFICATION_HOST_PORT` nếu cần debug trực tiếp trên host.
