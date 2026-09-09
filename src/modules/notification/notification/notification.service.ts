import { BadRequestException, Injectable } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { NotificationTypeEnum } from './enum/notification.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Notification } from '../entity/notification.entity';
import { Repository } from 'typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationReadModel } from './schemas/notification-read.schema';
import { NotificationDto } from './dto/notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    private gateway: NotificationGateway,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectModel(NotificationReadModel.name)
    private readonly notificationReadModel: Model<NotificationReadModel>,
  ) {}

  private toNotificationType(type: string): NotificationTypeEnum {
    if (Object.values(NotificationTypeEnum).includes(type as NotificationTypeEnum)) {
      return type as NotificationTypeEnum;
    }
    throw new BadRequestException(`Invalid notification type: ${type}`);
  }

  async notifyUser(notificationDto: NotificationDto): Promise<Notification> {
    const { userId, title, message, type, data } = notificationDto;
    const notificationType = this.toNotificationType(type);

    // Write model (Postgres)
    const saved: Notification = await this.notificationRepository.save(
      this.notificationRepository.create({
        user_id: userId,
        title,
        content: message,
        type: notificationType,
        data,
      }),
    );

    // create read model (Mongo) for CQRS reads
    const readModel = {
      source_notification_id: saved.id,
      user_id: userId,
      title: saved.title,
      content: saved.content,
      type: saved.type,
      is_read: saved.is_read,
      data,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
    };
    // update or create read model (Mongo) for CQRS reads
    await this.notificationReadModel.collection.updateOne(
      { source_notification_id: saved.id },
      { $set: readModel },
      { upsert: true }, // upsert: true nếu không có thì sẽ tạo mới, nếu có thì sẽ update
    );

    // Realtime push
    const realtimePayload = {
      id: saved.id,
      title: saved.title,
      message: saved.content,
      type: saved.type,
      data,
      created_at: saved.created_at > saved.updated_at ? saved.created_at : saved.updated_at,
    };
    void this.gateway.sendNotification(userId, realtimePayload);
    return saved;
  }

  async getNotifications(
    userId: string,
    skip: number,
    limit: number,
  ): Promise<NotificationReadModel[]> {
    return await this.notificationReadModel
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async markAsRead(userId: string): Promise<number> {
    // Write model (Postgres) — bulk update
    const result = await this.notificationRepository.update(
      { user_id: userId, is_read: false },
      { is_read: true },
    );
    const affected = result.affected ?? 0;
    if (affected === 0) return 0;

    // Read model (Mongo) — bulk sync
    await this.notificationReadModel.updateMany(
      { user_id: userId, is_read: false },
      { $set: { is_read: true, updated_at: new Date() } },
    );
    return affected;
  }
}
