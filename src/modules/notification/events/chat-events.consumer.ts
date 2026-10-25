import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { NotificationGateway } from '../realtime/notification.gateway';
import { RealtimeTelemetry } from '../realtime/realtime-telemetry';

const CHAT_EVENT_SCHEMA_VERSION = 1;
const MAX_DELIVERY_ATTEMPTS = 3;
const CHAT_EVENT_TYPES = {
  CREATED: 'chat.message.created.v1',
  UPDATED: 'chat.message.updated.v1',
  RECALLED: 'chat.message.recalled.v1',
  READ_CURSOR: 'chat.read-cursor.advanced.v1',
} as const;

type ChatEventType = (typeof CHAT_EVENT_TYPES)[keyof typeof CHAT_EVENT_TYPES];
type ClientEventName = 'NEW_MESSAGE' | 'UPDATED_MESSAGE' | 'RECALLED_MESSAGE' | 'READ_CURSOR';

interface ChatMessagePayload {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_kind?: 'user' | 'ai';
  client_message_id: string;
  type: 'text' | 'image' | 'file';
  content: string;
  seq: number;
  reply_to_message_id?: string;
  revision: number;
  recalled_at?: string;
  created_at: string;
  updated_at: string;
}

interface ChatEventData {
  channel_id: string;
  participant_ids: string[];
  message?: ChatMessagePayload;
  user_id?: string;
  last_read_seq?: number;
}

interface ChatEventEnvelope {
  event_id: string;
  event_type: ChatEventType;
  schema_version: typeof CHAT_EVENT_SCHEMA_VERSION;
  occurred_at: string;
  producer: 'chat-service';
  aggregate_type: 'channel';
  aggregate_id: string;
  aggregate_version: number;
  data: ChatEventData;
}

class InvalidChatEventError extends Error {}

type KafkaMessage = {
  key: Buffer | null;
  value: Buffer | null;
  offset: string;
};

@Injectable()
export class ChatEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatEventsConsumer.name);
  private consumer?: Consumer;
  private producer?: Producer;
  private dlqTopic?: string;
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly gateway: NotificationGateway,
    private readonly telemetry: RealtimeTelemetry,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.readBoolean('KAFKA_ENABLED', false)) {
      this.logger.log('Kafka chat event consumer is disabled');
      return;
    }

    const topic = this.config.get<string>('KAFKA_CHAT_EVENTS_TOPIC', 'chat.conversation.events.v1');
    this.dlqTopic = this.config.get<string>('KAFKA_CHAT_EVENTS_DLQ_TOPIC', `${topic}.dlq`);
    if (topic === this.dlqTopic)
      throw new Error('Kafka chat topic and DLQ topic must be different');

    const groupId = this.config.get<string>(
      'KAFKA_CHAT_EVENTS_GROUP_ID',
      'notification-chat-realtime',
    );
    const kafka = this.createKafkaClient();
    const consumer = kafka.consumer({ groupId });
    const producer = kafka.producer();
    this.consumer = consumer;
    this.producer = producer;

    try {
      await consumer.connect();
      await producer.connect();
      consumer.on(consumer.events.END_BATCH_PROCESS, ({ payload }) => {
        this.telemetry.setConsumerLag(topic, payload.partition, Number(payload.offsetLag));
      });
      consumer.on(consumer.events.GROUP_JOIN, () => {
        this.telemetry.setConsumerConnected(true);
      });
      consumer.on(consumer.events.REBALANCING, () => {
        this.telemetry.setConsumerConnected(false);
      });
      consumer.on(consumer.events.DISCONNECT, () => {
        this.telemetry.setConsumerConnected(false);
      });
      consumer.on(consumer.events.CRASH, () => {
        this.telemetry.setConsumerConnected(false);
      });
      await consumer.subscribe({
        topic,
        fromBeginning: this.readBoolean(
          'KAFKA_CHAT_EVENTS_FROM_BEGINNING',
          this.readBoolean('KAFKA_FROM_BEGINNING', false),
        ),
      });
      await consumer.run({
        eachMessage: async ({ topic: sourceTopic, partition, message }) => {
          await this.handleMessage(sourceTopic, partition, message);
        },
      });
      this.isRunning = true;
      this.logger.log(`Consuming Kafka topic ${topic} as ${groupId}`);
    } catch (error) {
      this.telemetry.setConsumerConnected(false);
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
    this.telemetry.setConsumerConnected(false);
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
    message: KafkaMessage,
  ): Promise<void> {
    const startedAt = Date.now();
    this.telemetry.increment('notification_chat_events_received_total');
    const rawValue = message.value?.toString('utf8') ?? '';
    let event: ChatEventEnvelope;
    try {
      event = this.parseEvent(rawValue, message.key);
    } catch (error) {
      this.telemetry.increment('notification_chat_events_invalid_total');
      const reason = error instanceof Error ? error.message : String(error);
      await this.sendToDeadLetterTopic(topic, partition, message, rawValue, reason);
      this.telemetry.increment('notification_chat_events_dlq_total');
      this.telemetry.observeProcessing((Date.now() - startedAt) / 1000);
      return;
    }

    const clientEvent = this.toClientEvent(event);
    const socketPayload = {
      event_id: event.event_id,
      event: clientEvent,
      aggregate_version: event.aggregate_version,
      payload: event.data.message ?? {
        channel_id: event.data.channel_id,
        user_id: event.data.user_id,
        last_read_seq: event.data.last_read_seq,
      },
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      this.telemetry.increment('notification_chat_delivery_attempts_total');
      try {
        for (const userId of event.data.participant_ids) {
          this.gateway.sendChatEvent(userId, socketPayload);
        }
        this.telemetry.increment('notification_chat_events_emitted_total');
        this.telemetry.observeProcessing((Date.now() - startedAt) / 1000);
        this.logger.log(
          `Relayed ${event.event_type} ${event.event_id} for channel ${event.aggregate_id} version ${event.aggregate_version}`,
        );
        return;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_DELIVERY_ATTEMPTS) {
          this.telemetry.increment('notification_chat_events_retried_total');
          this.logger.warn(
            `Realtime delivery attempt ${attempt}/${MAX_DELIVERY_ATTEMPTS} failed for event ${event.event_id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          await this.delay(attempt * 500);
        }
      }
    }

    const reason = `Realtime delivery failed after ${MAX_DELIVERY_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
    this.logger.error(
      `Parking chat event after retry limit: event_id=${event.event_id} channel_id=${event.aggregate_id} aggregate_version=${event.aggregate_version}; ${reason}`,
    );
    await this.sendToDeadLetterTopic(topic, partition, message, rawValue, reason);
    this.telemetry.increment('notification_chat_events_dlq_total');
    this.telemetry.observeProcessing((Date.now() - startedAt) / 1000);
  }

  private parseEvent(rawValue: string, key: Buffer | null): ChatEventEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue) as unknown;
    } catch {
      throw new InvalidChatEventError('Message is not valid JSON');
    }
    if (!this.isRecord(parsed)) throw new InvalidChatEventError('Event must be a JSON object');

    const eventId = this.requireString(parsed.event_id, 'event_id');
    const occurredAt = this.requireDateString(parsed.occurred_at, 'occurred_at');
    if (!this.isChatEventType(parsed.event_type)) {
      throw new InvalidChatEventError(`Unsupported event_type: ${String(parsed.event_type)}`);
    }
    if (parsed.schema_version !== CHAT_EVENT_SCHEMA_VERSION) {
      throw new InvalidChatEventError('schema_version must be 1');
    }
    if (parsed.producer !== 'chat-service') {
      throw new InvalidChatEventError('producer must be chat-service');
    }
    if (parsed.aggregate_type !== 'channel') {
      throw new InvalidChatEventError('aggregate_type must be channel');
    }
    const aggregateId = this.requireString(parsed.aggregate_id, 'aggregate_id');
    const aggregateVersion = this.requirePositiveInteger(
      parsed.aggregate_version,
      'aggregate_version',
    );
    if (!this.isRecord(parsed.data)) throw new InvalidChatEventError('data must be a JSON object');

    const data = parsed.data;
    const channelId = this.requireString(data.channel_id, 'data.channel_id');
    if (channelId !== aggregateId) {
      throw new InvalidChatEventError('data.channel_id must equal aggregate_id');
    }
    if (key?.toString('utf8') !== channelId) {
      throw new InvalidChatEventError('Kafka key must equal data.channel_id');
    }
    if (!Array.isArray(data.participant_ids) || data.participant_ids.length !== 2) {
      throw new InvalidChatEventError('data.participant_ids must contain exactly two users');
    }
    const participantIds = data.participant_ids.map((userId, index) =>
      this.requireString(userId, `data.participant_ids[${index}]`),
    );
    if (new Set(participantIds).size !== participantIds.length) {
      throw new InvalidChatEventError('data.participant_ids must not contain duplicates');
    }

    const eventType = parsed.event_type;
    if (eventType === CHAT_EVENT_TYPES.READ_CURSOR) {
      const userId = this.requireString(data.user_id, 'data.user_id');
      if (!participantIds.includes(userId)) {
        throw new InvalidChatEventError('data.user_id must be a channel participant');
      }
      const lastReadSeq = this.requirePositiveInteger(data.last_read_seq, 'data.last_read_seq');
      return {
        event_id: eventId,
        event_type: eventType,
        schema_version: CHAT_EVENT_SCHEMA_VERSION,
        occurred_at: occurredAt,
        producer: 'chat-service',
        aggregate_type: 'channel',
        aggregate_id: aggregateId,
        aggregate_version: aggregateVersion,
        data: {
          channel_id: channelId,
          participant_ids: participantIds,
          user_id: userId,
          last_read_seq: lastReadSeq,
        },
      };
    }

    if (!this.isRecord(data.message)) {
      throw new InvalidChatEventError('data.message must be a JSON object');
    }
    const message = this.parseMessage(data.message, channelId, eventType);
    if (!participantIds.includes(message.sender_id)) {
      throw new InvalidChatEventError('data.message.sender_id must be a channel participant');
    }
    return {
      event_id: eventId,
      event_type: eventType,
      schema_version: CHAT_EVENT_SCHEMA_VERSION,
      occurred_at: occurredAt,
      producer: 'chat-service',
      aggregate_type: 'channel',
      aggregate_id: aggregateId,
      aggregate_version: aggregateVersion,
      data: { channel_id: channelId, participant_ids: participantIds, message },
    };
  }

  private parseMessage(
    value: Record<string, unknown>,
    channelId: string,
    eventType: ChatEventType,
  ): ChatMessagePayload {
    const id = this.requireString(value.id, 'data.message.id');
    const messageChannelId = this.requireString(value.channel_id, 'data.message.channel_id');
    if (messageChannelId !== channelId) {
      throw new InvalidChatEventError('data.message.channel_id must equal data.channel_id');
    }
    const senderId = this.requireString(value.sender_id, 'data.message.sender_id');
    const senderKind = value.sender_kind;
    if (senderKind !== undefined && senderKind !== 'user' && senderKind !== 'ai') {
      throw new InvalidChatEventError('data.message.sender_kind must be user or ai');
    }
    const clientMessageId = this.requireString(
      value.client_message_id,
      'data.message.client_message_id',
    );
    if (value.type !== 'text' && value.type !== 'image' && value.type !== 'file') {
      throw new InvalidChatEventError('data.message.type must be text, image, or file');
    }
    if (typeof value.content !== 'string' || value.content.length > 10000) {
      throw new InvalidChatEventError(
        'data.message.content must be a string up to 10000 characters',
      );
    }
    if (eventType !== CHAT_EVENT_TYPES.RECALLED && value.content.trim().length === 0) {
      throw new InvalidChatEventError('data.message.content must not be empty');
    }
    const seq = this.requirePositiveInteger(value.seq, 'data.message.seq');
    const revision = this.requirePositiveInteger(value.revision, 'data.message.revision');
    const createdAt = this.requireDateString(value.created_at, 'data.message.created_at');
    const updatedAt = this.requireDateString(value.updated_at, 'data.message.updated_at');
    const payload: ChatMessagePayload = {
      id,
      channel_id: channelId,
      sender_id: senderId,
      ...(senderKind ? { sender_kind: senderKind } : {}),
      client_message_id: clientMessageId,
      type: value.type,
      content: value.content,
      seq,
      revision,
      created_at: createdAt,
      updated_at: updatedAt,
    };
    if (value.reply_to_message_id !== undefined) {
      payload.reply_to_message_id = this.requireString(
        value.reply_to_message_id,
        'data.message.reply_to_message_id',
      );
    }
    if (eventType === CHAT_EVENT_TYPES.RECALLED) {
      payload.recalled_at = this.requireDateString(value.recalled_at, 'data.message.recalled_at');
      if (payload.content !== '') {
        throw new InvalidChatEventError('recalled message content must be empty');
      }
    } else if (value.recalled_at !== undefined) {
      throw new InvalidChatEventError('data.message.recalled_at is only valid for recalled events');
    }
    return payload;
  }

  private toClientEvent(event: ChatEventEnvelope): ClientEventName {
    switch (event.event_type) {
      case CHAT_EVENT_TYPES.CREATED:
        return 'NEW_MESSAGE';
      case CHAT_EVENT_TYPES.UPDATED:
        return 'UPDATED_MESSAGE';
      case CHAT_EVENT_TYPES.RECALLED:
        return 'RECALLED_MESSAGE';
      case CHAT_EVENT_TYPES.READ_CURSOR:
        return 'READ_CURSOR';
    }
  }

  private async sendToDeadLetterTopic(
    sourceTopic: string,
    partition: number,
    message: KafkaMessage,
    rawValue: string,
    reason: string,
  ): Promise<void> {
    if (!this.producer || !this.dlqTopic)
      throw new Error('Kafka chat DLQ producer is not connected');
    try {
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
        `Moved chat event from ${sourceTopic}[${partition}]@${message.offset} to ${this.dlqTopic}: ${reason}`,
      );
    } catch (error) {
      this.telemetry.increment('notification_chat_dlq_write_failures_total');
      throw error;
    }
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
      throw new InvalidChatEventError(`${field} must be a non-empty string up to 256 characters`);
    }
    return value;
  }

  private requireDateString(value: unknown, field: string): string {
    const result = this.requireString(value, field);
    if (Number.isNaN(Date.parse(result)))
      throw new InvalidChatEventError(`${field} must be a valid date`);
    return result;
  }

  private requirePositiveInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new InvalidChatEventError(`${field} must be a positive integer`);
    }
    return value;
  }

  private isChatEventType(value: unknown): value is ChatEventType {
    return Object.values(CHAT_EVENT_TYPES).includes(value as ChatEventType);
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

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
