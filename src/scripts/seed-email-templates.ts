import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import mjml2html from 'mjml';
import { EmailTemplate } from '../modules/mail/entity/email_template.entity';
import { JobTemplate } from '../modules/mail/entity/job_template.entity';
import { TemplateVariable } from '../modules/mail/entity/template_variable.entity';
import { MailJobName } from '../modules/mail/mail/enum/mail.enum';
import { TemplateTypeEnum } from '../modules/mail/mail/enum/template.enum';

const TEMPLATE_VERSION = 'v1';
const TEMPLATE_DIRECTORY = join(process.cwd(), 'src/modules/mail/template/mjml');

const definitions = [
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
  const migrationFile = join(process.cwd(), 'sql/20261010_add_ecommerce_email_templates.sql');

  const dataSource = new DataSource({
    type: 'postgres',
    host: requireEnvironment('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    database: requireEnvironment('DB_NAME'),
    username: requireEnvironment('DB_USERNAME'),
    password: requireEnvironment('DB_PASSWORD'),
    entities: [EmailTemplate, TemplateVariable, JobTemplate],
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    await dataSource.query(readFileSync(migrationFile, 'utf8'));
    const seeded: Array<{ type: string; id: string; jobName: string }> = [];
    await dataSource.transaction(async (manager) => {
      for (const definition of definitions) {
        const body = readFileSync(join(TEMPLATE_DIRECTORY, definition.filename), 'utf8');
        const compiled = await mjml2html(body, { validationLevel: 'soft' });
        if (compiled.errors.length > 0) {
          throw new Error(
            `${definition.filename} failed MJML validation:\n${compiled.errors.map((error) => error.formattedMessage).join('\n')}`,
          );
        }

        const existing = await manager.findOneBy(EmailTemplate, {
          template_type: definition.type,
        });
        const template = manager.create(EmailTemplate, {
          ...(existing ?? {}),
          template_type: definition.type,
          version: TEMPLATE_VERSION,
          subject: definition.subject,
          body,
          engine: 'mjml+handlebars',
          is_active: true,
        });
        const savedTemplate = await manager.save(EmailTemplate, template);

        const oldVariables = await manager.find(TemplateVariable, {
          where: { emailTemplate: { id: savedTemplate.id } },
        });
        if (oldVariables.length > 0) await manager.remove(TemplateVariable, oldVariables);

        const variables = readVariables(definition.subject, body).map((variable_name) =>
          manager.create(TemplateVariable, {
            variable_name,
            is_required: true,
            emailTemplate: savedTemplate,
          }),
        );
        if (variables.length > 0) await manager.save(TemplateVariable, variables);

        const existingJobMapping = await manager.findOneBy(JobTemplate, {
          job_name: definition.jobName,
        });
        if (!existingJobMapping) {
          await manager.save(
            JobTemplate,
            manager.create(JobTemplate, {
              job_name: definition.jobName,
              template_type: definition.type,
              version: TEMPLATE_VERSION,
            }),
          );
        }
        seeded.push({ type: definition.type, id: savedTemplate.id, jobName: definition.jobName });
      }
    });

    for (const item of seeded) {
      console.log(`${item.type}: ${item.id} (${item.jobName})`);
    }
  } finally {
    await dataSource.destroy();
  }
}

seedEmailTemplates().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
