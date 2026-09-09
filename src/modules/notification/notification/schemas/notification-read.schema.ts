import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { NotificationTypeEnum } from '../enum/notification.enum';

/*
HydratedDocument<T>: là một class mà Mongoose tạo ra để đại diện cho một document trong MongoDB.
T: là kiểu của document (ts class của model).
Ví dụ: HydratedDocument<NotificationReadModel> là một class mà Mongoose tạo ra để đại diện cho một document trong collection 'notification_reads'.
  - NotificationReadModel là một class mà chúng ta định nghĩa trong file này.
  - NotificationReadDocument là một class mà Mongoose tạo ra để đại diện cho một document trong collection 'notification_reads'
  - Với các class ts bình thường thì sẽ không thể truy cập các func của Mongoose (ví dụ: find, findOne, update, delete, ...).
  - Với các class HydratedDocument thì sẽ có thể truy cập các func của Mongoose.
--> HydratedDocument để có thể tương tác với MongoDB.
*/
export type NotificationReadDocument = HydratedDocument<NotificationReadModel>;

@Schema({ collection: 'notification_reads', timestamps: true })
export class NotificationReadModel {
  @Prop({ required: true, unique: true })
  source_notification_id!: string;

  @Prop({ required: true, index: true })
  user_id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  content!: string;

  @Prop({ type: String, required: true, enum: NotificationTypeEnum })
  type!: NotificationTypeEnum;

  @Prop({ required: false, default: false })
  is_read?: boolean;

  @Prop({ type: Object, required: false })
  data?: unknown;

  @Prop({ required: true })
  created_at!: Date;

  @Prop({ required: true })
  updated_at!: Date;
}

/*
  SchemaFactory.createForClass(NotificationReadModel): tạo ra một schema cho model NotificationReadModel.
  - SchemaFactory là một class mà Mongoose cung cấp để tạo ra một schema cho model.
  - createForClass(NotificationReadModel): tạo ra một schema cho model NotificationReadModel.
  --> Tạo ra một schema cho model NotificationReadModel.
*/
export const NotificationReadSchema = SchemaFactory.createForClass(NotificationReadModel);
