import { Controller, Post, Body, HttpCode, HttpStatus, Param, ParseEnumPipe } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { SendSingleMailDto, SendBulkMailDto } from './dto/send-mail.dto';
import { MailJobName } from './enum/mail.enum';

@Controller('mail')
export class MailController {
  constructor(private readonly queueService: QueueService) {}

  @Post(':jobName/single')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendTemplateSingle(
    @Param('jobName', new ParseEnumPipe(MailJobName)) jobName: MailJobName,
    @Body() dto: SendSingleMailDto,
  ) {
    await this.queueService.enqueueSingle(jobName, dto);
    return { message: `Single ${jobName} email queued successfully` };
  }

  @Post(':jobName/bulk')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendTemplateBulk(
    @Param('jobName', new ParseEnumPipe(MailJobName)) jobName: MailJobName,
    @Body() dto: SendBulkMailDto,
  ) {
    await this.queueService.enqueueBulk(jobName, dto);
    return {
      message: `Bulk ${jobName} emails queued successfully (${dto.recipients.length} recipients)`,
    };
  }
}
