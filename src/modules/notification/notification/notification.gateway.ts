import {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Namespace, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { KeycloakJwtVerifier } from '../../../common/security/keycloak-jwt.verifier';

@WebSocketGateway({ namespace: '/notification', path: '/api/v1/socket.io' })
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: Namespace;
  private pubClient?: Redis;
  private subClient?: Redis;
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly config: ConfigService,
    private readonly verifier: KeycloakJwtVerifier,
  ) {}

  afterInit(server: Namespace): void {
    this.pubClient = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: Number(this.config.get('REDIS_PORT', 6379)),
      db: Number(this.config.get('REDIS_DB', 0)),
    });
    this.subClient = this.pubClient.duplicate();
    server.server.adapter(createAdapter(this.pubClient, this.subClient));
    server.use((socket, next) => {
      try {
        const token: unknown = socket.handshake.auth.token;
        if (typeof token !== 'string') throw new Error('Bearer token required');
        const principal = this.verifier.verify(token);
        socket.data = { userId: principal.sub, expiresAt: principal.exp };
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const { userId, expiresAt } = client.data as { userId: string; expiresAt: number };
    await client.join(`user:${userId}`);
    // Periodic check also handles tokens whose lifetime exceeds setTimeout's maximum.
    const timer = setInterval(() => {
      if (Date.now() >= expiresAt * 1000) client.disconnect(true);
    }, 1000);
    timer.unref();
    this.expiryTimers.set(client.id, timer);
  }

  handleDisconnect(client: Socket): void {
    const timer = this.expiryTimers.get(client.id);
    if (timer) clearInterval(timer);
    this.expiryTimers.delete(client.id);
  }

  sendNotification(userId: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit('notification', payload);
  }

  onModuleDestroy(): void {
    for (const timer of this.expiryTimers.values()) clearInterval(timer);
    this.expiryTimers.clear();
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
  }
}
