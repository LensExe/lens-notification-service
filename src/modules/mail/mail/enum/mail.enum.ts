export enum MailJobName {
  SEND_OTP = 'send-otp-email',
  SEND_TRANSACTIONAL = 'send-transactional-email',
  SEND_WELCOME = 'send-welcome-email',
}

const MAIL_JOB_NAME_VALUES = new Set<string>(Object.values(MailJobName));

export function toMailJobNameEnum(value: string): MailJobName | null {
  return MAIL_JOB_NAME_VALUES.has(value) ? (value as MailJobName) : null;
}

export function fromMailJobNameEnum(value: MailJobName): string {
  return value;
}

export { MailQueue } from '../../queue/enum/mail-queue.enum';
