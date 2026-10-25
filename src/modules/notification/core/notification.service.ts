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

    const eventData = this.asRecord(data);
    const eventType = eventData.event_type;
    if (typeof eventType === 'string' && eventType.startsWith('booking.')) {
      const bookingData = { ...eventData };
      const eventId = bookingData.event_id;
      const occurredAt = bookingData.occurred_at;
      delete bookingData.event_id;
      delete bookingData.event_type;
      delete bookingData.occurred_at;
      this.gateway.sendBookingEvent(userId, {
        event_id: typeof eventId === 'string' ? eventId : saved.id,
        event_type: eventType,
        occurred_at:
          typeof occurredAt === 'string' ? occurredAt : new Date().toISOString(),
        data: bookingData,
      });
    }
    return saved;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return {};
    return value as Record<string, unknown>;
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
