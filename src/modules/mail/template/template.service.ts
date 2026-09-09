import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EmailTemplate } from '../entity/email_template.entity';
import { TemplateTypeEnum } from '../mail/enum/template.enum';
import mjml2html from 'mjml';
import * as Handlebars from 'handlebars';
import { EmailTemplateDto } from './dto/email_template.dto';
import { TemplateVariableDto, Variable } from './dto/template_variable.dto';
import { TemplateVariable } from '../entity/template_variable.entity';

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(EmailTemplate)
    private readonly templateRepository: Repository<EmailTemplate>,
    @InjectRepository(TemplateVariable)
    private readonly templateVariablesRepository: Repository<TemplateVariable>,
  ) {}

  /**
   * Get template by template type and version.
   */
  async getTemplate(template_type: TemplateTypeEnum, version: string) {
    const template: EmailTemplate | null = await this.templateRepository.findOne({
      where: { template_type: template_type, version: version },
      select: ['id'],
    });
    return template;
  }

  /**
   * Get template by template id.
   */
  async getTemplateById(template_id: string) {
    const template: EmailTemplate | null = await this.templateRepository.findOne({
      where: { id: template_id },
      select: ['id', 'template_type', 'version', 'subject', 'body', 'engine'],
      relations: ['template_variables'],
    });
    return template;
  }

  /**
   * Compile MJML source → HTML string.
   * Throws if MJML reports any errors.
   */
  async compileTemplate(mjmlBody: string): Promise<string> {
    const result = await mjml2html(mjmlBody, {
      validationLevel: 'soft',
    });

    if (result.errors.length > 0) {
      const messages = result.errors.map((e) => e.formattedMessage).join('\n');
      throw new Error(`MJML compilation failed:\n${messages}`);
    }
    return result.html;
  }

  /**
   * Substitute Handlebars variables into a compiled HTML string.
   * e.g. {{ userName }} → 'Harry'
   */
  renderTemplate(templateHtml: string, data: Record<string, string>): string {
    // Handlebars escapes HTML by default; use triple braces {{{ }}} only if
    // values may contain trusted HTML. For plain text values, double {{ }} is safe.
    const compiled = Handlebars.compile(templateHtml);
    return compiled(data);
  }

  /**
   * Full pipeline: MJML source → compiled HTML → Handlebars variable substitution.
   * Use this as the single entry-point when rendering a template end-to-end.
   */
  async renderMjmlTemplate(mjmlBody: string, data: Record<string, string>): Promise<string> {
    const html = await this.compileTemplate(mjmlBody);
    return this.renderTemplate(html, data);
  }

  /**
   * Add template.
   */
  async addTemplate(template: EmailTemplateDto) {
    const templateEntity = this.templateRepository.create(template);
    return await this.templateRepository.save(templateEntity);
  }

  /**
   * Add template variable.
   */
  async addTempalteVariable(templateVariable: TemplateVariableDto) {
    const entities: TemplateVariable[] = [];
    templateVariable.variables.forEach((variable: Variable) => {
      const templateVariableEntity = this.templateVariablesRepository.create({
        ...variable,
        emailTemplate: {
          id: templateVariable.emailTemplateId,
        },
      });
      entities.push(templateVariableEntity);
    });
    return await this.templateVariablesRepository.save(entities);
  }

  /**
   * List templates.
   */
  async listTemplate(limit: number, offset: number) {
    return await this.templateRepository.find({
      take: limit,
      skip: offset,
      order: {
        created_at: 'DESC',
      },
    });
  }
}
