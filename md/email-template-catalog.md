# Email templates cho các luồng email của user

Các template MJML nằm trong `src/modules/mail/template/mjml`. Mỗi template được seed vào MongoDB cùng một `jobName` riêng, vì vậy queue có thể tự resolve đúng template mặc định khi API không truyền `template_id`.

| Nghiệp vụ            | `template_type`      | `jobName`                       |
| -------------------- | -------------------- | ------------------------------- |
| OTP xác thực         | `otp`                | `send-otp-email`                |
| Chào mừng tài khoản  | `welcome`            | `send-welcome-email`            |
| Đặt lại mật khẩu     | `reset_password`     | `send-password-reset-email`     |
| Xác nhận đơn hàng    | `order_confirmation` | `send-order-confirmation-email` |
| Biên nhận thanh toán | `payment_receipt`    | `send-payment-receipt-email`    |
| Cập nhật vận chuyển  | `shipping_update`    | `send-shipping-update-email`    |
| Gửi ưu đãi hàng loạt | `promotion_campaign` | `send-promotion-email`          |

`send-transactional-email` vẫn được giữ cho các template tùy biến truyền bằng `template_id`; các template có sẵn đều dùng mapping riêng ở trên. Subject hỗ trợ biến Handlebars như nội dung email.

## Cài template vào database

Sau khi các bảng template đã được tạo, chạy:

```sh
pnpm build
pnpm seed:email-templates
```

Seeder đọc `MONGO_URI` và `MONGO_DB_NAME` từ môi trường hoặc `.env`, kiểm tra cú pháp MJML, rồi tạo/cập nhật template và danh sách biến bắt buộc. Seeder không gửi email. Các mapping job-template hiện có được giữ nguyên; mapping mới được thêm khi chưa tồn tại. Khởi động lại notification-service sau khi seed để xóa cache mapping job-template đang nằm trong bộ nhớ.

## Gửi một email

Các biến trong danh sách của mỗi template đều bắt buộc. Giá trị gửi qua API phải là chuỗi.

**OTP** (`otp.mjml`): `appName`, `userName`, `otpCode`, `expiresInMinutes`, `year`.

**Chào mừng** (`welcome.mjml`): `appName`, `userName`, `loginUrl`, `supportEmail`, `year`.

**Đặt lại mật khẩu** (`password-reset.mjml`): `appName`, `userName`, `resetUrl`, `expiresInMinutes`, `supportEmail`, `year`.

**Xác nhận đơn hàng** (`order-confirmation.mjml`): `appName`, `customerName`, `orderNumber`, `orderDate`, `subtotal`, `shippingFee`, `totalAmount`, `currency`, `orderUrl`, `supportEmail`, `year`.

**Biên nhận thanh toán** (`payment-receipt.mjml`): `appName`, `customerName`, `orderNumber`, `amount`, `currency`, `paymentDate`, `paymentMethod`, `transactionId`, `receiptUrl`, `supportEmail`, `year`.

**Cập nhật giao hàng** (`shipping-update.mjml`): `appName`, `customerName`, `orderNumber`, `shipmentStatus`, `carrierName`, `trackingNumber`, `estimatedDeliveryDate`, `trackingUrl`, `supportEmail`, `year`.

**Chiến dịch ưu đãi** (`promotion-campaign.mjml`): `appName`, `customerName`, `campaignTitle`, `discountLabel`, `promotionDescription`, `promoCode`, `expiryDate`, `promotionUrl`, `unsubscribeUrl`, `supportEmail`, `year`.

Ví dụ gửi email xác nhận đơn:

```http
POST /api/v1/mail/send-order-confirmation-email/single
Authorization: Bearer <admin access token>
Content-Type: application/json
```

```json
{
  "to": "customer@example.com",
  "variables": {
    "appName": "Lens",
    "customerName": "Nguyễn Văn A",
    "orderNumber": "ORD-123",
    "orderDate": "10/10/2026",
    "subtotal": "1.200.000",
    "shippingFee": "30.000",
    "totalAmount": "1.230.000",
    "currency": "VND",
    "orderUrl": "https://shop.example.com/orders/ORD-123",
    "supportEmail": "support@example.com",
    "year": "2026"
  }
}
```

## Gửi chiến dịch hàng loạt

Gọi bulk endpoint một lần; queue tạo một job cho mỗi recipient và áp dụng rate limit riêng. `campaignId` ổn định giúp BullMQ nhận diện lần enqueue lặp lại. Endpoint nhận tối đa 1.000 recipient mỗi request.

```http
POST /api/v1/mail/send-promotion-email/bulk
Authorization: Bearer <admin access token>
Content-Type: application/json
```

```json
{
  "campaignId": "summer-sale-2026",
  "recipients": [
    {
      "to": "customer-1@example.com",
      "variables": {
        "appName": "Lens",
        "customerName": "Nguyễn Văn A",
        "campaignTitle": "Ưu đãi mùa hè",
        "discountLabel": "Giảm 20%",
        "promotionDescription": "Ưu đãi áp dụng cho các sản phẩm được chọn.",
        "promoCode": "SUMMER20",
        "expiryDate": "31/10/2026",
        "promotionUrl": "https://shop.example.com/promotions/summer",
        "unsubscribeUrl": "https://shop.example.com/email-preferences/unsubscribe?token=<recipient-token>",
        "supportEmail": "support@example.com",
        "year": "2026"
      }
    }
  ]
}
```

Thay `customer-1@example.com` và token hủy đăng ký bằng dữ liệu của từng recipient; không gửi cùng một URL unsubscribe dùng chung cho cả danh sách. Gửi chiến dịch thật cần cấu hình `unsubscribeUrl` tới preference center của ứng dụng.
