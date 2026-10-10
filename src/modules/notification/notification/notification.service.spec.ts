import { Notification } from '../entity/notification.entity';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationReadModel } from './schemas/notification-read.schema';
import { Repository } from 'typeorm';
import { Model } from 'mongoose';

type ReadModelUpdate = [
  { source_notification_id: string },
  { $set: Record<string, unknown> },
  { upsert: boolean },
];

describe('NotificationService realtime delivery', () => {
  it('persists the notification read model and emits the user event', async () => {
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
    const repository = {
      create: jest.fn((input: Partial<Notification>) => input),
      save: jest.fn().mockResolvedValue(notification),
    };
    const updates: ReadModelUpdate[] = [];
    const updateOne = jest.fn(
      (filter: ReadModelUpdate[0], update: ReadModelUpdate[1], options: ReadModelUpdate[2]) => {
        updates.push([filter, update, options]);
        return Promise.resolve();
      },
    );
    const gateway = { sendNotification: jest.fn() };
    const service = new NotificationService(
      gateway as unknown as NotificationGateway,
      repository as unknown as Repository<Notification>,
      { collection: { updateOne } } as unknown as Model<NotificationReadModel>,
    );

    const saved = await service.notifyUser({
      userId: 'keycloak-user-123',
      title: 'Đặt hàng thành công',
      message: 'Đơn hàng ORD-123 đã được tiếp nhận',
      type: 'order_placed',
      data: { orderId: 'ORD-123' },
    });

    expect(saved).toBe(notification);
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = updates[0] ?? [];
    expect(filter).toEqual({ source_notification_id: 'notification-123' });
    expect(update?.$set).toMatchObject({
      user_id: 'keycloak-user-123',
      title: 'Đặt hàng thành công',
      is_read: false,
    });
    expect(options).toEqual({ upsert: true });
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
