import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { MailJobName } from '../mail/enum/mail.enum';
import { TemplateTypeEnum } from '../mail/enum/template.enum';

export type JobTemplateDocument = HydratedDocument<JobTemplate>;

@Schema({
  collection: 'job_templates',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class JobTemplate {
  @Prop({ required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, enum: MailJobName })
  job_name!: MailJobName;

  @Prop({ type: String, required: true, enum: TemplateTypeEnum })
  template_type!: TemplateTypeEnum;

  @Prop({ required: true })
  version!: string;

  created_at!: Date;

  updated_at!: Date;
}

export const JobTemplateSchema = SchemaFactory.createForClass(JobTemplate);
