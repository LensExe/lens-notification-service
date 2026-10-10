import { ConfigService } from '@nestjs/config';
import { NotificationGateway } from './notification.gateway';
import { ChatEventsConsumer } from './chat-events.consumer';
import { RealtimeTelemetry } from './realtime-telemetry';

type KafkaMessage = {
  key: Buffer | null;
  value: Buffer | null;
  offset: string;
};

type ConsumerInternals = {
  handleMessage: (topic: string, partition: number, message: KafkaMessage) => Promise<void>;
  producer?: { send: jest.Mock };
  dlqTopic?: string;
};

type KafkaSend = {
  topic: string;
  messages: Array<{ key: Buffer; value: string }>;
};

describe('ChatEventsConsumer', () => {
  const sendChatEvent = jest.fn();
  let consumer: ChatEventsConsumer;

  const validEvent = {
    event_id: 'event-1',
    event_type: 'chat.message.created.v1',
    schema_version: 1,
    occurred_at: '2026-10-04T10:00:00.000Z',
    producer: 'chat-service',
    aggregate_type: 'channel',
    aggregate_id: 'channel-1',
    aggregate_version: 42,
    data: {
      channel_id: 'channel-1',
      participant_ids: ['user-1', 'user-2'],
      message: {
        id: 'message-1',
        channel_id: 'channel-1',
        sender_id: 'user-1',
        client_message_id: 'client-message-1',
        type: 'text',
        content: 'Xin chào',
        seq: 42,
        revision: 1,
        created_at: '2026-10-04T10:00:00.000Z',
        updated_at: '2026-10-04T10:00:00.000Z',
      },
    },
  };

  beforeEach(() => {
    sendChatEvent.mockReset();
    consumer = new ChatEventsConsumer(
      new ConfigService(),
      {
        sendChatEvent,
      } as unknown as NotificationGateway,
      {
        increment: jest.fn(),
        observeProcessing: jest.fn(),
        setConsumerConnected: jest.fn(),
        setConsumerLag: jest.fn(),
      } as unknown as RealtimeTelemetry,
    );
  });

  it('relays a valid event to every participant without persistence', async () => {
    const internals = consumer as unknown as ConsumerInternals;
    await internals.handleMessage('chat.conversation.events.v1', 0, {
      key: Buffer.from('channel-1'),
      value: Buffer.from(JSON.stringify(validEvent)),
      offset: '7',
    });

    expect(sendChatEvent).toHaveBeenCalledTimes(2);
    expect(sendChatEvent).toHaveBeenNthCalledWith(1, 'user-1', {
      event_id: 'event-1',
      event: 'NEW_MESSAGE',
      aggregate_version: 42,
      payload: {
        id: 'message-1',
        channel_id: 'channel-1',
        sender_id: 'user-1',
        client_message_id: 'client-message-1',
        type: 'text',
        content: 'Xin chào',
        seq: 42,
        revision: 1,
        created_at: '2026-10-04T10:00:00.000Z',
        updated_at: '2026-10-04T10:00:00.000Z',
      },
    });
    expect(sendChatEvent).toHaveBeenNthCalledWith(2, 'user-2', expect.any(Object));
  });

  it('sends invalid events to the chat DLQ and allows the source offset to commit', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const internals = consumer as unknown as ConsumerInternals;
    internals.producer = { send };
    internals.dlqTopic = 'chat.conversation.events.v1.dlq';

    await internals.handleMessage('chat.conversation.events.v1', 2, {
      key: Buffer.from('wrong-channel'),
      value: Buffer.from(JSON.stringify(validEvent)),
      offset: '9',
    });

    expect(sendChatEvent).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    const typedSend = send as unknown as jest.Mock<Promise<void>, [KafkaSend]>;
    const sent = typedSend.mock.calls[0]?.[0];
    expect(sent.topic).toBe('chat.conversation.events.v1.dlq');
    expect(sent.messages[0]?.key).toEqual(Buffer.from('wrong-channel'));
    expect(sent.messages[0]?.value).toContain('Kafka key must equal data.channel_id');
  });

  it('rethrows DLQ failures so Kafka retries the invalid event', async () => {
    const send = jest.fn().mockRejectedValue(new Error('broker unavailable'));
    const internals = consumer as unknown as ConsumerInternals;
    internals.producer = { send };
    internals.dlqTopic = 'chat.conversation.events.v1.dlq';

    await expect(
      internals.handleMessage('chat.conversation.events.v1', 0, {
        key: Buffer.from('channel-1'),
        value: Buffer.from('{invalid-json'),
        offset: '10',
      }),
    ).rejects.toThrow('broker unavailable');
  });
});
