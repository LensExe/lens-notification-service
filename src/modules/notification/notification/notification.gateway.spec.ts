import { Namespace, Socket } from 'socket.io';
import { NotificationGateway } from './notification.gateway';
import { KeycloakJwtVerifier } from '../../../common/security/keycloak-jwt.verifier';

describe('Notification WebSocket identity', () => {
  const verify = jest.fn();
  let gateway: NotificationGateway;
  let authenticate: (socket: Socket, next: (error?: Error) => void) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    verify.mockReset();
    gateway = new NotificationGateway({ verify } as unknown as KeycloakJwtVerifier);
    const namespace = {
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
    expect(join).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    expect(disconnect).toHaveBeenCalledWith(true);
    gateway.handleDisconnect(client);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('emits notification and chat events only to their user rooms', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as Namespace;

    gateway.sendNotification('user-1', { title: 'Order placed' });
    gateway.sendChatEvent('user-2', { event_id: 'chat-1' });

    expect(to).toHaveBeenNthCalledWith(1, 'user:user-1');
    expect(emit).toHaveBeenNthCalledWith(1, 'notification', { title: 'Order placed' });
    expect(to).toHaveBeenNthCalledWith(2, 'user:user-2');
    expect(emit).toHaveBeenNthCalledWith(2, 'chat.event', { event_id: 'chat-1' });
  });
});
