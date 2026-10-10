import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EmailTemplate } from '../entity/email_template.entity';
import { MailService } from '../mail/mail.service';
import { SendEmailInput, SendEmailOutput } from '../providers/mail-provider.interface';
import { TemplateService } from './template.service';

describe('MJML email templates', () => {
  const templateService = new TemplateService({} as never, {} as never);
  const templateDirectory = join(__dirname, 'mjml');

  it.each(readdirSync(templateDirectory).filter((filename) => filename.endsWith('.mjml')))(
    'compiles %s into responsive HTML',
    async (filename) => {
      const source = readFileSync(join(templateDirectory, filename), 'utf8');
      const html = await templateService.compileTemplate(source);
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    },
  );

  it('keeps subject values as plain text and escapes dynamic body values as HTML', async () => {
    const template = {
      subject: 'Hello {{name}}',
      body: '<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{name}}</mj-text></mj-column></mj-section></mj-body></mjml>',
      template_variables: [{ variable_name: 'name', is_required: true }],
    } as EmailTemplate;
    const provider = {
      sendEmail: jest
        .fn<Promise<SendEmailOutput>, [input: SendEmailInput]>()
        .mockResolvedValue({ provider: 'mock', statusCode: 202 }),
    };
    const templateService = new TemplateService({} as never, {} as never);
    jest.spyOn(templateService, 'getTemplateById').mockResolvedValue(template);
    const mailService = new MailService(provider, templateService);

    await mailService.sendEmail({
      to: 'user@example.com',
      template_id: 'template-id',
      variables: { name: '<Admin>' },
    });

    expect(provider.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Hello <Admin>' }),
    );
    const sentEmail = provider.sendEmail.mock.calls[0]?.[0];
    expect(sentEmail?.html).toContain('Hello &lt;Admin&gt;');
  });
});
