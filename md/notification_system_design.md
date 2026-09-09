# Phân tích & Thiết kế Kiến trúc: Notification & Event Processing Platform

"Xây dựng hệ thống xử lý sự kiện và gửi thông báo đa kênh (email, SMS, push notification) cho các ứng dụng thương mại điện tử. Hệ thống hỗ trợ retry, distributed job processing và đảm bảo độ tin cậy khi gửi thông báo số lượng lớn."

## 1. Tổng quan hệ thống (Overview)

Nền tảng xử lý sự kiện và gửi thông báo đa kênh (Email, SMS, Push Notification, In-App/Real-time) dành cho các hệ thống thương mại điện tử (E-commerce). Hệ thống đóng vai trò như một dịch vụ trung tâm (centralized service) để nhận các sự kiện từ nhiều microservices khác (Order, Authentication, Promotion, v.v.), sau đó định tuyến, xây dựng nội dung (template rendering) và phân phối thông báo đến người dùng thông qua các nhà cung cấp bên thứ ba (SendGrid, Twilio, Firebase, v.v.) cũng như qua hệ thống WebSocket/SSE thời gian thực nội bộ.

## 2. Phân tích Yêu cầu (Requirements)

### 2.1 Yêu cầu Chức năng (Functional Requirements)

- **Tiếp nhận sự kiện (Event Ingestion):** Nhận sự kiện từ các services khác (ví dụ: `order_placed`, `payment_success`, `promotion_started`).
- **Phân loại & Định tuyến (Routing):** Xác định kênh gửi nội dung phù hợp (Email, SMS, Push) dựa trên sự kiện và cài đặt của người dùng (User Preferences).
- **Quản lý Template:** Hỗ trợ render nội dung thông báo dựa trên các template có sẵn (ví dụ: Handlebars, EJS) với dữ liệu động (dynamic data).
- **Giao tiếp Đa kênh (Multi-channel Delivery):** Tích hợp với nhiều providers (SendGrid/SES cho Email, Twilio/Nexmo cho SMS, FCM/APNs cho Push) và hệ thống In-App Notification thời gian thực (Real-time).
- **Kiểm soát Tần suất (Rate Limiting):** Tránh spam và tuân thủ giới hạn (quota) của các providers.
- **Tiến trình Hàng loạt (Bulk Processing):** Hỗ trợ gửi thông báo số lượng lớn (ví dụ: chiến dịch Marketing) mà không làm tắc nghẽn các thông báo giao dịch (Transactional notifications).

### 2.2 Yêu cầu Phi chức năng (Non-Functional Requirements)

- **Độ tin cậy cao (High Reliability):** Đảm bảo không mất thông báo (No message loss), cần cơ chế Retry và Dead Letter Queue (DLQ).
- **Tính khả dụng cao & Khả năng mở rộng (High Availability & Scalability):** Hệ thống có thể scale ngang (horizontal scaling) khi lượng sự kiện tăng đột biến (ví dụ: dịp Flash Sale).
- **Tính lũy đẳng (Idempotency):** Đảm bảo một sự kiện không gửi trùng lặp thông báo nhiều lần (At-least-once hoặc Exactly-once delivery semantics).
- **Khả năng quan sát (Observability):** Logging, Monitoring, Tracking trạng thái gửi (Sent, Delivered, Read, Bounced).

## 3. Kiến trúc Tổng thể (High-level Architecture)

Hệ thống sẽ được thiết kế theo kiến trúc **Event-Driven Architecture** kết hợp với **Distributed Task Queue**.

### Các thành phần chính:

1. **API Gateway / Ingestion API:** Cổng giao tiếp cho các internal/external services đẩy sự kiện vào hệ thống (thông qua REST/gRPC hoặc đẩy thẳng vào Message Broker).
2. **Message Broker (Kafka):** Đóng vai trò làm buffer để chứa các sự kiện đến, giúp tách rời (decouple) hệ thống sinh sự kiện (Producers) và hệ thống xử lý (Consumers), đảm bảo không mất dữ liệu khi lưu lượng tăng đột biến.
3. **Notification Router & Rule Engine:** Đọc sự kiện từ Broker, kiểm tra User Preferences (người dùng có bật kênh này không?), quyết định kênh gửi, áp dụng Rate Limiting.
4. **Template Engine Service:** Lấy template tương ứng từ Database, render nội dung cuối cùng dựa vào payload của sự kiện.
5. **Distributed Job Workers (ví dụ: Kafka Consumers):** Nhận các job gửi thông báo đã được chuẩn bị và thực thi giao tiếp với API của 3rd-party Providers hoặc đẩy thông báo tới Server Thời gian thực (Real-time).
6. **Real-time Server (WebSocket / Socket.io / SSE):** Nhận thông báo In-App từ Workers (thông qua Redis Pub/Sub) và đẩy trực tiếp (push) lên màn hình người dùng ngay lập tức.
7. **Retry & Dead Letter Worker:** Xử lý các thông báo gửi lỗi (do provider timeout, lỗi mạng), gửi lại theo cơ chế Exponential Backoff.
8. **Database & Caching:**
   - **DB:** Lưu trữ User Preferences, Notification Logs, In-App Notifications (trạng thái đọc/chưa đọc), Templates.
   - **Cache (Redis):** Lưu Rate limits, Idempotency keys, Caching templates, và Connection mapping của WebSocket (quản lý trạng thái user đang online).

## 4. Thiết kế Chi tiết & Các bước triển khai (Action Items)

Để xây dựng hệ thống này, dưới đây là danh sách các hạng mục công việc (To-Do List) bạn cần triển khai cho đồ án/project:

### Bước 1: Thiết kế Cơ sở dữ liệu (Database Design)

- [ ] Thiết kế bảng `Users_Preferences`: Lưu trữ cấu hình nhận/từ chối thông báo (Opt-in/Opt-out) theo từng kênh.
- [ ] Thiết kế bảng `Templates`: id, event_type, channel, subject_template, body_template.
- [ ] Thiết kế bảng `Notification_Logs`: Lưu trữ lịch sử (id, user_id, channel, status: `PENDING, SENT, FAILED, DELIVERED`, provider_response).
- [ ] Thiết kế bảng `In_App_Notifications`: Lưu trữ thông báo trên hệ thống nội bộ (id, user_id, title, content, is_read, read_at, created_at) để user có thể xem lại khi mở app.
- [ ] Thiết kế logic lưu trữ Idempotency Key trên Redis (TTL 24h hoặc 7 days).

### Bước 2: Xây dựng Ingestion & Router

- [ ] Xây dựng REST API endpoint (Express.js/NestJS): `POST /api/v1/events`.
- [ ] Triển khai Message Broker (khuyến nghị dùng RabbitMQ cho định tuyến linh hoạt hoặc Kafka nếu cần replayability với high throughput).
- [ ] Xây dựng Consumer lấy message từ Queue, kiểm tra User Preferences.

### Bước 3: Triển khai Worker Xử lý & Tích hợp (Delivery Workers)

- [ ] Thiết lập Queue chuyên biệt cho từng kênh (Email Queue, SMS Queue, Push Queue, In-App Queue) để hạn chế lỗi kênh này ảnh hưởng kênh khác (Bulkhead Pattern).
- [ ] Xây dựng `EmailWorker`: Tích hợp SendGrid / AWS SES.
- [ ] Xây dựng `SMSWorker`: Tích hợp Twilio.
- [ ] Xây dựng `PushWorker`: Tích hợp Firebase Cloud Messaging (FCM).
- [ ] Xây dựng `InAppWorker` & `Real-time Server`: Dùng WebSocket (ví dụ `Socket.io`) và Redis Pub/Sub để phát thông báo tới ngay thiết bị của user đang online.

### Bước 4: Đảm bảo Độ tin cậy (Reliability Features)

- [ ] Triển khai cơ chế Retry: Sử dụng **Exponential Backoff** cho các lỗi có thể thử lại được (Transient errors như 5xx, timeout).
- [ ] Triển khai **Dead Letter Queue (DLQ)**: Cho các lỗi không thể cứu vãn (như sai số điện thoại, mail không tồn tại 4xx) để sau này audit/alert.
- [ ] Triển khai logic Idempotency: Kiểm tra event_id hoặc idempotency_key trong Redis trước khi xử lý job.

### Bước 5: Giám sát và Báo cáo (Observability)

- [ ] Tích hợp Webhooks từ các nhà cung cấp (Twilio, SendGrid) để cập nhật trạng thái `DELIVERED`, `READ`, `BOUNCED` vào DB.
- [ ] Xây dựng API thống kê: Số lượng thông báo gửi thành công/thất bại theo thời gian.
- [ ] (Tùy chọn) Tích hợp Prometheus/Grafana để theo dõi độ trễ của queue, số lượng messages trong queue.

## 5. Những vấn đề hệ thống (System Design Trade-offs & Considerations) cần lưu ý khi phỏng vấn/bảo vệ đồ án

- **Kafka vs RabbitMQ:** Tại sao bạn chọn 1 trong 2? (Gợi ý: RabbitMQ rất mạnh ở routing, pub/sub và Delayed Message cho việc Retry. Kafka mạnh cho High Throughput và Event Sourcing bảo lưu dữ liệu).
- **Throttling/Rate Limiting của bên thứ 3 (Provider Quota):** Cần dùng thuật toán Token Bucket hoặc Redis Rate Limiting để giới hạn tốc độ gửi nhằm tuân thủ API limits của bên thứ 3 (ví dụ: Twilio giới hạn gọi API).
- **Bulk Notification vs Transactional:** Cần tách ra 2 cụm Queue khác nhau (ví dụ: Ưu tiên cao cho OTP/Giao dịch mua hàng, Ưu tiên thấp cho Marketing Campaign) để không xảy ra hiện tượng "Noisy Neighbor" (chiến dịch Marketing làm tắc nghẽn OTP của người dùng).
- **Scale WebSocket Server cho Real-time Notifications:** Khi có số lượng kết nối khổng lồ, một instance WebSocket không gánh nổi thì cần scale ngang qua Load Balancer. Khi đó, cần xử lý logic truyền tải message trong cluster (Backplane) – phổ biến nhất là sử dụng Redis Pub/Sub để phát thông điệp tới mọi instance đảm bảo user kết nối với instance nào cũng nhận được thông báo.
