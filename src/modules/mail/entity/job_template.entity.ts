import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { MailJobName } from '../mail/enum/mail.enum';
import { TemplateTypeEnum } from '../mail/enum/template.enum';

@Entity('job_template')
export class JobTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: MailJobName, nullable: false })
  job_name!: MailJobName;

  @Column({ type: 'enum', enum: TemplateTypeEnum, nullable: false })
  template_type!: TemplateTypeEnum;

  @Column({ type: 'varchar' })
  version!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
