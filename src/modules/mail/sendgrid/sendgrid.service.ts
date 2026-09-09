import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import { type ResponseError } from '@sendgrid/helpers/classes';
import {
  type IMailProvider,
  type SendEmailInput,
  type SendEmailOutput,
} from '../providers/mail-provider.interface';

/**
 * SendGridService — concrete implementation of IMailProvider using SendGrid.
 *
 * To replace with another provider, create a new service that implements
 * IMailProvider and swap the module in AppModule.
 */
@Injectable()
export class SendGridService implements IMailProvider {
  private readonly logger = new Logger(SendGridService.name);
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('SENDGRID_API_KEY');
    this.fromEmail = this.configService.getOrThrow<string>('SENDGRID_FROM_EMAIL');
    this.fromName = this.configService.get<string>('SENDGRID_FROM_NAME', 'Notification System');

    sgMail.setApiKey(apiKey);
    this.logger.log(`SendGrid initialized from=${this.fromEmail}`);
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    const msg = {
      to: input.to,
      from: { email: this.fromEmail, name: this.fromName },
      subject: input.subject,
      html: input.html,
    };

    try {
      const [response] = await sgMail.send(msg);
      this.logger.log(`[SendGrid] Email sent: to=${input.to}, statusCode=${response.statusCode}`);

      return { provider: 'sendgrid', statusCode: response.statusCode };
    } catch (error: unknown) {
      const sendGridError = error as ResponseError;
      this.logger.error(`[SendGrid] Failed to send to=${input.to}: ${sendGridError.message}`);
      throw sendGridError;
    }
  }
}
