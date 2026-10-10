import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { BulkJobOptions, Queue } from 'bullmq';
import { createHash } from 'node:crypto';
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
  async enqueueSingle(
    jobName: MailJobName,
    data: SendSingleMailDto,
    jobId?: string,
  ): Promise<void> {
    const jobTemplateRecords = await this.jobTemplateService.getJobTemplateRecords();
    const templateId =
      data.template_id !== null && data.template_id !== undefined
        ? data.template_id
        : jobTemplateRecords[jobName];
    if (!templateId) {
      throw new Error(`No active template mapping found for mail job ${jobName}`);
    }
    if (data.template_id !== null && data.template_id !== undefined) {
      await this.jobTemplateService.assertActiveTemplateIds([data.template_id]);
    }
    await this.singleQueue.add(
      jobName,
      {
        to: data.to.trim().toLowerCase(),
        template_id: templateId,
        variables: data.variables,
      },
      {
        delay: 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        ...(jobId ? { jobId } : {}),
      },
    );
    this.logger.log(`Enqueued single email job [${jobName}] to=${this.maskEmail(data.to)}`);
  }

  /**
   * Enqueue multiple email jobs in bulk.
   */
  async enqueueBulk(jobName: MailJobName, payload: SendBulkMailDto): Promise<void> {
    const jobTemplateRecords = await this.jobTemplateService.getJobTemplateRecords();
    const defaultTemplateId = jobTemplateRecords[jobName];
    if (
      !defaultTemplateId &&
      payload.recipients.some(
        (recipient) => recipient.template_id === null || recipient.template_id === undefined,
      )
    ) {
      throw new Error(`No active template mapping found for mail job ${jobName}`);
    }
    await this.jobTemplateService.assertActiveTemplateIds(
      payload.recipients.flatMap((recipient) =>
        recipient.template_id !== null && recipient.template_id !== undefined
          ? [recipient.template_id]
          : [],
      ),
    );
    const jobs: { name: string; data: SendSingleMailDto; opts?: BulkJobOptions }[] =
      payload.recipients.map((recipient) => ({
        name: jobName,
        data: {
          to: recipient.to.trim().toLowerCase(),
          template_id:
            recipient.template_id !== null && recipient.template_id !== undefined
              ? recipient.template_id
              : defaultTemplateId,
          variables: recipient.variables,
        },
        opts: {
          delay: 1000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          ...(payload.campaignId ? { jobId: this.bulkJobId(payload.campaignId, recipient) } : {}),
        },
      }));

    await this.bulkQueue.addBulk(jobs);
    this.logger.log(
      `Enqueued ${jobs.length} bulk email jobs [${jobName}] campaign=${payload.campaignId ?? 'adhoc'}`,
    );
  }

  private bulkJobId(campaignId: string, recipient: SendSingleMailDto): string {
    const fingerprint = JSON.stringify({
      to: recipient.to.trim().toLowerCase(),
      template_id: recipient.template_id ?? null,
      variables: recipient.variables ?? {},
    });
    return `bulk-${createHash('sha256').update(`${campaignId}:${fingerprint}`).digest('hex')}`;
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.trim().split('@');
    if (!local || !domain) return '[invalid-email]';
    return `${local.slice(0, 1)}***@${domain}`;
  }
}
