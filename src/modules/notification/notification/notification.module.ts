import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.gateway';
import { NotificationProcessor } from './notification.processor';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../entity/notification.entity';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationReadModel, NotificationReadSchema } from './schemas/notification-read.schema';
import { QueueModule } from '../queue/queue.module';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { ChatEventsConsumer } from './chat-events.consumer';
import { RealtimeMetricsController, RealtimeTelemetry } from './realtime-telemetry';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    MongooseModule.forFeature([
      {
        name: NotificationReadModel.name,
        schema: NotificationReadSchema,
      },
    ]),
    QueueModule,
  ],
  controllers: [NotificationController, RealtimeMetricsController],
  providers: [
    NotificationService,
    NotificationGateway,
    NotificationProcessor,
    NotificationEventsConsumer,
    ChatEventsConsumer,
    RealtimeTelemetry,
  ],
  exports: [NotificationService, NotificationGateway, NotificationProcessor],
})
export class NotificationModule {}
