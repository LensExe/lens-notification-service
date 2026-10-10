import { ConfigService } from '@nestjs/config';
import { MailEventsConsumer } from './mail-events.consumer';
import { MailJobName } from './enum/mail.enum';
import { QueueService } from '../queue/queue.service';

type KafkaMessage = { key: Buffer | null; value: Buffer | null; offset: string };
type KafkaSend = { topic: string; messages: Array<{ key: Buffer; value: string }> };
type ConsumerInternals = {
  handleMessage: (topic: string, partition: number, message: KafkaMessage) => Promise<void>;
  producer?: { send: jest.Mock };
  dlqTopic?: string;
};

describe('MailEventsConsumer', () => {
  const enqueueSingle = jest.fn().mockResolvedValue(undefined);
  let consumer: MailEventsConsumer;

  beforeEach(() => {
    enqueueSingle.mockReset().mockResolvedValue(undefined);
    consumer = new MailEventsConsumer(new ConfigService(), {
      enqueueSingle,
    } as unknown as QueueService);
  });

  it('validates an OTP mail command and enqueues a deduplicated single email', async () => {
    const event = {
      eventId: 'core:otp:request-42',
      eventType: 'auth.otp.requested.v1',
      jobName: MailJobName.SEND_OTP,
      to: ' User@Example.com ',
      variables: {
        otpCode: '123456',
        expiresInMinutes: '5',
        appName: 'Lens',
        userName: 'A User',
        year: '2026',
      },
    };
    const internals = consumer as unknown as ConsumerInternals;

    await internals.handleMessage('notification.mail.commands.v1', 0, {
      key: Buffer.from(event.eventId),
      value: Buffer.from(JSON.stringify(event)),
      offset: '11',
    });

    expect(enqueueSingle).toHaveBeenCalledWith(
      MailJobName.SEND_OTP,
      { to: 'user@example.com', variables: event.variables },
      expect.stringMatching(/^mail-kafka-[a-f0-9]{64}$/),
    );
  });

  it('sends an invalid mail command to the DLQ without enqueueing it', async () => {
    const sentMessages: KafkaSend[] = [];
    const send = jest.fn((message: KafkaSend) => {
      sentMessages.push(message);
      return Promise.resolve();
    });
    const internals = consumer as unknown as ConsumerInternals;
    internals.producer = { send };
    internals.dlqTopic = 'notification.mail.commands.v1.dlq';

    await internals.handleMessage('notification.mail.commands.v1', 1, {
      key: Buffer.from('bad-command'),
      value: Buffer.from('{invalid-json'),
      offset: '12',
    });

    expect(enqueueSingle).not.toHaveBeenCalled();
    const sent = sentMessages[0];
    expect(send).toHaveBeenCalledTimes(1);
    if (!sent) throw new Error('Expected a DLQ message');
    expect(sent.topic).toBe('notification.mail.commands.v1.dlq');
    expect(sent.messages[0]?.key).toEqual(Buffer.from('bad-command'));
    expect(sent.messages[0]?.value).toContain('Message is not valid JSON');
  });
});
