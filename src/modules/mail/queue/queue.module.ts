import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { JobTemplateModule } from '../job-template/job-template.module';
import { MailQueue } from './enum/mail-queue.enum';

@Module({
  imports: [
    BullModule.registerQueue({ name: MailQueue.SINGLE }, { name: MailQueue.BULK }),
    JobTemplateModule,
  ],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
