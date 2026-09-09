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
  controllers: [NotificationController],
  providers: [NotificationService, NotificationGateway, NotificationProcessor],
  exports: [NotificationService, NotificationGateway, NotificationProcessor],
})
export class NotificationModule {}
