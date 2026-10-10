import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { NotificationJobName } from '../queue/enum/job.enum';
import { QueueService } from '../queue/queue.service';
import { NotificationDto } from './dto/notification.dto';
import { NotificationTypeEnum } from './enum/notification.enum';

type NotificationEventPriority = 'instant' | 'emergency';

interface NotificationEvent {
  eventId: string;
  eventType: string;
  priority: NotificationEventPriority;
  notification: NotificationDto;
}

class InvalidNotificationEventError extends Error {}

@Injectable()
export class NotificationEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEventsConsumer.name);
  private consumer?: Consumer;
  private producer?: Producer;
  private dlqTopic?: string;
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly queueService: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.readBoolean('KAFKA_ENABLED', false)) {
      this.logger.log('Kafka event consumer is disabled');
      return;
    }

    const topic = this.config.get<string>('KAFKA_NOTIFICATION_EVENTS_TOPIC', 'notification.events');
    this.dlqTopic = this.config.get<string>('KAFKA_NOTIFICATION_EVENTS_DLQ_TOPIC', `${topic}.dlq`);
    if (topic === this.dlqTopic) {
      throw new Error('Kafka notification topic and DLQ topic must be different');
    }

    const kafka = this.createKafkaClient();
    const consumer = kafka.consumer({
      groupId: this.config.get<string>('KAFKA_GROUP_ID', 'notification-service'),
    });
    const producer = kafka.producer();
    this.consumer = consumer;
    this.producer = producer;

    try {
      await consumer.connect();
      await producer.connect();
      await consumer.subscribe({
        topic,
        fromBeginning: this.readBoolean('KAFKA_FROM_BEGINNING', false),
      });
      await consumer.run({
        eachMessage: async ({ topic: sourceTopic, partition, message }) => {
          await this.handleMessage(sourceTopic, partition, message);
        },
      });
      this.isRunning = true;
      this.logger.log(
        `Consuming Kafka topic ${topic} as ${this.config.get('KAFKA_GROUP_ID', 'notification-service')}`,
      );
    } catch (error) {
      await consumer.disconnect().catch(() => undefined);
      await producer.disconnect().catch(() => undefined);
      this.consumer = undefined;
      this.producer = undefined;
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer && this.isRunning) await this.consumer.stop();
    this.isRunning = false;
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }

  private createKafkaClient(): Kafka {
    const brokers = this.config
      .get<string>('KAFKA_BROKERS', 'localhost:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (brokers.length === 0) throw new Error('KAFKA_BROKERS must contain at least one broker');

    const username = this.config.get<string>('KAFKA_USERNAME');
    const password = this.config.get<string>('KAFKA_PASSWORD');
    if (Boolean(username) !== Boolean(password)) {
      throw new Error('Set both KAFKA_USERNAME and KAFKA_PASSWORD, or leave both unset');
    }

    const sasl =
      username && password ? { mechanism: 'plain' as const, username, password } : undefined;
    return new Kafka({
      clientId: this.config.get<string>('KAFKA_CLIENT_ID', 'notification-service'),
      brokers,
      ssl: this.readBoolean('KAFKA_SSL', false),
      ...(sasl ? { sasl } : {}),
    });
  }

  private async handleMessage(
    topic: string,
    partition: number,
    message: { key: Buffer | null; value: Buffer | null; offset: string },
  ): Promise<void> {
    const rawValue = message.value?.toString('utf8') ?? '';
    let event: NotificationEvent;
    try {
      event = this.parseEvent(rawValue);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.sendToDeadLetterTopic(topic, partition, message, rawValue, reason);
      return;
    }

    await this.queueService.enqueueNotification(
      {
        type:
          event.priority === 'emergency'
            ? NotificationJobName.EMERGENCY
            : NotificationJobName.INSTANT,
        payload: event.notification,
      },
      this.toBullJobId(event.eventId),
    );
    this.logger.log(`Queued Kafka event ${event.eventId} (${event.eventType})`);
  }

  private parseEvent(rawValue: string): NotificationEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue) as unknown;
    } catch {
      throw new InvalidNotificationEventError('Message is not valid JSON');
    }

    if (!this.isRecord(parsed)) {
      throw new InvalidNotificationEventError('Event must be a JSON object');
    }

    const eventId = parsed.eventId;
    const eventType = parsed.eventType;
    const priority = parsed.priority ?? 'instant';
    const rawNotification = parsed.notification;
    if (typeof eventId !== 'string' || eventId.trim().length === 0 || eventId.length > 256) {
      throw new InvalidNotificationEventError(
        'eventId must be a non-empty string up to 256 characters',
      );
    }
    if (typeof eventType !== 'string' || eventType.trim().length === 0 || eventType.length > 128) {
      throw new InvalidNotificationEventError(
        'eventType must be a non-empty string up to 128 characters',
      );
    }
    if (priority !== 'instant' && priority !== 'emergency') {
      throw new InvalidNotificationEventError('priority must be "instant" or "emergency"');
    }
    if (!this.isRecord(rawNotification)) {
      throw new InvalidNotificationEventError('notification must be a JSON object');
    }

    const notification = new NotificationDto();
    notification.userId = rawNotification.userId as string;
    notification.title = rawNotification.title as string;
    notification.message = rawNotification.message as string;
    notification.type = rawNotification.type as string;
    if (Object.hasOwn(rawNotification, 'data')) {
      notification.data = rawNotification.data;
    }

    const stringFields: Array<
      keyof Pick<NotificationDto, 'userId' | 'title' | 'message' | 'type'>
    > = ['userId', 'title', 'message', 'type'];
    for (const field of stringFields) {
      const value: unknown = notification[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new InvalidNotificationEventError(`notification.${field} must be a non-empty string`);
      }
    }
    if (!Object.values(NotificationTypeEnum).includes(notification.type as NotificationTypeEnum)) {
      throw new InvalidNotificationEventError(
        `Unsupported notification type: ${notification.type}`,
      );
    }
    if (
      notification.data !== undefined &&
      notification.data !== null &&
      (typeof notification.data !== 'object' || Array.isArray(notification.data))
    ) {
      throw new InvalidNotificationEventError('notification.data must be an object or null');
    }

    return { eventId: eventId.trim(), eventType: eventType.trim(), priority, notification };
  }

  private async sendToDeadLetterTopic(
    sourceTopic: string,
    partition: number,
    message: { key: Buffer | null; value: Buffer | null; offset: string },
    rawValue: string,
    reason: string,
  ): Promise<void> {
    if (!this.producer || !this.dlqTopic) throw new Error('Kafka DLQ producer is not connected');

    await this.producer.send({
      topic: this.dlqTopic,
      messages: [
        {
          key: message.key ?? Buffer.from(`${sourceTopic}-${partition}-${message.offset}`),
          value: JSON.stringify({
            sourceTopic,
            sourcePartition: partition,
            sourceOffset: message.offset,
            receivedAt: new Date().toISOString(),
            reason,
            rawValue,
          }),
        },
      ],
    });
    this.logger.warn(
      `Moved invalid Kafka event from ${sourceTopic}[${partition}]@${message.offset} to ${this.dlqTopic}: ${reason}`,
    );
  }

  private toBullJobId(eventId: string): string {
    return `kafka-${createHash('sha256').update(eventId).digest('hex')}`;
  }

  private readBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.config.get<string>(key);
    if (value === undefined) return defaultValue;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    throw new Error(`${key} must be true or false`);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
