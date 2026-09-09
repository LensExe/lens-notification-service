export enum MailQueue {
  SINGLE = 'email-single-queue',
  BULK = 'email-bulk-queue',
}

const MAIL_QUEUE_VALUES = new Set<string>(Object.values(MailQueue));

export function toMailQueueEnum(value: string): MailQueue | null {
  return MAIL_QUEUE_VALUES.has(value) ? (value as MailQueue) : null;
}

export function fromMailQueueEnum(value: MailQueue): string {
  return value;
}
