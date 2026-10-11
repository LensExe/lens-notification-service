import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Notification, NotificationSchema } from './core/entity/notification.entity';
import { NotificationController } from './api/notification.controller';
import { NotificationService } from './core/notification.service';
import { NotificationGateway } from './realtime/notification.gateway';
import { NotificationProcessor } from './jobs/notification.processor';
import { QueueModule } from './jobs/queue/queue.module';
import { NotificationEventsConsumer } from './events/notification-events.consumer';
import { ChatEventsConsumer } from './events/chat-events.consumer';
import { RealtimeMetricsController, RealtimeTelemetry } from './realtime/realtime-telemetry';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
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
