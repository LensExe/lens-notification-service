import { Job } from 'bullmq';
import { NotificationDto } from './dto/notification.dto';
import { NotificationService } from './notification.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { NotificationJobName } from '../queue/enum/job.enum';

@Processor('notification-queue')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async process(job: Job<NotificationDto>): Promise<void> {
    switch (job.name) {
      case NotificationJobName.INSTANT.toString():
        this.logger.log(
          `Processing instant notification job [${job.name}] user_id=${job.data.userId}`,
        );
        await this.notificationService.notifyUser(job.data);
        return;
      case NotificationJobName.SCHEDULED.toString():
        this.logger.log(
          `Processing scheduled notification job [${job.name}] user_id=${job.data.userId}`,
        );
        await this.notificationService.notifyUser(job.data);
        return;
      case NotificationJobName.EMERGENCY.toString():
        this.logger.log(
          `Processing emergency notification job [${job.name}] user_id=${job.data.userId}`,
        );
        await this.notificationService.notifyUser(job.data);
        return;
      default:
        throw new Error(`Unsupported job: ${job.name}`);
    }
  }
}
