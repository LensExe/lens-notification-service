import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { QueueService } from '../queue/queue.service';
import { MailJobName } from './enum/mail.enum';
import type { SendSingleMailDto } from './dto/send-mail.dto';

interface MailCommand {
  eventId: string;
  eventType: 'auth.otp.requested.v1';
  jobName: 'send-otp-email';
  to: string;
  variables: Record<string, string>;
}

type KafkaMessage = {
  key: Buffer | null;
  value: Buffer | null;
  offset: string;
};

class InvalidMailCommandError extends Error {}

/** Consumes internal transactional email commands from Core. */
@Injectable()
export class MailEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailEventsConsumer.name);
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
      this.logger.log('Kafka mail command consumer is disabled');
      return;
    }

    const topic = this.config.get<string>(
      'KAFKA_MAIL_COMMANDS_TOPIC',
      'notification.mail.commands.v1',
    );
    this.dlqTopic = this.config.get<string>('KAFKA_MAIL_COMMANDS_DLQ_TOPIC', `${topic}.dlq`);
    if (topic === this.dlqTopic) {
      throw new Error('Kafka mail command topic and DLQ topic must be different');
    }

    const kafka = this.createKafkaClient();
    const consumer = kafka.consumer({
      groupId: this.config.get<string>('KAFKA_MAIL_COMMANDS_GROUP_ID', 'notification-mail'),
    });
    const producer = kafka.producer();
    this.consumer = consumer;
    this.producer = producer;

    try {
      await consumer.connect();
      await producer.connect();
      await consumer.subscribe({
        topic,
        fromBeginning: this.readBoolean('KAFKA_MAIL_COMMANDS_FROM_BEGINNING', false),
      });
      await consumer.run({
        eachMessage: async ({ topic: sourceTopic, partition, message }) => {
          await this.handleMessage(sourceTopic, partition, message);
        },
      });
      this.isRunning = true;
      this.logger.log(`Consuming Kafka mail commands from ${topic}`);
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

  private async handleMessage(
    topic: string,
    partition: number,
    message: KafkaMessage,
  ): Promise<void> {
    const rawValue = message.value?.toString('utf8') ?? '';
    let command: MailCommand;
    try {
      command = this.parseCommand(rawValue);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.sendToDeadLetterTopic(topic, partition, message, rawValue, reason);
      return;
    }

    const dto: SendSingleMailDto = {
      to: command.to,
      variables: command.variables,
    };
    await this.queueService.enqueueSingle(MailJobName.SEND_OTP, dto, this.toJobId(command.eventId));
    this.logger.log(`Queued mail command ${command.eventId} for ${this.maskEmail(command.to)}`);
  }

  private parseCommand(rawValue: string): MailCommand {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue) as unknown;
    } catch {
      throw new InvalidMailCommandError('Message is not valid JSON');
    }
    if (!this.isRecord(parsed)) throw new InvalidMailCommandError('Command must be an object');

    const eventId = this.requireString(parsed.eventId, 'eventId', 256);
    if (parsed.eventType !== 'auth.otp.requested.v1') {
      throw new InvalidMailCommandError('Unsupported mail command eventType');
    }
    if (parsed.jobName !== MailJobName.SEND_OTP) {
      throw new InvalidMailCommandError('Unsupported mail jobName');
    }
    const to = this.requireString(parsed.to, 'to', 320);
    if (!/^\S+@\S+\.\S+$/.test(to)) {
      throw new InvalidMailCommandError('to must be a valid email address');
    }
    if (!this.isRecord(parsed.variables)) {
      throw new InvalidMailCommandError('variables must be an object');
    }
    const variables: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.variables)) {
      if (typeof value !== 'string' || value.length > 2048) {
        throw new InvalidMailCommandError(
          `variables.${key} must be a string up to 2048 characters`,
        );
      }
      variables[key] = value;
    }
    for (const required of ['otpCode', 'expiresInMinutes']) {
      if (!variables[required]) {
        throw new InvalidMailCommandError(`variables.${required} is required`);
      }
    }

    return {
      eventId,
      eventType: 'auth.otp.requested.v1',
      jobName: 'send-otp-email',
      to: to.trim().toLowerCase(),
      variables,
    };
  }

  private async sendToDeadLetterTopic(
    sourceTopic: string,
    partition: number,
    message: KafkaMessage,
    rawValue: string,
    reason: string,
  ): Promise<void> {
    if (!this.producer || !this.dlqTopic) {
      throw new Error('Kafka mail DLQ producer is not connected');
    }
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
            rawValue: this.sanitizeRawValue(rawValue),
          }),
        },
      ],
    });
    this.logger.warn(
      `Moved invalid mail command from ${sourceTopic}[${partition}]@${message.offset} to ${this.dlqTopic}: ${reason}`,
    );
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

  private toJobId(eventId: string): string {
    return `mail-kafka-${createHash('sha256').update(eventId).digest('hex')}`;
  }

  private requireString(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
      throw new InvalidMailCommandError(
        `${field} must be a non-empty string up to ${maxLength} characters`,
      );
    }
    return value.trim();
  }

  private readBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.config.get<string>(key);
    if (value === undefined) return defaultValue;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    throw new Error(`${key} must be true or false`);
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '[invalid-email]';
    return `${local.slice(0, 1)}***@${domain}`;
  }

  private sanitizeRawValue(rawValue: string): string {
    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (!this.isRecord(parsed)) return '[non-object payload omitted]';

      if (!this.isRecord(parsed.variables)) {
        return JSON.stringify(parsed).slice(0, 16_384);
      }

      const variables = Object.fromEntries(
        Object.entries(parsed.variables).map(([key, value]) => [
          key,
          /otp|token|password|secret/i.test(key) ? '[REDACTED]' : value,
        ]),
      );
      return JSON.stringify({ ...parsed, variables }).slice(0, 16_384);
    } catch {
      return '[invalid JSON payload omitted]';
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
