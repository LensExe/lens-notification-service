import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const PRESENCE_KEY_PREFIX = 'lens:presence:user:';
const PRESENCE_TTL_SECONDS = 60;

@Injectable()
export class PresenceStore implements OnModuleDestroy {
  private readonly logger = new Logger(PresenceStore.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(config.get<string>('REDIS_PORT', '6379')),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(config.get<string>('REDIS_DB', '0')),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', (error) => {
      this.logger.warn(`Redis presence unavailable: ${error.message}`);
    });
  }

  async connect(userId: string, connectionId: string): Promise<void> {
    await this.ensureConnected();
    const key = this.key(userId);
    const expiresAt = Date.now() + PRESENCE_TTL_SECONDS * 1000;
    await this.redis.zadd(key, expiresAt, connectionId);
    await this.redis.expire(key, PRESENCE_TTL_SECONDS * 2);
  }

  async refresh(userId: string, connectionId: string): Promise<void> {
    if (this.redis.status !== 'ready') return;
    const key = this.key(userId);
    const expiresAt = Date.now() + PRESENCE_TTL_SECONDS * 1000;
    await this.redis.zadd(key, expiresAt, connectionId);
    await this.redis.expire(key, PRESENCE_TTL_SECONDS * 2);
  }

  async disconnect(userId: string, connectionId: string): Promise<void> {
    if (this.redis.status !== 'ready') return;
    const key = this.key(userId);
    await this.redis.zrem(key, connectionId);
    await this.redis.zremrangebyscore(key, '-inf', Date.now());
    if ((await this.redis.zcard(key)) === 0) await this.redis.del(key);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit();
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  private key(userId: string): string {
    return `${PRESENCE_KEY_PREFIX}${userId}`;
  }
}
