import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TemplateTypeEnum } from '../mail/enum/template.enum';
import { TemplateVariable } from './template_variable.entity';

@Entity('email_template')
export class EmailTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  template_type!: TemplateTypeEnum;

  @Column({ type: 'varchar' })
  version!: string;

  @Column({ type: 'text' })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar' })
  engine!: string;

  @Column({ type: 'boolean', default: true })
  is_active?: boolean = true;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @OneToMany(() => TemplateVariable, (templateVariable) => templateVariable.emailTemplate)
  template_variables!: TemplateVariable[];
}
