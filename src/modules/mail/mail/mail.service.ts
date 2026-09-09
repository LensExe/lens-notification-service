import { Inject, Injectable, Logger } from '@nestjs/common';
import { SendSingleMailDto } from './dto/send-mail.dto';
import { type IMailProvider, MAIL_PROVIDER } from '../providers/mail-provider.interface';
import { TemplateService } from '../template/template.service';
import { EmailTemplate } from '../entity/email_template.entity';

/**
 * MailService — orchestrates email sending through the injected IMailProvider.
 *
 * This service is provider-agnostic: it never imports SendGrid or any SDK directly.
 * Swap the provider by changing the module imported in AppModule.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_PROVIDER) private readonly mailProvider: IMailProvider,
    private readonly templateService: TemplateService,
  ) {}

  async sendEmail(input: SendSingleMailDto): Promise<void> {
    const { to, template_id, variables } = input;
    const template: EmailTemplate | null = template_id
      ? await this.templateService.getTemplateById(template_id)
      : null;
    if (template === null) {
      throw new Error(`Template not found for template id: ${template_id}`);
    }

    const templateVariables: Record<string, string> = {};
    for (const variable of template.template_variables) {
      if (
        variable.is_required &&
        (variables?.[variable.variable_name] === '' ||
          variables?.[variable.variable_name] === undefined ||
          variables?.[variable.variable_name] === null)
      ) {
        throw new Error(`Variable ${variable.variable_name} is required`);
      } else {
        templateVariables[variable.variable_name] =
          variables?.[variable.variable_name]?.toString() ?? '';
      }
    }

    const html = await this.templateService.renderMjmlTemplate(template.body, templateVariables);
    this.logger.log(`Sending email to=${to}`);
    await this.mailProvider.sendEmail({ to, subject: template.subject, html });
  }
}
