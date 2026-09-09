import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JobDto } from './dto/job.dto';
import { NotificationJobName } from './enum/job.enum';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('notification-queue')
    private readonly notiQueue: Queue,
  ) {}

  async enqueueNotification(jobDto: JobDto): Promise<void> {
    const { type, delay, payload } = jobDto;
    await this.notiQueue.add(type, payload, {
      priority: type === NotificationJobName.EMERGENCY ? 1 : 10,
      delay: type === NotificationJobName.SCHEDULED ? delay : 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }
}
