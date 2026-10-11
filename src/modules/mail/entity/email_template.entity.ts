import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { TemplateTypeEnum } from '../mail/enum/template.enum';
import { TemplateVariable, TemplateVariableSchema } from './template_variable.entity';

export type EmailTemplateDocument = HydratedDocument<EmailTemplate>;

@Schema({
  collection: 'email_templates',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class EmailTemplate {
  @Prop({ required: true, unique: true, index: true })
  id!: string;

  @Prop({ type: String, required: true, unique: true })
  template_type!: TemplateTypeEnum;

  @Prop({ required: true })
  version!: string;

  @Prop({ required: true })
  subject!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ required: true })
  engine!: string;

  @Prop({ default: true, index: true })
  is_active?: boolean = true;

  @Prop({ type: [TemplateVariableSchema], default: [] })
  template_variables!: TemplateVariable[];

  created_at!: Date;

  updated_at!: Date;
}

export const EmailTemplateSchema = SchemaFactory.createForClass(EmailTemplate);
