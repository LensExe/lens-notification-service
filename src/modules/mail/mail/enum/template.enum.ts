export enum TemplateTypeEnum {
  WELCOME = 'welcome',
  OTP = 'otp',
  RESET_PASSWORD = 'reset_password',
  ORDER_CONFIRMATION = 'order_confirmation',
  PAYMENT_RECEIPT = 'payment_receipt',
  SHIPPING_UPDATE = 'shipping_update',
  PROMOTION_CAMPAIGN = 'promotion_campaign',
}

const TEMPLATE_TYPE_VALUES = new Set<string>(Object.values(TemplateTypeEnum));

export function toTemplateTypeEnum(value: string): TemplateTypeEnum | null {
  return TEMPLATE_TYPE_VALUES.has(value) ? (value as TemplateTypeEnum) : null;
}

export function fromTemplateTypeEnum(value: TemplateTypeEnum): string {
  return value;
}
