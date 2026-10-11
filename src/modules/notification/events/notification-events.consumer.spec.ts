import { ConfigService } from '@nestjs/config';
import { QueueService } from '../jobs/queue/queue.service';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { NotificationJobName } from '../jobs/queue/enum/job.enum';

type KafkaMessage = { key: Buffer | null; value: Buffer | null; offset: string };
type KafkaSend = { topic: string; messages: Array<{ value: string }> };
type ConsumerInternals = {
  handleMessage: (topic: string, partition: number, message: KafkaMessage) => Promise<void>;
  producer?: { send: jest.Mock };
  dlqTopic?: string;
};

describe('NotificationEventsConsumer', () => {
  const enqueueNotification = jest.fn().mockResolvedValue(undefined);
  let consumer: NotificationEventsConsumer;

  beforeEach(() => {
    enqueueNotification.mockReset().mockResolvedValue(undefined);
    consumer = new NotificationEventsConsumer(new ConfigService(), {
      enqueueNotification,
    } as unknown as QueueService);
  });

  it('routes an emergency notification event into the notification queue with a stable job id', async () => {
    const event = {
      eventId: 'order-service:ORD-123:placed',
      eventType: 'order.created',
      priority: 'emergency',
      notification: {
        userId: 'keycloak-sub-123',
        title: 'Đặt hàng thành công',
        message: 'Đơn hàng ORD-123 đã được tiếp nhận',
        type: 'order_placed',
        data: { orderId: 'ORD-123' },
      },
    };
    const internals = consumer as unknown as ConsumerInternals;

    await internals.handleMessage('notification.events', 0, {
      key: Buffer.from(event.notification.userId),
      value: Buffer.from(JSON.stringify(event)),
      offset: '21',
    });

    expect(enqueueNotification).toHaveBeenCalledWith(
      {
        type: NotificationJobName.EMERGENCY,
        payload: event.notification,
      },
      expect.stringMatching(/^kafka-[a-f0-9]{64}$/),
    );
  });

  it('parks invalid notification events in the configured DLQ', async () => {
    const sentMessages: KafkaSend[] = [];
    const send = jest.fn((message: KafkaSend) => {
      sentMessages.push(message);
      return Promise.resolve();
    });
    const internals = consumer as unknown as ConsumerInternals;
    internals.producer = { send };
    internals.dlqTopic = 'notification.events.dlq';

    await internals.handleMessage('notification.events', 0, {
      key: null,
      value: Buffer.from(JSON.stringify({ eventId: 'missing-fields' })),
      offset: '22',
    });

    expect(enqueueNotification).not.toHaveBeenCalled();
    const sent = sentMessages[0];
    expect(send).toHaveBeenCalledTimes(1);
    if (!sent) throw new Error('Expected a DLQ message');
    expect(sent.topic).toBe('notification.events.dlq');
    expect(sent.messages[0]?.value).toContain('eventType');
  });
});
