import { Notification, NotificationDocument } from './entity/notification.entity';
import { NotificationGateway } from '../realtime/notification.gateway';
import { NotificationService } from './notification.service';
import { Model } from 'mongoose';

describe('NotificationService realtime delivery', () => {
  it('persists the notification in MongoDB and emits the user event', async () => {
    const createdAt = new Date('2026-10-10T03:00:00.000Z');
    const notification = {
      id: 'notification-123',
      user_id: 'keycloak-user-123',
      title: 'Đặt hàng thành công',
      content: 'Đơn hàng ORD-123 đã được tiếp nhận',
      type: 'order_placed',
      data: { orderId: 'ORD-123' },
      is_read: false,
      created_at: createdAt,
      updated_at: createdAt,
    } as Notification;
    const notificationModel = {
      create: jest.fn().mockResolvedValue({ toObject: () => notification }),
    };
    const gateway = { sendNotification: jest.fn() };
    const service = new NotificationService(
      gateway as unknown as NotificationGateway,
      notificationModel as unknown as Model<NotificationDocument>,
    );

    const saved = await service.notifyUser({
      userId: 'keycloak-user-123',
      title: 'Đặt hàng thành công',
      message: 'Đơn hàng ORD-123 đã được tiếp nhận',
      type: 'order_placed',
      data: { orderId: 'ORD-123' },
    });

    expect(saved).toBe(notification);
    expect(gateway.sendNotification).toHaveBeenCalledWith('keycloak-user-123', {
      id: 'notification-123',
      title: 'Đặt hàng thành công',
      message: 'Đơn hàng ORD-123 đã được tiếp nhận',
      type: 'order_placed',
      data: { orderId: 'ORD-123' },
      created_at: createdAt,
    });
  });
});
