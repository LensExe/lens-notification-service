import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from './mail.service';
import { MailQueue } from '../queue/enum/mail-queue.enum';
import { SendSingleMailDto } from './dto/send-mail.dto';

@Processor(MailQueue.SINGLE, { concurrency: 5 })
export class MailSingleProcessor extends WorkerHost {
  private readonly logger = new Logger(MailSingleProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<SendSingleMailDto>): Promise<void> {
    this.logger.log(`Processing job [${job.name}] id=${job.id} to=${job.data.to}`);
    await this.mailService.sendEmail(job.data);
  }
}

@Processor(MailQueue.BULK, { concurrency: 2, limiter: { max: 10, duration: 1000 } })
export class MailBulkProcessor extends WorkerHost {
  private readonly logger = new Logger(MailBulkProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<SendSingleMailDto>): Promise<void> {
    this.logger.log(`Processing bulk job [${job.name}] id=${job.id} to=${job.data.to}`);
    await this.mailService.sendEmail(job.data);
  }
}
