import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailSingleProcessor, MailBulkProcessor } from './mail.processor';
import { QueueModule } from '../queue/queue.module';
import { TemplateModule } from '../template/template.module';
import { MailProviderModule } from '../providers/mail-provider.module';

@Module({
  imports: [MailProviderModule, QueueModule, TemplateModule],
  controllers: [MailController],
  providers: [MailService, MailSingleProcessor, MailBulkProcessor],
  exports: [MailService],
})
export class MailModule {}
