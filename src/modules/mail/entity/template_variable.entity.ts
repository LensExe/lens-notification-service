import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { EmailTemplate } from './email_template.entity';

@Entity('template_variable')
export class TemplateVariable {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  variable_name!: string;

  @Column({ type: 'boolean', default: false })
  is_required!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @ManyToOne(() => EmailTemplate, (emailTemplate) => emailTemplate.id)
  emailTemplate!: EmailTemplate;
}
