import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { NotificationTypeEnum } from '../enum/notification.enum';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({
  collection: 'notifications',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Notification {
  @Prop({ required: true, unique: true, index: true })
  id!: string;

  @Prop({ required: true, index: true })
  user_id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  content!: string;

  @Prop({ type: String, required: true, enum: NotificationTypeEnum })
  type!: NotificationTypeEnum;

  @Prop({ default: false, index: true })
  is_read!: boolean;

  @Prop({ type: Object })
  data?: unknown;

  created_at!: Date;

  updated_at!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ user_id: 1, created_at: -1 });
