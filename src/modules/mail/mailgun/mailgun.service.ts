import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IMailProvider,
  SendEmailInput,
  SendEmailOutput,
} from '../providers/mail-provider.interface';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { AxiosError } from 'axios';

type MailgunClient = ReturnType<InstanceType<typeof Mailgun>['client']>;

@Injectable()
export class MailgunService implements IMailProvider {
  private readonly logger = new Logger(MailgunService.name);
  private readonly mgClient: MailgunClient;
  private readonly domain: string;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('MAILGUN_API_KEY');
    const baseUrl = this.configService.getOrThrow<string>('MAILGUN_BASE_URL');
    this.domain = this.configService.getOrThrow<string>('MAILGUN_DOMAIN');
    this.fromEmail = this.configService.getOrThrow<string>('MAILGUN_FROM_EMAIL');

    const mailgun = new Mailgun(formData);
    this.mgClient = mailgun.client({ username: 'api', key: apiKey, url: baseUrl });
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    try {
      const response = await this.mgClient.messages.create(this.domain, {
        to: [input.to],
        from: this.fromEmail,
        subject: input.subject,
        html: input.html,
        text: input.html,
      });
      this.logger.log(`[Mailgun] Email sent: to=${input.to}, status=${response.status}`);
      return { provider: 'mailgun', statusCode: response.status };
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        const status = error.response?.status ?? 0;
        const body = JSON.stringify(error.response?.data);
        this.logger.error(`[Mailgun] HTTP ${status} sending to=${input.to}: ${body}`);
        throw new InternalServerErrorException(`Mailgun API error (${status}): ${error.message}`);
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[Mailgun] Unexpected error sending to=${input.to}: ${msg}`);
      throw new InternalServerErrorException('Unexpected email sending error');
    }
  }
}
