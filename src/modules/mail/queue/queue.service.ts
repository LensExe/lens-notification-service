import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { BulkJobOptions, Queue } from 'bullmq';
import { SendSingleMailDto, SendBulkMailDto } from '../mail/dto/send-mail.dto';
import { MailJobName, MailQueue } from '../mail/enum/mail.enum';
import { JobTemplateService } from '../job-template/job-template.service';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(MailQueue.SINGLE)
    private readonly singleQueue: Queue<SendSingleMailDto>,
    @InjectQueue(MailQueue.BULK)
    private readonly bulkQueue: Queue<SendSingleMailDto>,
    private readonly jobTemplateService: JobTemplateService,
  ) {}

  /**
   * Enqueue a single email job.
   */
  async enqueueSingle(jobName: MailJobName, data: SendSingleMailDto): Promise<void> {
    const jobTemplateRecords = await this.jobTemplateService.getJobTemplateRecords();
    await this.singleQueue.add(
      jobName,
      {
        to: data.to,
        template_id:
          data.template_id !== null && data.template_id !== undefined
            ? data.template_id
            : jobTemplateRecords[jobName],
        variables: data.variables,
      },
      {
        delay: 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    this.logger.log(`Enqueued single email job [${jobName}] to=${data.to}`);
  }

  /**
   * Enqueue multiple email jobs in bulk.
   */
  async enqueueBulk(jobName: MailJobName, payload: SendBulkMailDto): Promise<void> {
    const jobTemplateRecords = await this.jobTemplateService.getJobTemplateRecords();
    const jobs: { name: string; data: SendSingleMailDto; opts?: BulkJobOptions }[] =
      payload.recipients.map((recipient) => ({
        name: jobName,
        data: {
          to: recipient.to,
          template_id:
            recipient.template_id !== null && recipient.template_id !== undefined
              ? recipient.template_id
              : jobTemplateRecords[jobName],
          variables: recipient.variables,
        },
        opts: {
          delay: 1000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }));

    await this.bulkQueue.addBulk(jobs);
    this.logger.log(`Enqueued ${jobs.length} bulk email jobs [${jobName}]`);
  }
}
