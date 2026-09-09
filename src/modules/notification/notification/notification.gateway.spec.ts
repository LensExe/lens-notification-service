import { ConfigService } from '@nestjs/config';
import { Namespace, Socket } from 'socket.io';
import { NotificationGateway } from './notification.gateway';
import { KeycloakJwtVerifier } from '../../../common/security/keycloak-jwt.verifier';

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    duplicate: jest.fn().mockReturnValue({ disconnect: jest.fn() }),
    disconnect: jest.fn(),
  })),
}));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn() }));

describe('Notification WebSocket identity', () => {
  const verify = jest.fn();
  let gateway: NotificationGateway;
  let authenticate: (socket: Socket, next: (error?: Error) => void) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    verify.mockReset();
    gateway = new NotificationGateway(new ConfigService(), {
      verify,
    } as unknown as KeycloakJwtVerifier);
    const namespace = {
      server: { adapter: jest.fn() },
      use: (middleware: typeof authenticate) => {
        authenticate = middleware;
      },
    } as unknown as Namespace;
    gateway.afterInit(namespace);
  });
  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
  });

  it('rejects missing and invalid tokens before joining a room', () => {
    const next = jest.fn();
    authenticate({ handshake: { auth: {} } } as Socket, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    verify.mockImplementation(() => {
      throw new Error('invalid');
    });
    authenticate({ handshake: { auth: { token: 'bad' } } } as unknown as Socket, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith(expect.any(Error));
  });

  it('joins only the verified subject room and disconnects when the token expires', async () => {
    verify.mockReturnValue({ sub: 'verified-user', exp: Math.floor(Date.now() / 1000) + 2 });
    const join = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn();
    const client = {
      id: 'socket-1',
      handshake: { auth: { token: 'valid', userId: 'other-user' } },
      data: {},
      join,
      disconnect,
    } as unknown as Socket;
    const next = jest.fn();
    authenticate(client, next);
    expect(next).toHaveBeenCalledWith();
    await gateway.handleConnection(client);
    expect(join).toHaveBeenCalledWith('user:verified-user');
    jest.advanceTimersByTime(2000);
    expect(disconnect).toHaveBeenCalledWith(true);
    gateway.handleDisconnect(client);
    expect(jest.getTimerCount()).toBe(0);
  });
});
