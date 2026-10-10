# Chat realtime: delivery, retry và DLQ

## Realtime một instance

Client kết nối WebSocket/Socket.IO trực tiếp tới Notification Service. Socket.IO bắt đầu bằng HTTP handshake rồi thường nâng kết nối lên WebSocket. Hiện giả định chỉ có một Notification Service instance, nên Socket.IO dùng adapter in-memory mặc định: gateway phát trực tiếp tới các socket đang nằm trong process đó, không cần Redis cho chat realtime.

Redis vẫn có thể được dùng bởi BullMQ/queue trong ứng dụng, nhưng không nằm trên luồng Socket.IO chat hiện tại. Khi thêm Notification instance thứ hai, socket của user có thể ở process B trong khi Kafka event được consume ở process A; lúc đó cần adapter dùng chung như Redis Streams để fan-out giữa hai process. Chỉ thêm instance mà không có adapter sẽ khiến event không tới socket ở instance còn lại.

Socket.IO connection recovery bật 120 giây, nhưng state nằm trong bộ nhớ adapter của process; Notification Service restart sẽ làm mất recovery state. Socket.IO `emit()` không đợi client ACK, nên sau reconnect client vẫn cần đồng bộ Chat history.

Giới hạn còn lại: consumer không xác nhận client đã nhận/áp dụng event. Muốn bảo đảm giao nhận tới từng client cần thêm application ACK và durable per-user delivery state; hiện tại realtime là best-effort, còn Chat history là nguồn phục hồi chuẩn.

## Duplicate và ordering

Outbox relay có thể publish trùng nếu Kafka đã nhận event nhưng relay chưa kịp cập nhật Mongo. Consumer cũng có thể phát trùng nếu process dừng trước khi Kafka commit offset. Đây là at-least-once, không phải exactly-once.

Client giữ một tập `event_id` đã áp dụng trong cửa sổ phù hợp, và chỉ áp dụng event khi `aggregate_version` lớn hơn version cuối của channel. Với message update/recall, kiểm tra `revision` và `id`; với message mới, `seq` phát hiện gap. Khi thấy gap hoặc sau reconnect, gọi Chat API lấy canonical history/state. Mỗi channel dùng Kafka key riêng nên Kafka giữ thứ tự trong partition; client vẫn cần version guard vì retry/replay có thể đưa event cũ tới muộn.

## Retry policy và xử lý lỗi

- Chat Service publish mỗi outbox event tối đa 3 lần tổng cộng. Sau đó record chuyển sang `status: "failed"` trong Mongo, giữ nguyên envelope, `event_id`, `partition_key`, `aggregate_version`, `failed_at` và `last_error`. Record không bị xóa; channel khác tiếp tục chạy và channel này có thể tiếp tục qua version kế tiếp.
- Notification Service đưa JSON/schema/type sai vào Kafka DLQ ngay vì retry không sửa được payload.
- Lỗi đồng bộ khi gọi gateway được thử 3 lần, chờ 500ms rồi 1 giây giữa các lần. Nếu vẫn lỗi, consumer gửi raw source message, source topic/partition/offset và lý do vào `chat.conversation.events.v1.dlq`. Chỉ sau Kafka xác nhận ghi DLQ, handler mới hoàn tất để source offset được commit. Nếu không ghi được DLQ, handler lỗi và source event được Kafka thử lại. Đây không phải xác nhận delivery tới client.
- Ngoại lệ: nếu Kafka/DLQ không ghi được, source offset chủ đích không được commit; partition đó có thể đứng cho tới khi DLQ/broker phục hồi. Cảnh báo theo `notification_chat_dlq_write_failures_total` và consumer lag.
- Một lỗi chỉ giữ partition của nó trong tối đa ba lần thử; sau đó được cách ly và partition tiếp tục. Các channel khác trên partition có thể chờ trong thời gian retry ngắn đó. Event bị cách ly có thể tạo version gap; client xử lý bằng history sync.

DLQ là “Dead Letter Queue”: nơi giữ message không xử lý được để source queue không bị chặn mãi. Nó không phải nơi tự sửa hoặc tự replay event. Operator cần xem lý do, khắc phục, rồi quyết định replay hay bỏ qua; replay có thể tạo duplicate hoặc event đến muộn.

## Runbook ngắn

Chat outbox event bị park:

```javascript
db.outbox_events
  .find(
    { status: 'failed' },
    {
      event_id: 1,
      partition_key: 1,
      aggregate_version: 1,
      attempt_count: 1,
      last_error: 1,
      event: 1,
    },
  )
  .sort({ failed_at: 1 });
```

Sau khi kiểm tra lỗi và xác nhận payload cần phát lại, requeue đúng event bằng `event_id`, giữ nguyên `event_id` để client dedupe:

```javascript
db.outbox_events.updateOne(
  { event_id: '<event-id>', status: 'failed' },
  {
    $set: { status: 'pending', attempt_count: 0, next_attempt_at: new Date() },
    $unset: { failed_at: '', last_error: '' },
  },
);
```

Với Kafka DLQ, đọc record, xem `reason` và `rawValue`. Sau khi sửa nguyên nhân/schema, publish event đã sửa lại lên `chat.conversation.events.v1` với đúng Kafka key là `channel_id`; không publish wrapper DLQ. Replayed event có thể tới sau event mới, vì vậy client phải bỏ `aggregate_version` cũ và tải lại history nếu cần.

Metrics hiện có: Chat Service `GET /metrics`; Notification Service `GET /api/v1/metrics`. Chat `/metrics` không yêu cầu JWT nên chỉ cho Prometheus truy cập qua mạng nội bộ. Notification metrics dùng guard Keycloak hiện hành.
