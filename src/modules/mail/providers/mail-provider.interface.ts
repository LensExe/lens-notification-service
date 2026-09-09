export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailOutput {
  provider: string;
  statusCode: number;
}

/**
 * Injection token for the mail provider.
 * Use this token when injecting IMailProvider anywhere in the app.
 *
 * @example
 * constructor(@Inject(MAIL_PROVIDER) private readonly provider: IMailProvider) {}
 */
export const MAIL_PROVIDER = 'MAIL_PROVIDER';

/**
 * IMailProvider — abstraction for any transactional email provider.
 *
 * To swap providers (e.g. SendGrid → SES → Mailgun):
 *  1. Create a new service implementing this interface.
 *  2. Create a new module that provides it under the MAIL_PROVIDER token.
 *  3. Import the new module in AppModule instead of SendGridModule.
 */
export interface IMailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailOutput>;
}
