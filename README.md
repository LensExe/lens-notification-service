# Notification Service

Một microservice NestJS chuẩn, chạy một process và một port, đứng sau API Gateway bên ngoài.

## Cấu trúc

```text
src/
  main.ts
  setup.ts                         # Global prefix + validation
  app.module.ts                    # Hạ tầng PostgreSQL/BullMQ, hai context
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
      notification/                # HTTP, WebSocket, worker, Mongo read model
      entity/                      # Repository chỉ thuộc notification
      queue/
test/
  jest-e2e.json
  service.e2e-spec.ts
.env.example
nest-cli.json
package.json
tsconfig.json
tsconfig.build.json
noti-system-docker/                 # Cấu hình hạ tầng phát triển có sẵn
```

Hai context không import lẫn nhau và không export repository. PostgreSQL connection và BullMQ connection là hạ tầng dùng chung; mỗi context đăng ký entity/repository riêng qua forFeature. Mail chỉ xử lý email/template. Notification chỉ xử lý in-app và realtime. Không có gateway HTTP, user management, login, refresh token hoặc proxy nội bộ.

## Chạy

Yêu cầu Node.js 22.13+, pnpm 11.15.1, PostgreSQL, MongoDB, Redis và thông tin provider email. Phiên bản pnpm được cố định trong trường packageManager của package.json.

1. Chạy `pnpm install --frozen-lockfile` (dùng cùng lệnh này trong CI).
2. Tạo `.env` từ `.env.example`, điền public key Keycloak và cấu hình hạ tầng/provider.
3. Với database local mới, có thể bật `DB_SYNCHRONIZE=true`. Mặc định false; môi trường production cần chuẩn bị schema bằng quy trình migration hiện có trước khi chạy.
4. Chạy `pnpm start:dev` hoặc `pnpm build && pnpm start:prod`.

Service mặc định nghe port 3001. Tất cả HTTP endpoint bắt đầu bằng `/api/v1`.
Các job cũ trong Redis DB 1 của mail không tự chuyển sang REDIS_DB mới: drain queue cũ hoặc thực hiện chuyển dữ liệu trước khi cutover. Không chạy đồng thời worker cũ và mới trên cùng queue khi chuyển đổi.

## API

Tất cả endpoint yêu cầu `Authorization: Bearer <Keycloak access token>`.

| Method | Path | Nhiệm vụ |
|---|---|---|
| POST | /api/v1/mail/:jobName/single | Xếp hàng một email, trả 202 |
| POST | /api/v1/mail/:jobName/bulk | Xếp hàng nhiều email, trả 202 |
| GET | /api/v1/mail/templates | Danh sách template |
| POST | /api/v1/mail/templates | Tạo template |
| POST | /api/v1/mail/templates/variable | Thêm biến template |
| GET | /api/v1/mail/job-templates | Danh sách mapping |
| POST | /api/v1/mail/job-templates | Tạo mapping |
| GET | /api/v1/mail/job-templates/records | Đọc mapping đã resolve |
| POST | /api/v1/notifications | Tạo và phát một in-app notification |
| GET | /api/v1/notifications?skip=0&limit=20 | Đọc thông báo của JWT sub |
| POST | /api/v1/notifications/mark-read | Đánh dấu tất cả thông báo của JWT sub đã đọc |

jobName: `send-otp-email`, `send-transactional-email`, `send-welcome-email`.

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

## Keycloak local verification và Gateway

Service chỉ dùng public key PEM cấu hình ở KEYCLOAK_PUBLIC_KEY. Không có JWKS fetch, introspection, userinfo hay HTTP request lên Keycloak. Chỉ chấp nhận RS256, issuer chính xác, audience của service, sub không rỗng, exp hợp lệ và claim typ=Bearer. jsonwebtoken cũng kiểm tra nbf nếu có.

KEYCLOAK_ISSUER phải khớp nguyên văn claim iss, kể cả scheme/hostname/realm. Cấu hình audience mapper/client scope ở Keycloak để access token có aud chứa notification-service (hoặc giá trị KEYCLOAK_AUDIENCE). Dùng public key của realm dưới dạng PEM SPKI; public key không phải client secret. Khi Keycloak đổi signing key, cập nhật cấu hình key và restart service. Verify local không biết token đã logout/revoke trước exp; nên sử dụng access token thời hạn ngắn.

Gateway bên ngoài forward nguyên path /api/v1/... và Authorization header đến service. Không dựa vào X-User-Id hoặc các header identity do client cung cấp. Gateway cần kiểm soát quyền gửi mail/tạo notification/quản lý template; guard hiện thực hiện xác thực JWT, chưa áp dụng role policy cho các thao tác này. Nếu cần bảo vệ quyền độc lập ngay tại service, bổ sung role/scope guard theo policy của hệ thống.

Socket.IO dùng namespace /notification, transport path /api/v1/socket.io. Global prefix của Nest chỉ áp dụng cho HTTP controller nên WebSocket có path riêng được cấu hình rõ ràng. Gateway ngoài cần forward polling và WebSocket upgrade tại path này.

```ts
const socket = io('https://gateway.example.com/notification', {
  path: '/api/v1/socket.io',
  auth: { token: accessToken },
});
socket.on('notification', (payload) => console.log(payload));
```

Server verify JWT trong handshake rồi tự join room theo sub. Không còn event join cho client tự chọn userId. Socket bị ngắt trong khoảng một giây sau exp; client refresh token ở hệ thống đăng nhập rồi reconnect. Redis adapter phân phối event giữa các instance.

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

Notification vẫn ghi PostgreSQL rồi MongoDB như hệ thống cũ; refactor này chưa biến dual-write thành transaction phân tán. Nên ưu tiên Outbox hoặc gom read/write vào PostgreSQL để tránh lệch dữ liệu khi MongoDB lỗi. Retry mail có thể gửi trùng nếu provider nhận thư nhưng worker chưa ghi nhận thành công.

Các ưu tiên tiếp theo: idempotency key, delivery log và webhook trạng thái provider, DLQ có retry thủ công, role/scope authorization, preferences/quiet hours, scheduled delivery, push notification. Các tính năng này chưa được triển khai trong đợt gộp cấu trúc.
