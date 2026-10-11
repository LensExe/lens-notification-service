import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import mjml2html from 'mjml';
import { EmailTemplate, EmailTemplateSchema } from '../modules/mail/entity/email_template.entity';
import { JobTemplate, JobTemplateSchema } from '../modules/mail/entity/job_template.entity';
import { MailJobName } from '../modules/mail/mail/enum/mail.enum';
import { TemplateTypeEnum } from '../modules/mail/mail/enum/template.enum';

const TEMPLATE_VERSION = 'v1';
const TEMPLATE_DIRECTORY = join(process.cwd(), 'src/modules/mail/template/mjml');

const definitions = [
  {
    type: TemplateTypeEnum.OTP,
    jobName: MailJobName.SEND_OTP,
    filename: 'otp.mjml',
    subject: 'Mã xác thực OTP của bạn',
  },
  {
    type: TemplateTypeEnum.ORDER_CONFIRMATION,
    jobName: MailJobName.SEND_ORDER_CONFIRMATION,
    filename: 'order-confirmation.mjml',
    subject: 'Đơn hàng {{orderNumber}} đã được xác nhận',
  },
  {
    type: TemplateTypeEnum.PAYMENT_RECEIPT,
    jobName: MailJobName.SEND_PAYMENT_RECEIPT,
    filename: 'payment-receipt.mjml',
    subject: 'Thanh toán đơn {{orderNumber}} thành công',
  },
  {
    type: TemplateTypeEnum.SHIPPING_UPDATE,
    jobName: MailJobName.SEND_SHIPPING_UPDATE,
    filename: 'shipping-update.mjml',
    subject: 'Cập nhật giao hàng cho đơn {{orderNumber}}',
  },
  {
    type: TemplateTypeEnum.PROMOTION_CAMPAIGN,
    jobName: MailJobName.SEND_PROMOTION,
    filename: 'promotion-campaign.mjml',
    subject: '{{campaignTitle}} — ưu đãi {{discountLabel}}',
  },
] as const;

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function readVariables(subject: string, body: string): string[] {
  const placeholders = `${subject}\n${body}`.matchAll(/{{{?\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}?}}/g);
  return [...new Set([...placeholders].map((match) => match[1]))].sort();
}

async function seedEmailTemplates(): Promise<void> {
  const envFile = join(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const connection = await mongoose.connect(requireEnvironment('MONGO_URI'), {
    dbName: requireEnvironment('MONGO_DB_NAME'),
  });
  const emailTemplateModel = connection.model(EmailTemplate.name, EmailTemplateSchema);
  const jobTemplateModel = connection.model(JobTemplate.name, JobTemplateSchema);
  try {
    const seeded: Array<{ type: string; id: string; jobName: string }> = [];
    for (const definition of definitions) {
      const body = readFileSync(join(TEMPLATE_DIRECTORY, definition.filename), 'utf8');
      const compiled = await mjml2html(body, { validationLevel: 'soft' });
      if (compiled.errors.length > 0) {
        throw new Error(
          `${definition.filename} failed MJML validation:\n${compiled.errors.map((error) => error.formattedMessage).join('\n')}`,
        );
      }

      const variables = readVariables(definition.subject, body).map((variable_name) => ({
        id: randomUUID(),
        variable_name,
        is_required: true,
        created_at: new Date(),
      }));
      const existing = await emailTemplateModel.findOne({ template_type: definition.type }).exec();
      const savedTemplate = existing
        ? await emailTemplateModel
            .findOneAndUpdate(
              { id: existing.id },
              {
                $set: {
                  version: TEMPLATE_VERSION,
                  subject: definition.subject,
                  body,
                  engine: 'mjml+handlebars',
                  is_active: true,
                  template_variables: variables,
                },
              },
              { returnDocument: 'after' },
            )
            .exec()
        : await emailTemplateModel.create({
            id: randomUUID(),
            template_type: definition.type,
            version: TEMPLATE_VERSION,
            subject: definition.subject,
            body,
            engine: 'mjml+handlebars',
            is_active: true,
            template_variables: variables,
          });

      await jobTemplateModel
        .findOneAndUpdate(
          { job_name: definition.jobName },
          {
            $set: {
              template_type: definition.type,
              version: TEMPLATE_VERSION,
            },
            $setOnInsert: { id: randomUUID() },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        )
        .exec();
      if (!savedTemplate) throw new Error(`Could not seed ${definition.type}`);
      seeded.push({ type: definition.type, id: savedTemplate.id, jobName: definition.jobName });
    }

    for (const item of seeded) {
      console.log(`${item.type}: ${item.id} (${item.jobName})`);
    }
  } finally {
    await connection.disconnect();
  }
}

seedEmailTemplates().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
