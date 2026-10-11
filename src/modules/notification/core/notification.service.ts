import { BadRequestException, Injectable } from '@nestjs/common';
import { NotificationGateway } from '../realtime/notification.gateway';
import { NotificationTypeEnum } from './enum/notification.enum';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Notification, NotificationDocument } from './entity/notification.entity';
import { NotificationDto } from './dto/notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    private gateway: NotificationGateway,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
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

    const savedDocument = await this.notificationModel.create({
      id: randomUUID(),
      user_id: userId,
      title,
      content: message,
      type: notificationType,
      data,
    });
    const saved = savedDocument.toObject() as Notification;

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

  async getNotifications(userId: string, skip: number, limit: number): Promise<Notification[]> {
    return await this.notificationModel
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .select('-_id -__v')
      .lean()
      .exec();
  }

  async markAsRead(userId: string): Promise<number> {
    const result = await this.notificationModel.updateMany(
      { user_id: userId, is_read: false },
      { $set: { is_read: true, updated_at: new Date() } },
    );
    return result.modifiedCount;
  }
}
