# Hướng dẫn gửi notification event lên Kafka

Tài liệu này dành cho microservice phát sinh sự kiện, ví dụ Order Service hoặc Payment Service. Service phát event lên Kafka; `notification-service` nhận event, đưa notification vào BullMQ, lưu vào database và đẩy realtime qua Socket.IO.

## 1. Luồng xử lý

```text
Order/Payment Service
        │ publish JSON
        ▼
Kafka: notification.events
        │ consume
        ▼
notification-service → BullMQ → PostgreSQL/MongoDB → Socket.IO → user
```

Producer phải gửi payload notification đã có `userId`, `title`, `message` và `type`. Consumer hiện không nhận event nghiệp vụ thô rồi tự render template.

## 2. Chuẩn bị Kafka và notification-service

Khởi động Kafka local và Kafka UI từ thư mục gốc repository:

```sh
docker compose -f ../lens-backend/.docker/notification-system/compose.yaml up -d kafka kafka-ui
```

Trong Kafka UI tại `http://localhost:8080`, tạo các topic sau, mỗi topic 1 partition và replication factor 1 cho local:

- `notification.events`
- `notification.events.dlq`

Kafka config hiện tắt tự tạo topic. Bật consumer của notification-service bằng cách thêm vào `.env`:

```dotenv
KAFKA_ENABLED=true
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=notification-service
KAFKA_GROUP_ID=notification-service
KAFKA_NOTIFICATION_EVENTS_TOPIC=notification.events
KAFKA_NOTIFICATION_EVENTS_DLQ_TOPIC=notification.events.dlq
KAFKA_FROM_BEGINNING=false
KAFKA_USERNAME=kafka
KAFKA_PASSWORD=kafka-secret-password
KAFKA_SSL=false
```

Khởi động notification-service sau khi tạo topic. Với group ID mới và `KAFKA_FROM_BEGINNING=false`, consumer chỉ đọc event mới từ lúc nó chạy. Để replay event còn lưu, bật `KAFKA_FROM_BEGINNING=true` cùng một group ID mới; biến này không tua lại offset đã commit của group đang dùng.

Địa chỉ broker cần khớp nơi producer chạy:

| Nơi chạy producer | `KAFKA_BROKERS` | Xác thực local |
|---|---|---|
| Trực tiếp trên máy host | `localhost:9092` | SASL PLAIN, user `kafka` |
| Container cùng Docker network với Kafka | `kafka:9094` | listener nội bộ PLAINTEXT |
| Container khác kết nối qua host | `host.docker.internal:19092` | SASL PLAIN, user `kafka` |

Trong production, dùng broker, ACL, SASL credentials và TLS của môi trường triển khai; không dùng password local ở trên.

## 3. Event contract

Mỗi Kafka message value là một JSON object:

```json
{
  "eventId": "order-service:ORD-123:order-placed",
  "eventType": "order.created",
  "priority": "instant",
  "notification": {
    "userId": "<keycloak-sub> của người nhận",
    "title": "Đặt hàng thành công",
    "message": "Đơn hàng ORD-123 đã được tiếp nhận",
    "type": "order_placed",
    "data": {
      "orderId": "ORD-123"
    }
  }
}
```

Các trường:

- `eventId`: ID ổn định, duy nhất cho một sự kiện. Khi retry phải gửi lại cùng ID, không tạo ID mới. Ví dụ `order-service:<orderId>:order-placed`.
- `eventType`: tên sự kiện nguồn để log/đối chiếu, ví dụ `order.created` hoặc `payment.succeeded`.
- `priority`: `instant` hoặc `emergency`; có thể bỏ qua và mặc định là `instant`.
- `notification.userId`: Keycloak `sub` của user; không phải email, username hay ID của order.
- `notification.type`: hiện chỉ nhận `welcome`, `order_placed`, `payment_success`, `promotion_started`.
- `notification.data`: object tuỳ chọn để frontend dùng khi nhận notification.

Event sai JSON hoặc không đúng contract được chuyển sang topic DLQ. Lỗi tạm thời khi notification-service enqueue vào BullMQ sẽ làm message được Kafka gửi lại. Cùng `eventId` được dùng để tạo BullMQ job ID, giúp tránh enqueue trùng khi job vẫn còn được lưu trong queue.

## 4. Gửi event bằng KafkaJS

Trong microservice Node.js, cài KafkaJS:

```sh
pnpm add kafkajs
```

Tạo Kafka producer và gửi event sau khi nghiệp vụ thành công:

```ts
import { Kafka } from 'kafkajs';

const username = process.env.KAFKA_USERNAME;
const password = process.env.KAFKA_PASSWORD;
const sasl =
  username && password ? { mechanism: 'plain' as const, username, password } : undefined;

const kafka = new Kafka({
  clientId: 'order-service',
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim()),
  ...(sasl ? { sasl } : {}),
  ssl: process.env.KAFKA_SSL === 'true',
});

const producer = kafka.producer();
await producer.connect();

const event = {
  eventId: `order-service:${order.id}:order-placed`,
  eventType: 'order.created',
  priority: 'instant',
  notification: {
    userId: order.userId, // Keycloak sub
    title: 'Đặt hàng thành công',
    message: `Đơn hàng ${order.id} đã được tiếp nhận`,
    type: 'order_placed',
    data: { orderId: order.id },
  },
};

await producer.send({
  topic: 'notification.events',
  messages: [
    {
      // Key theo user để event của cùng user vào cùng partition.
      key: event.notification.userId,
      value: JSON.stringify(event),
    },
  ],
});
```

Trong service chạy liên tục, tạo/kết nối producer một lần khi ứng dụng khởi động, tái sử dụng cho các event, rồi gọi `producer.disconnect()` khi ứng dụng dừng. Không tạo connection mới cho mỗi request. Chỉ báo publish thành công sau khi `producer.send()` hoàn tất.

Nếu database commit và Kafka publish cần được bảo đảm cùng nhau, dùng Transactional Outbox: ghi event vào outbox trong transaction nghiệp vụ rồi có worker riêng publish outbox lên Kafka. Nếu publish trực tiếp sau database commit, process có thể dừng giữa hai bước.

## 5. Kiểm tra notification realtime

Kết nối client tới Socket.IO namespace `/notification` với JWT access token. Notification-service xác thực token và đưa socket vào room theo `sub`. Lắng nghe event `notification`:

```ts
const socket = io('http://localhost:3001/notification', {
  path: '/api/v1/socket.io',
  auth: { token: accessToken },
});

socket.on('notification', (payload) => {
  console.log('Notification realtime:', payload);
});
```

Gửi một event trong khi notification-service đang chạy. Log consumer sẽ ghi nhận event được enqueue; sau đó client đúng `userId` sẽ nhận payload `notification`. Chi tiết Socket.IO và đường dẫn sau API Gateway có trong [README](../README.md#keycloak-local-verification-và-gateway).

## 6. Hạn chế giao nhận

Kafka và BullMQ hiện dùng at-least-once delivery. `eventId` giúp chống enqueue trùng trong lúc BullMQ còn lưu job tương ứng, nhưng đây chưa phải bảo đảm exactly-once vĩnh viễn. PostgreSQL và MongoDB cũng là hai lần ghi riêng trong luồng notification hiện tại.
