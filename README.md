# Notification Service

Một microservice NestJS chuẩn, chạy một process và một port, đứng sau API Gateway bên ngoài.

## Cấu trúc

```text
src/
  main.ts
  setup.ts                         # Global prefix + validation
  app.module.ts                    # Hạ tầng MongoDB/BullMQ, hai context
  common/security/
    security.module.ts             # APP_GUARD dùng chung
    keycloak-jwt.guard.ts
    keycloak-jwt.verifier.ts        # Verify RSA public key tại local
    keycloak-jwt.verifier.spec.ts
  modules/
    mail/
      mail-context.module.ts
      mail/                        # Endpoint gửi single/bulk + worker
      template/                    # MJML, biến template
      job-template/                # Mapping job -> template
      providers/                   # Interface và chọn provider
      sendgrid/
      mailgun/
      entity/                      # Repository chỉ thuộc mail
      queue/
    notification/
      notification-context.module.ts
      notification.module.ts       # Ghép các subdomain notification
      core/                         # Entity, DTO, enum và nghiệp vụ notification
      api/                          # HTTP controller
      events/                       # Kafka consumers và DLQ relay
      realtime/                     # Socket.IO gateway và telemetry
      jobs/                         # BullMQ processor và queue
test/
  jest-e2e.json
  service.e2e-spec.ts
.env.example
nest-cli.json
package.json
tsconfig.json
tsconfig.build.json
../lens-backend/.docker/notification-system/ # Cấu hình Compose hạ tầng
```

Hai context không import lẫn nhau. MongoDB connection và BullMQ connection là hạ tầng dùng chung; mỗi context đăng ký schema riêng qua `forFeature`. Mail chỉ xử lý email/template. Notification chỉ xử lý in-app và realtime. Không có gateway HTTP, user management, login, refresh token hoặc proxy nội bộ.

## Chạy

Yêu cầu Node.js 22.13+, pnpm 11.15.1, MongoDB, Redis và thông tin provider email. Phiên bản pnpm được cố định trong trường packageManager của package.json.

1. Chạy `pnpm install --frozen-lockfile` (dùng cùng lệnh này trong CI).
2. Tạo `.env` từ `.env.example`, điền public key Keycloak và cấu hình hạ tầng/provider.
3. MongoDB tự tạo database/collection khi service ghi document đầu tiên; production nên tạo index và phân quyền bằng quy trình triển khai riêng.
4. Chạy `pnpm start:dev` hoặc `pnpm build && pnpm start:prod`.

Service mặc định nghe port 3001. Tất cả HTTP endpoint bắt đầu bằng `/api/v1`.
Trước khi chuyển Notification khỏi Redis riêng sang Redis chung của Lens, hãy drain queue cũ hoặc chủ động chuyển job; dữ liệu job không tự chuyển sang Redis Lens DB 1. Giữ volume Redis cũ cho tới khi xác nhận không còn cần dữ liệu. Không chạy đồng thời worker cũ và mới trên cùng queue khi chuyển đổi.

### Build Docker image

```sh
docker build -t lens-notification:local .
docker run --rm --name lens-notification \
  --env-file .env \
  --network lens-network \
  -p 3001:3001 \
  lens-notification:local
```

Khi chạy trong container, các biến `MONGO_URI`, `KAFKA_BROKERS` và `REDIS_HOST` phải dùng DNS/container name trong `lens-network`, không dùng `localhost`. Không copy `.env` vào image; truyền cấu hình lúc chạy container.

### Deploy bằng Portainer

Stack production nằm tại `deploy/portainer/notification-stack.yml`; hướng dẫn
biến môi trường và thứ tự triển khai nằm trong `deploy/portainer/README.md`.

## API

Tất cả endpoint yêu cầu `Authorization: Bearer <Keycloak access token>`. Mail/template/job-template và
`POST /api/v1/notifications` yêu cầu role `admin`; OTP từ Core và event từ Kafka không đi qua HTTP controller.

| Method | Path                                  | Nhiệm vụ                                     |
| ------ | ------------------------------------- | -------------------------------------------- |
| POST   | /api/v1/mail/:jobName/single          | Xếp hàng một email, trả 202                  |
| POST   | /api/v1/mail/:jobName/bulk            | Xếp hàng nhiều email, trả 202                |
| GET    | /api/v1/mail/templates                | Danh sách template                           |
| POST   | /api/v1/mail/templates                | Tạo template kèm `template_variables`       |
| POST   | /api/v1/mail/templates/variable       | Thêm biến vào template đã tồn tại           |
| GET    | /api/v1/mail/job-templates            | Danh sách mapping                            |
| POST   | /api/v1/mail/job-templates            | Tạo mapping                                  |
| GET    | /api/v1/mail/job-templates/records    | Đọc mapping đã resolve                       |
| POST   | /api/v1/notifications                 | Tạo và phát một in-app notification          |
| GET    | /api/v1/notifications?skip=0&limit=20 | Đọc thông báo của JWT sub                    |
| POST   | /api/v1/notifications/mark-read       | Đánh dấu tất cả thông báo của JWT sub đã đọc |

jobName: `send-otp-email`, `send-transactional-email`, `send-welcome-email`,
`send-password-reset-email`,
`send-order-confirmation-email`, `send-payment-receipt-email`, `send-shipping-update-email`,
`send-promotion-email`. Template catalog and payload examples: [Email templates](md/email-template-catalog.md).

Ví dụ body gửi mail:

```json
{
  "to": "user@example.com",
  "template_id": "<uuid>",
  "variables": { "otp": "123456" }
}
```

Ví dụ body tạo notification:

```json
{
  "userId": "<Keycloak subject>",
  "title": "Đặt hàng thành công",
  "message": "Đơn hàng của bạn đã được tiếp nhận",
  "type": "order_placed",
  "data": { "orderId": "order-123" }
}
```

Các endpoint đọc/mark-read không nhận userId để chọn tài khoản khác; identity lấy từ JWT sub. Mail và notification không tự kích hoạt nhau.

## Nhận notification event từ Kafka

Notification service có thể consume event từ topic `notification.events`. Consumer xác thực cấu trúc message rồi đưa notification vào BullMQ; worker lưu notification vào MongoDB và phát Socket.IO event `notification` đến room của user. Consumer mặc định tắt để service hiện tại vẫn chạy khi Kafka chưa được cấu hình.

Hướng dẫn chi tiết cho service phát event: [Gửi notification event lên Kafka](md/notification_kafka_producer_guide.md).

Kafka và MongoDB local được quản lý trong `.docker/compose.yaml`. Redis được dùng chung với Lens Backend. Khởi động Lens Redis bằng `pnpm docker:up` từ thư mục `lens-backend` trước, sau đó khởi động broker và Kafka UI:

```sh
docker compose -f .docker/compose.yaml up -d --remove-orphans kafka kafka-ui notification-mongodb
```

Trong Kafka UI tại `http://localhost:8080`, tạo các topic `notification.events`, `notification.events.dlq`, `notification.mail.commands.v1`, `notification.mail.commands.v1.dlq`, `chat.conversation.events.v1` và `chat.conversation.events.v1.dlq` với 1 partition, replication factor 1 cho môi trường local. Broker đang tắt auto-create topic.

Thêm cấu hình sau vào `.env` khi notification service chạy trực tiếp trên máy host. Redis dùng `localhost:6380`, DB 1 và cùng `REDIS_PASSWORD` với Lens Backend; thay giá trị ví dụ bên dưới bằng giá trị trong `.env` của `lens-backend`. Khi chạy service trong `lens-network`, đổi host/port thành `lens-redis:6379`:

```dotenv
KAFKA_ENABLED=true
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=notification-service
KAFKA_GROUP_ID=notification-service
KAFKA_NOTIFICATION_EVENTS_TOPIC=notification.events
KAFKA_NOTIFICATION_EVENTS_DLQ_TOPIC=notification.events.dlq
KAFKA_FROM_BEGINNING=false
KAFKA_MAIL_COMMANDS_TOPIC=notification.mail.commands.v1
KAFKA_MAIL_COMMANDS_DLQ_TOPIC=notification.mail.commands.v1.dlq
KAFKA_MAIL_COMMANDS_GROUP_ID=notification-mail
KAFKA_MAIL_COMMANDS_FROM_BEGINNING=false
KAFKA_USERNAME=kafka
KAFKA_PASSWORD=kafka-secret-password
KAFKA_SSL=false
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_DB=1
REDIS_PASSWORD=your-local-redis-password
```

Nếu notification service chạy trong container cùng `lens-network`, dùng `MONGO_URI=mongodb://noti_system_db_user:noti_system_db_password@notification-mongodb:27017/?authSource=admin` và `MONGO_DB_NAME=noti_system_db`. Nếu chạy trên host, đổi host trong URI thành `localhost`. Redis được cấu hình với `REDIS_HOST=lens-redis`, `REDIS_PORT=6379`, `REDIS_DB=1` khi chạy trong network hoặc `REDIS_HOST=localhost`, `REDIS_PORT=6380` khi chạy trên host. Trong production, cấu hình broker, SASL credentials, MongoDB và TLS theo môi trường triển khai; không dùng credential local trong production.

Với group ID mới, `KAFKA_FROM_BEGINNING=false` bắt đầu đọc event mới tại thời điểm consumer khởi động. Hãy bật consumer trước khi producer gửi event; đặt biến này thành `true` cùng group ID mới nếu cần replay event còn lưu trên topic.

### Mail command từ Core

Core không gọi HTTP endpoint nội bộ để gửi OTP. Nó publish command vào `notification.mail.commands.v1`; Notification validate command, dùng `eventId` làm BullMQ job ID và đưa email vào `email-single-queue`. Email chỉ được gửi bởi Mail worker sau khi Kafka consumer đã xác nhận command hợp lệ. Command sai schema đi vào `notification.mail.commands.v1.dlq`.

```json
{
  "eventId": "lens-backend:otp:<id>",
  "eventType": "auth.otp.requested.v1",
  "jobName": "send-otp-email",
  "to": "user@example.com",
  "variables": {
    "appName": "Lens",
    "userName": "Nguyễn Văn A",
    "otpCode": "123456",
    "expiresInMinutes": "5",
    "year": "2026"
  }
}
```

Luồng bulk email vẫn nằm trong Notification Service: API chỉ nhận tối đa 1.000 recipient/request, tạo một BullMQ job cho mỗi recipient, chạy qua queue riêng có concurrency/rate limit và retry tối đa ba lần. `campaignId` tạo job ID ổn định để lần enqueue lặp không tạo trùng trong thời gian BullMQ còn giữ job; request không có `campaignId` được coi là ad-hoc và có thể tạo batch mới.

### Event contract

Mỗi Kafka message value là JSON theo dạng sau. `eventId` phải ổn định và duy nhất cho một event để queue có thể nhận diện lần gửi lặp. `priority` có thể bỏ qua (mặc định `instant`) hoặc đặt thành `emergency`.

```json
{
  "eventId": "order-service:ORD-123:placed",
  "eventType": "order.created",
  "priority": "instant",
  "notification": {
    "userId": "<keycloak-sub>",
    "title": "Đặt hàng thành công",
    "message": "Đơn hàng ORD-123 đã được tiếp nhận",
    "type": "order_placed",
    "data": { "orderId": "ORD-123" }
  }
}
```

`notification.type` hiện nhận một trong các giá trị `welcome`, `order_placed`, `payment_success`, `promotion_started`. Event JSON không hợp lệ hoặc không được hỗ trợ sẽ được chuyển nguyên payload kèm thông tin lỗi vào `notification.events.dlq`. Lỗi tạm thời khi enqueue sẽ không được xác nhận với Kafka để broker gửi lại.

### Gửi event từ một microservice Node.js

Service gửi event có thể dùng KafkaJS. Với service chạy trên host, dùng `localhost:9092`; service chạy trong Docker dùng `host.docker.internal:19092`.

```ts
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'order-service',
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  sasl: {
    mechanism: 'plain',
    username: process.env.KAFKA_USERNAME ?? 'kafka',
    password: process.env.KAFKA_PASSWORD ?? 'kafka-secret-password',
  },
  ssl: process.env.KAFKA_SSL === 'true',
});

const producer = kafka.producer();
await producer.connect();
await producer.send({
  topic: 'notification.events',
  messages: [
    {
      key: 'order-service:ORD-123:placed',
      value: JSON.stringify({
        eventId: 'order-service:ORD-123:placed',
        eventType: 'order.created',
        priority: 'instant',
        notification: {
          userId: '<keycloak-sub>',
          title: 'Đặt hàng thành công',
          message: 'Đơn hàng ORD-123 đã được tiếp nhận',
          type: 'order_placed',
          data: { orderId: 'ORD-123' },
        },
      }),
    },
  ],
});
await producer.disconnect();
```

Đoạn code trên minh họa gửi một lần. Trong service chạy liên tục, kết nối producer khi ứng dụng khởi động, tái sử dụng producer cho các event và ngắt kết nối khi ứng dụng dừng.

Sau khi producer gửi message, client đã kết nối Socket.IO như hướng dẫn bên dưới sẽ nhận event `notification`. Kafka consumer group phân phối partition giữa các instance notification service. Kafka và BullMQ dùng cơ chế at-least-once; cùng `eventId` được dùng làm BullMQ job ID để ngăn enqueue trùng trong thời gian job còn được giữ lại.

## Nhận chat event realtime

Chat realtime dùng consumer riêng, không đi qua `notification.events` và không lưu inbox khi user offline. Consumer mặc định dùng topic `chat.conversation.events.v1`, group `notification-chat-realtime` và DLQ `chat.conversation.events.v1.dlq`. Chat Service phát các event `chat.message.created.v1`, `chat.message.updated.v1`, `chat.message.recalled.v1` và `chat.read-cursor.advanced.v1`.

```dotenv
KAFKA_ENABLED=true
KAFKA_CHAT_EVENTS_TOPIC=chat.conversation.events.v1
KAFKA_CHAT_EVENTS_GROUP_ID=notification-chat-realtime
KAFKA_CHAT_EVENTS_DLQ_TOPIC=chat.conversation.events.v1.dlq
KAFKA_CHAT_EVENTS_FROM_BEGINNING=false
```

Tạo cả topic nguồn và DLQ trước khi chạy vì Kafka local đang tắt auto-create. Kafka key phải bằng `channel_id`. Event hợp lệ được phát Socket.IO event `chat.event` tới room `user:<participant_id>`; room chỉ được join bằng `sub` của JWT đã xác thực.

Socket.IO envelope:

```json
{
  "event_id": "<stable-id>",
  "event": "NEW_MESSAGE",
  "aggregate_version": 55,
  "payload": {
    "id": "<message-id>",
    "channel_id": "<channel-id>",
    "sender_id": "<user-sub>",
    "client_message_id": "<client-id>",
    "type": "text",
    "content": "Xin chào",
    "seq": 42,
    "revision": 1,
    "created_at": "2026-10-04T10:00:00Z",
    "updated_at": "2026-10-04T10:00:00Z"
  }
}
```

Message payload có cùng shape với REST `MessageResponse`. `event` là `NEW_MESSAGE`, `UPDATED_MESSAGE`, `RECALLED_MESSAGE` hoặc `READ_CURSOR`; read cursor payload gồm `channel_id`, `user_id`, `last_read_seq`. Client dedupe bằng `event_id`, áp dụng `aggregate_version` và message `revision` tăng dần. Nếu thấy thiếu `aggregate_version`/`seq`, client tải history từ Chat API rồi đồng bộ. Duplicate được chấp nhận; consumer không giữ dedupe state lâu dài.

Chat realtime hiện chạy trên một Notification Service instance và dùng Socket.IO in-memory adapter mặc định; không cần Redis Streams adapter cho gateway. Redis vẫn có thể được ứng dụng dùng cho BullMQ/queue, nhưng không tham gia fan-out chat realtime. Endpoint metrics là `GET /api/v1/metrics` và cần bearer token.

Invalid schema/event được ghi vào Kafka DLQ ngay. Lỗi đồng bộ khi gọi gateway được thử tối đa ba lần (500ms, rồi 1 giây); sau đó ghi nguyên event vào chat DLQ rồi xác nhận offset nguồn sau khi DLQ đã ghi thành công. DLQ write lỗi làm Kafka retry source event. Đây không phải ACK từ client: Socket.IO `emit` không chờ client áp dụng packet, nên client phải đồng bộ Chat history khi reconnect/gap. Socket.IO connection recovery bật 120 giây trong bộ nhớ của process; nếu Notification Service restart thì state recovery này mất.

Runbook xử lý outbox event bị park, Kafka DLQ, duplicate và ordering nằm trong [md/chat-realtime-operations.md](md/chat-realtime-operations.md); contract consumer đầy đủ nằm trong [md/chat-events-consumer-design.md](md/chat-events-consumer-design.md).

Chat Service cũng giữ Kafka publish lỗi ba lần trong Mongo `outbox_events` với `status: "failed"` và nguyên event để operator xem/replay; record không bị xóa. Cấu hình consumer group này dùng chung giữa các instance Notification Service; nhánh push tương lai phải có group ID riêng.

## Keycloak local verification và Gateway

Service chỉ dùng public key PEM cấu hình ở KEYCLOAK_PUBLIC_KEY. Không có JWKS fetch, introspection, userinfo hay HTTP request lên Keycloak. Chỉ chấp nhận RS256, issuer chính xác, audience của service, sub không rỗng, exp hợp lệ và claim typ=Bearer. jsonwebtoken cũng kiểm tra nbf nếu có.

KEYCLOAK_ISSUER phải khớp nguyên văn claim iss, kể cả scheme/hostname/realm. Cấu hình audience mapper/client scope ở Keycloak để access token có aud chứa notification-service (hoặc giá trị KEYCLOAK_AUDIENCE). Dùng public key của realm dưới dạng PEM SPKI; public key không phải client secret. Khi Keycloak đổi signing key, cập nhật cấu hình key và restart service. Verify local không biết token đã logout/revoke trước exp; nên sử dụng access token thời hạn ngắn.

Gateway bên ngoài forward nguyên path /api/v1/... và Authorization header đến service. Không dựa vào X-User-Id hoặc các header identity do client cung cấp. Notification hiện kiểm soát quyền `admin` cho gửi mail, quản lý template/job-template và `POST /notifications`; các endpoint đọc notification vẫn giới hạn theo `sub` của token.

Socket.IO dùng namespace /notification, transport path /api/v1/socket.io. Global prefix của Nest chỉ áp dụng cho HTTP controller nên WebSocket có path riêng được cấu hình rõ ràng. Gateway ngoài cần forward polling và WebSocket upgrade tại path này.

```ts
const socket = io('https://gateway.example.com/notification', {
  path: '/api/v1/socket.io',
  auth: { token: accessToken },
});
socket.on('notification', (payload) => console.log(payload));
```

Server verify JWT trong handshake rồi tự join room theo sub. Không còn event join cho client tự chọn userId. Socket bị ngắt trong khoảng một giây sau exp; client refresh token ở hệ thống đăng nhập rồi reconnect. In-memory adapter chỉ phát tới socket trên instance hiện tại; chạy thêm Notification instance cần bổ sung adapter dùng chung như Redis Streams và cấu hình gateway/load balancer tương ứng.

Tham khảo: [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers), [jsonwebtoken verify](https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback).

## Kiểm tra

```sh
pnpm build
pnpm test --runInBand
pnpm test:e2e --runInBand
pnpm lint
```

E2E kiểm tra HTTP routing/auth/validation với adapter nghiệp vụ được mock; không gửi email thật và không kết nối DB/Redis. Cần smoke test với hạ tầng và token Keycloak thực tế trước khi triển khai.

## Giới hạn kế thừa và các tính năng tiếp theo

Notification và email-template hiện dùng MongoDB làm datastore duy nhất. Việc này loại bỏ dual-write giữa PostgreSQL và MongoDB; MongoDB vẫn cần backup và index phù hợp trong production. Retry mail có thể gửi trùng nếu provider nhận thư nhưng worker chưa ghi nhận thành công.

Các ưu tiên tiếp theo: idempotency bền vững ngoài vòng đời BullMQ, delivery log và webhook trạng thái provider, DLQ có retry thủ công, preferences/quiet hours, scheduled delivery, push notification. Các tính năng này chưa được triển khai trong đợt gộp cấu trúc.
