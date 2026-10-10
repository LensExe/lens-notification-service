# Notification Service: Chat Events Consumer

## Mục tiêu và quyết định

Tài liệu này mô tả cách Notification Service nhận domain event từ Chat Service và đẩy message realtime tới các client đang kết nối. Message vẫn do Chat Service lưu và quản lý.

Notification Service hiện đã có consumer cho event notification từ `core-backend`. Giữ nguyên consumer đó và topic `notification.events`. Thêm một consumer cho event chat vì event chat là domain event, không phải notification đã được chuẩn bị sẵn để lưu vào inbox.

Phạm vi hiện tại: Chat Service phát create/edit/recall/read-cursor qua transactional outbox; Notification Service là nơi duy nhất phát chat realtime tới client. Nếu user offline, không lưu thêm notification inbox; message/cursor gốc vẫn thuộc Chat Service và client tải lại qua Chat API khi reconnect.

## Luồng Notification Service hiện có

Consumer hiện tại đọc `notification.events`, kiểm tra contract gồm `eventId`, `eventType`, `priority` và `notification.userId/title/message/type/data`, rồi enqueue vào BullMQ. Worker gọi `NotificationService.notifyUser`, lưu notification vào PostgreSQL và MongoDB, sau đó Gateway emit Socket.IO event `notification` vào room của user.

Luồng đó phù hợp với notification cần xuất hiện trong danh sách `/api/v1/notifications`, kể cả khi user offline. Consumer hiện chỉ chấp nhận các notification type đang có như `welcome`, `order_placed`, `payment_success` và `promotion_started`.

Vì vậy, không đưa raw `chat.message.created.v1` vào consumer/topic `notification.events` theo contract hiện tại. Nếu đi qua `notifyUser`, event chat sẽ được lưu khi offline; đồng thời cần thêm notification type và migration cho enum PostgreSQL. Đó là một lựa chọn khác với yêu cầu realtime-only.

## Luồng consumer chat đề xuất

```mermaid
sequenceDiagram
    participant K as Kafka: chat.conversation.events.v1
    participant C as ChatEventsConsumer
    participant G as Socket.IO Gateway
    participant U as User sockets

    K->>C: chat.message.*.v1 / chat.read-cursor.advanced.v1
    C->>C: Validate schema and event type
    C->>G: Emit chat.event to participant rooms
    G->>U: Deliver to sockets on this Notification instance
    Note over G,U: Empty room means no realtime receiver; do not persist for offline user
```

Thêm `ChatEventsConsumer` trong Notification context. Consumer đọc topic chat bằng Kafka consumer group riêng, ví dụ `notification-chat-realtime`. Hiện tại chỉ chạy một Notification Service instance và dùng Socket.IO in-memory adapter mặc định; khi scale nhiều instance, cần bổ sung adapter dùng chung để fan-out tới socket ở process khác.

Giữ consumer hiện tại với cấu hình riêng:

| Consumer                   | Topic                         | Group ID gợi ý                  | Xử lý                                                |
| -------------------------- | ----------------------------- | ------------------------------- | ---------------------------------------------------- |
| NotificationEventsConsumer | `notification.events`         | `notification-service` hiện tại | BullMQ → lưu notification → Socket.IO `notification` |
| ChatEventsConsumer         | `chat.conversation.events.v1` | `notification-chat-realtime`    | Socket.IO `chat.event`, không lưu inbox              |

Không dùng chung group ID nếu hai consumer cần nhận cùng một event. Các consumer trong cùng một group chia event cho nhau; các group khác nhau mỗi group nhận bản sao độc lập.

## Event đầu vào

Consumer nhận các event được Chat Service ghi qua transactional outbox:

- `chat.message.created.v1`
- `chat.message.updated.v1`
- `chat.message.recalled.v1`
- `chat.read-cursor.advanced.v1`

```json
{
  "event_id": "<stable-id>",
  "event_type": "chat.message.created.v1",
  "schema_version": 1,
  "occurred_at": "2026-10-04T10:00:00Z",
  "producer": "chat-service",
  "aggregate_type": "channel",
  "aggregate_id": "<channel-id>",
  "aggregate_version": 55,
  "data": {
    "channel_id": "<channel-id>",
    "participant_ids": ["<sender-sub>", "<peer-sub>"],
    "message": {
      "id": "<message-id>",
      "channel_id": "<channel-id>",
      "sender_id": "<sender-sub>",
      "client_message_id": "<client-message-id>",
      "type": "text",
      "content": "Xin chào",
      "seq": 42,
      "revision": 1,
      "created_at": "2026-10-04T10:00:00Z",
      "updated_at": "2026-10-04T10:00:00Z"
    }
  }
}
```

Message events mang full REST message payload; read cursor dùng `data.channel_id`, `participant_ids`, `user_id` và `last_read_seq`. Kafka key là `channel_id`. `aggregate_version` tăng cho mọi event trong channel. Consumer validate envelope, channel aggregate, Kafka key, participant IDs và payload. Consumer không đọc trực tiếp MongoDB Chat Service.

## Socket.IO và client contract

Notification Gateway dùng namespace `/notification`, transport path `/api/v1/socket.io` và adapter in-memory mặc định của Socket.IO. Chat dùng method riêng `sendChatEvent(userId, payload)`, không trộn với event notification `notification`. Chat event được phát tới room `user:<sub>`; gateway chỉ cho socket đã xác thực join room từ JWT.

Event Socket.IO đề xuất:

- Event name: `chat.event`.
- Payload giữ envelope chat để client có thể dedupe và áp dụng thứ tự:

```json
{
  "event_id": "<stable-id>",
  "event": "NEW_MESSAGE",
  "aggregate_version": 55,
  "payload": {
    "id": "<message-id>",
    "channel_id": "<channel-id>",
    "sender_id": "<sender-sub>",
    "client_message_id": "<client-message-id>",
    "type": "text",
    "content": "Xin chào",
    "seq": 42,
    "revision": 1,
    "created_at": "2026-10-04T10:00:00Z",
    "updated_at": "2026-10-04T10:00:00Z"
  }
}
```

`event` có thể là `NEW_MESSAGE`, `UPDATED_MESSAGE`, `RECALLED_MESSAGE` hoặc `READ_CURSOR`. Message payload cùng shape với REST `MessageResponse`; read cursor payload có `channel_id`, `user_id`, `last_read_seq`. Giữ sender trong recipients để đồng bộ thiết bị khác; sender client cũng có thể nhận event và cần dedupe bằng `event_id`. Nhánh push về sau thường loại sender khỏi recipients.

Gateway kiểm JWT trong handshake. Access token cần có audience `notification-service`; token chỉ có audience `chat-service` sẽ không thỏa verifier. Có thể cấu hình audience cho cả hai service hoặc dùng realtime ticket. Mỗi socket chỉ nhận chat event theo user ID (`sub`) đã xác thực; danh sách participant từ event Chat quyết định user nhận event.

## User offline và phục hồi dữ liệu

Emit tới room rỗng không có socket nhận. Consumer vẫn hoàn tất vì yêu cầu không lưu notification offline. Kafka consumer không biết client đã áp dụng packet hay chưa; realtime là best effort.

Khi reconnect, client gọi Chat API lấy history từ sequence gần nhất đã đồng bộ. Client dùng `seq` và `aggregate_version` phát hiện thiếu event, rồi tải state chuẩn từ history/API. Kafka/outbox không thay thế lịch sử message trong Chat.

Consumer phải chấp nhận duplicate: relay có thể publish lại sau Kafka acknowledgement nhưng trước khi mark outbox; consumer có thể emit lại trước khi offset commit. Stable `event_id` và message ID cho phép client bỏ qua bản lặp. Chat giữ event publish failed trong Mongo; client bỏ version cũ và đồng bộ lại nếu có gap.

## Retry, DLQ và vận hành

- Lỗi JSON/schema hoặc event type không hỗ trợ: gửi nguyên payload cùng lý do vào `chat.conversation.events.v1.dlq`, sau đó mới xác nhận offset nguồn.
- Lỗi đồng bộ khi gọi gateway: retry tối đa ba lần, chờ 500ms rồi 1 giây giữa các lần; nếu vẫn lỗi, ghi raw event và lý do vào chat DLQ rồi tiếp tục partition sau khi DLQ producer xác nhận. Nếu ghi DLQ lỗi, handler throw và Kafka không commit offset; partition có thể đứng đến khi Kafka/DLQ phục hồi. Đây không phải ACK từ client; xem runbook để biết giới hạn delivery best-effort của Socket.IO.
- Socket không có người nhận không phải lỗi hạ tầng và không đưa vào retry queue.
- Chat outbox relay retry Kafka publish tối đa ba lần tổng cộng. Sau đó event vẫn nằm trong Mongo `outbox_events` với `status=failed`, raw payload và `last_error`; channel khác tiếp tục. Operator xem nguyên nhân trước khi replay.
- Theo dõi consumer lag, invalid/DLQ, retry và processing latency. Metrics Notification: `GET /api/v1/metrics`; Chat: `GET /metrics`.
- Socket.IO connection recovery bật 120 giây trong bộ nhớ process; client vẫn cần history sync vì không thể bảo đảm mọi client đã nhận/áp dụng event, và recovery state mất khi process restart.
- Dùng TLS/SASL ACL cho producer Chat và consumer Notification. Hạn chế quyền đọc topic vì payload có thể chứa nội dung chat.

## Mở rộng gửi push mobile

Khi thêm FCM/APNs, tạo nhánh consumer độc lập trên cùng topic với group ID khác, ví dụ `notification-chat-push`. Nhánh push nhận mọi event riêng với realtime consumer; không phụ thuộc vào việc realtime consumer có gửi được WebSocket hay không.

Nhánh push cần thêm:

- Đăng ký, cập nhật và xoá device token theo user/device.
- Dedupe theo `(event_id, user_id, device_id)` hoặc delivery ID bền vững.
- Retry/backoff và DLQ riêng cho provider lỗi; xử lý token hết hạn.
- Quy tắc chỉ push khi offline. Muốn kiểm tra offline giữa nhiều instance cần presence dùng chung (ví dụ Redis TTL); Socket.IO room local không đủ làm nguồn presence. Nếu chấp nhận push bất kể trạng thái online, cần quy tắc client để tránh thông báo trùng khi app đang mở.
- Loại sender khỏi push recipients; chỉ push đến peer của message.

Push consumer mới không nên dùng chung Kafka group ID với `ChatEventsConsumer`, nếu không Kafka sẽ chia event giữa hai nhánh và một số event sẽ chỉ được dùng cho realtime hoặc push, thay vì cả hai.

## Lựa chọn khác: notification inbox bền vững

Nếu sau này muốn message mới cũng xuất hiện trong danh sách notification của Notification Service khi user offline, có thể chuyển event thành notification DTO và dùng lại `notification.events` → BullMQ → `notifyUser`. Khi đó cần thêm `chat_message` vào `NotificationTypeEnum`, migration enum PostgreSQL, quy tắc lưu preview/data và idempotency bền vững. Đây là chế độ lưu in-app notification; nó không còn là “offline thì bỏ qua”.
