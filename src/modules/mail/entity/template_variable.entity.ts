import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class TemplateVariable {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  variable_name!: string;

  @Prop({ default: false })
  is_required!: boolean;

  created_at!: Date;
}

export const TemplateVariableSchema = SchemaFactory.createForClass(TemplateVariable);
