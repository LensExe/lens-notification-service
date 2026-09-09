import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { SecurityModule } from '../src/common/security/security.module';
import { configureApp } from '../src/setup';
import { NotificationController } from '../src/modules/notification/notification/notification.controller';
import { NotificationService } from '../src/modules/notification/notification/notification.service';
import { MailController } from '../src/modules/mail/mail/mail.controller';
import { QueueService } from '../src/modules/mail/queue/queue.service';

describe('Single service routing and authentication', () => {
  let app: INestApplication<Server>;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://identity.example.com/realms/test';
  const audience = 'notification-service';
  const token = sign({ typ: 'Bearer' }, keys.privateKey, {
    algorithm: 'RS256',
    issuer,
    audience,
    subject: 'user-123',
    expiresIn: 300,
  });
  const notifications = {
    notifyUser: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    getNotifications: jest.fn().mockResolvedValue([]),
    markAsRead: jest.fn().mockResolvedValue(1),
  };
  const mail = {
    enqueueSingle: jest.fn().mockResolvedValue(undefined),
    enqueueBulk: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          isGlobal: true,
          load: [
            () => ({
              KEYCLOAK_PUBLIC_KEY: keys.publicKey
                .export({ type: 'spki', format: 'pem' })
                .toString(),
              KEYCLOAK_ISSUER: issuer,
              KEYCLOAK_AUDIENCE: audience,
            }),
          ],
        }),
        SecurityModule,
      ],
      controllers: [MailController, NotificationController],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: QueueService, useValue: mail },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('protects both contexts with the global guard', async () => {
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/mail/send-otp-email/single')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
  });
  it('uses JWT subject for reads even when another userId is supplied', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/notifications?userId=other')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(notifications.getNotifications).toHaveBeenCalledWith('user-123', 0, 20);
  });
  it('marks only the authenticated user notifications as read', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/notifications/mark-read')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'other' })
      .expect(201);
    expect(notifications.markAsRead).toHaveBeenCalledWith('user-123');
  });
  it('queues email without invoking notification persistence', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/mail/send-otp-email/single')
      .set('Authorization', `Bearer ${token}`)
      .send({ to: 'user@example.com', variables: { otp: '123456' } })
      .expect(202);
    expect(mail.enqueueSingle).toHaveBeenCalledTimes(1);
    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });
  it('rejects invalid payloads and pagination', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/mail/send-otp-email/single')
      .set('Authorization', `Bearer ${token}`)
      .send({ to: 'invalid' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/notifications?limit=101')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
  it('does not expose the old gateway root route', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });
});
