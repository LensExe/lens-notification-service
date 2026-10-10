import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BulkJobOptions, Job, Queue } from 'bullmq';
import { EmailTemplate } from '../entity/email_template.entity';
import { TemplateVariable } from '../entity/template_variable.entity';
import { JobTemplateService } from '../job-template/job-template.service';
import { MailJobName } from './enum/mail.enum';
import { MailBulkProcessor, MailSingleProcessor } from './mail.processor';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { QueueService } from '../queue/queue.service';
import { SendSingleMailDto } from './dto/send-mail.dto';
import { TemplateService } from '../template/template.service';
import { SendEmailInput, SendEmailOutput } from '../providers/mail-provider.interface';

type BulkQueueJob = { name: string; data: SendSingleMailDto; opts?: BulkJobOptions };

const readTemplate = (filename: string): string =>
  readFileSync(join(__dirname, '../template/mjml', filename), 'utf8');

const requiredVariables = (subject: string, body: string): string[] => {
  const placeholders = `${subject}\n${body}`.matchAll(/{{{?\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}?}}/g);
  return [...new Set([...placeholders].map((match) => match[1]))].sort();
};

describe('mail queue to provider flow', () => {
  const orderBody = readTemplate('order-confirmation.mjml');
  const promotionBody = readTemplate('promotion-campaign.mjml');
  const templates = new Map<string, EmailTemplate>([
    [
      'order-template',
      {
        id: 'order-template',
        template_type: 'order_confirmation' as EmailTemplate['template_type'],
        version: 'v1',
        subject: 'Đơn hàng {{orderNumber}} đã được xác nhận',
        body: orderBody,
        engine: 'mjml+handlebars',
        is_active: true,
        template_variables: requiredVariables(
          'Đơn hàng {{orderNumber}} đã được xác nhận',
          orderBody,
        ).map((variable_name) => ({ variable_name, is_required: true }) as TemplateVariable),
      } as EmailTemplate,
    ],
    [
      'promotion-template',
      {
        id: 'promotion-template',
        template_type: 'promotion_campaign' as EmailTemplate['template_type'],
        version: 'v1',
        subject: '{{campaignTitle}} — ưu đãi {{discountLabel}}',
        body: promotionBody,
        engine: 'mjml+handlebars',
        is_active: true,
        template_variables: requiredVariables(
          '{{campaignTitle}} — ưu đãi {{discountLabel}}',
          promotionBody,
        ).map((variable_name) => ({ variable_name, is_required: true }) as TemplateVariable),
      } as EmailTemplate,
    ],
  ]);

  const orderVariables = {
    appName: 'Lens',
    customerName: 'A <B>',
    orderNumber: 'ORD-42',
    orderDate: '10/10/2026',
    subtotal: '1.200.000',
    shippingFee: '30.000',
    totalAmount: '1.230.000',
    currency: 'VND',
    orderUrl: 'https://shop.example.com/orders/ORD-42',
    supportEmail: 'support@example.com',
    year: '2026',
  };

  const promotionVariables = (customerName: string) => ({
    appName: 'Lens',
    customerName,
    campaignTitle: 'Ưu đãi mùa hè',
    discountLabel: 'Giảm 20%',
    promotionDescription: 'Ưu đãi áp dụng cho sản phẩm được chọn.',
    promoCode: 'SUMMER20',
    expiryDate: '31/10/2026',
    promotionUrl: 'https://shop.example.com/promotions/summer',
    unsubscribeUrl: 'https://shop.example.com/email-preferences/unsubscribe?token=user-token',
    supportEmail: 'support@example.com',
    year: '2026',
  });

  function createHarness() {
    const provider = {
      sendEmail: jest
        .fn<Promise<SendEmailOutput>, [input: SendEmailInput]>()
        .mockResolvedValue({ provider: 'mock', statusCode: 202 }),
    };
    const templateService = new TemplateService({} as never, {} as never);
    jest
      .spyOn(templateService, 'getTemplateById')
      .mockImplementation((id) => Promise.resolve(templates.get(id) ?? null));
    const mailService = new MailService(provider, templateService);
    const singleQueue = {
      add: jest
        .fn<Promise<unknown>, [name: string, data: SendSingleMailDto, options: BulkJobOptions]>()
        .mockResolvedValue(undefined),
    };
    const bulkQueue = {
      addBulk: jest.fn<Promise<unknown[]>, [jobs: BulkQueueJob[]]>().mockResolvedValue([]),
    };
    const jobTemplateService = {
      getJobTemplateRecords: jest.fn().mockResolvedValue({
        [MailJobName.SEND_ORDER_CONFIRMATION]: 'order-template',
        [MailJobName.SEND_PROMOTION]: 'promotion-template',
      }),
      assertActiveTemplateIds: jest.fn().mockResolvedValue(undefined),
    };
    const queueService = new QueueService(
      singleQueue as unknown as Queue<SendSingleMailDto>,
      bulkQueue as unknown as Queue<SendSingleMailDto>,
      jobTemplateService as unknown as JobTemplateService,
    );
    const mailController = new MailController(queueService);

    return {
      provider,
      templateService,
      mailService,
      singleQueue,
      bulkQueue,
      jobTemplateService,
      queueService,
      mailController,
    };
  }

  it('renders and delivers a single order email through the worker without a real provider', async () => {
    const harness = createHarness();
    const processor = new MailSingleProcessor(harness.mailService);

    const response = await harness.mailController.sendTemplateSingle(
      MailJobName.SEND_ORDER_CONFIRMATION,
      { to: 'Customer@Example.com', variables: orderVariables },
    );
    expect(response.message).toBe('Single send-order-confirmation-email email queued successfully');

    const [jobName, data, options] = harness.singleQueue.add.mock.calls[0] as [
      string,
      SendSingleMailDto,
      { delay: number; attempts: number },
    ];
    expect(data.to).toBe('customer@example.com');
    expect(data.template_id).toBe('order-template');
    expect(options).toMatchObject({ delay: 1000, attempts: 3 });

    await processor.process({ id: 'single-job', name: jobName, data } as Job<SendSingleMailDto>);

    expect(harness.provider.sendEmail).toHaveBeenCalledTimes(1);
    const sentEmail = harness.provider.sendEmail.mock.calls[0]?.[0];
    expect(sentEmail?.to).toBe('customer@example.com');
    expect(sentEmail?.subject).toBe('Đơn hàng ORD-42 đã được xác nhận');
    expect(sentEmail?.html).toContain('ORD-42');
    expect(sentEmail?.html).toContain('A &lt;B&gt;');
  });

  it('queues one independent bulk job per recipient and sends each through the bulk worker', async () => {
    const harness = createHarness();
    const processor = new MailBulkProcessor(harness.mailService);
    const payload = {
      campaignId: 'summer-sale-2026',
      recipients: [
        { to: 'First@Example.com', variables: promotionVariables('First Customer') },
        { to: 'second@example.com', variables: promotionVariables('Second Customer') },
      ],
    };

    const response = await harness.mailController.sendTemplateBulk(
      MailJobName.SEND_PROMOTION,
      payload,
    );
    expect(response.message).toBe(
      'Bulk send-promotion-email emails queued successfully (2 recipients)',
    );
    const jobs = harness.bulkQueue.addBulk.mock.calls[0]?.[0] as Array<{
      name: string;
      data: SendSingleMailDto;
      opts: { jobId: string; delay: number };
    }>;
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.data.to)).toEqual(['first@example.com', 'second@example.com']);
    expect(jobs.map((job) => job.data.template_id)).toEqual([
      'promotion-template',
      'promotion-template',
    ]);
    expect(jobs[0]?.opts.jobId).not.toBe(jobs[1]?.opts.jobId);
    expect(jobs[0]?.opts.delay).toBe(1000);

    for (const [index, job] of jobs.entries()) {
      await processor.process({
        id: job.opts.jobId,
        name: job.name,
        data: job.data,
      } as Job<SendSingleMailDto>);
      if (index === 0) {
        expect(harness.provider.sendEmail).toHaveBeenCalledTimes(1);
      }
    }

    expect(harness.provider.sendEmail).toHaveBeenCalledTimes(2);
    expect(harness.provider.sendEmail.mock.calls.map(([email]) => email.to)).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
    expect(harness.provider.sendEmail.mock.calls[1]?.[0].html).toContain('Second Customer');

    await harness.mailController.sendTemplateBulk(MailJobName.SEND_PROMOTION, payload);
    const repeatedJobs = harness.bulkQueue.addBulk.mock.calls[1]?.[0] as Array<{
      opts: { jobId: string };
    }>;
    expect(repeatedJobs.map((job) => job.opts.jobId)).toEqual(jobs.map((job) => job.opts.jobId));
  });

  it('rejects an email missing a required template variable before calling the provider', async () => {
    const harness = createHarness();
    await expect(
      harness.mailService.sendEmail({
        to: 'customer@example.com',
        template_id: 'order-template',
        variables: { orderNumber: 'ORD-42' },
      }),
    ).rejects.toThrow('Variable appName is required');
    expect(harness.provider.sendEmail).not.toHaveBeenCalled();
  });
});
