import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { SecurityModule } from './common/security/security.module';
import { MailContextModule } from './modules/mail/mail-context.module';
import { NotificationModule } from './modules/notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SecurityModule,
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
        dbName: config.getOrThrow<string>('MONGO_DB_NAME'),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: Number(config.get('REDIS_PORT', 6379)),
          password: config.getOrThrow<string>('REDIS_PASSWORD'),
          db: Number(config.get('REDIS_DB', 0)),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
    }),
    MailContextModule,
    NotificationModule,
  ],
})
export class AppModule {}
