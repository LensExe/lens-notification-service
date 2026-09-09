import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationTypeEnum } from '../notification/enum/notification.enum';

@Entity('notification')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  user_id!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'enum', enum: NotificationTypeEnum })
  type!: NotificationTypeEnum;

  @Column({ type: 'boolean', default: false })
  is_read!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  data?: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
