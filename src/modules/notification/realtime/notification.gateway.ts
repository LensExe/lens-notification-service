import {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { KeycloakJwtVerifier } from '../../../common/security/keycloak-jwt.verifier';
import { PresenceStore } from './presence.store';

@WebSocketGateway({
  namespace: '/notification',
  path: '/api/v1/socket.io',
  connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationGateway.name);
  @WebSocketServer()
  server!: Namespace;
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly presenceTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly verifier: KeycloakJwtVerifier,
    private readonly presence: PresenceStore,
  ) {}

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      try {
        const authToken: unknown = socket.handshake.auth?.token;
        const token = typeof authToken === 'string' && authToken.trim()
          ? authToken
          : readCookie(socket.handshake.headers.cookie, 'keycloak_access_token');
        if (!token) {
          throw new Error('Socket.IO auth token required');
        }
        const principal = this.verifier.verify(token);
        socket.data = { userId: principal.sub, expiresAt: principal.exp };
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const { userId, expiresAt } = client.data as {
      userId: string;
      expiresAt: number;
    };
    await client.join(`user:${userId}`);
    try {
      await this.presence.connect(userId, client.id);
    } catch (error) {
      this.logger.warn(
        `Could not register socket presence for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const presenceTimer = setInterval(() => {
      void this.presence.refresh(userId, client.id).catch(() => undefined);
    }, 20_000);
    presenceTimer.unref();
    this.presenceTimers.set(client.id, presenceTimer);
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
    const presenceTimer = this.presenceTimers.get(client.id);
    if (presenceTimer) clearInterval(presenceTimer);
    this.presenceTimers.delete(client.id);
    const { userId } = client.data as { userId?: string };
    if (userId) void this.presence.disconnect(userId, client.id).catch(() => undefined);
  }

  sendNotification(userId: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit('notification', payload);
  }

  sendChatEvent(userId: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit('chat.event', payload);
  }

  sendBookingEvent(userId: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit('booking.event', payload);
  }

  onModuleDestroy(): void {
    for (const timer of this.expiryTimers.values()) clearInterval(timer);
    this.expiryTimers.clear();
    for (const timer of this.presenceTimers.values()) clearInterval(timer);
    this.presenceTimers.clear();
  }
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const cookieHeader = Array.isArray(header) ? header.join(';') : header;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
