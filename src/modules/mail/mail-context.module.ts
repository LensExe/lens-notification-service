import { Module } from '@nestjs/common';
import { MailModule } from './mail/mail.module';
import { TemplateModule } from './template/template.module';
import { JobTemplateModule } from './job-template/job-template.module';

@Module({ imports: [MailModule, TemplateModule, JobTemplateModule] })
export class MailContextModule {}
