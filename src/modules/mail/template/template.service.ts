import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { EmailTemplate, EmailTemplateDocument } from '../entity/email_template.entity';
import { TemplateTypeEnum } from '../mail/enum/template.enum';
import mjml2html from 'mjml';
import * as Handlebars from 'handlebars';
import { EmailTemplateDto } from './dto/email_template.dto';
import { TemplateVariableDto, Variable } from './dto/template_variable.dto';

@Injectable()
export class TemplateService {
  constructor(
    @InjectModel(EmailTemplate.name)
    private readonly templateModel: Model<EmailTemplateDocument>,
  ) {}

  /**
   * Get template by template type and version.
   */
  async getTemplate(template_type: TemplateTypeEnum, version: string) {
    const template = await this.templateModel
      .findOne({ template_type, version, is_active: true })
      .select({ id: 1 })
      .lean()
      .exec();
    return template;
  }

  /**
   * Get template by template id.
   */
  async getTemplateById(template_id: string) {
    const template = await this.templateModel
      .findOne({ id: template_id, is_active: true })
      .select({ _id: 0, __v: 0 })
      .lean()
      .exec();
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

  /** Render plain-text subject content without HTML escaping. */
  renderSubjectTemplate(subject: string, data: Record<string, string>): string {
    const compiled = Handlebars.compile(subject, { noEscape: true });
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
   * Add a template and its embedded variables in one operation.
   */
  async addTemplate(template: EmailTemplateDto) {
    const templateVariables = (template.template_variables ?? []).map((variable: Variable) => ({
      id: randomUUID(),
      ...variable,
      created_at: new Date(),
    }));
    const templateDocument = await this.templateModel.create({
      ...template,
      id: randomUUID(),
      is_active: true,
      template_variables: templateVariables,
    });
    return templateDocument.toObject();
  }

  /**
   * Add template variable.
   */
  async addTempalteVariable(templateVariable: TemplateVariableDto) {
    const variables = templateVariable.variables.map((variable: Variable) => ({
      id: randomUUID(),
      ...variable,
      created_at: new Date(),
    }));
    const updated = await this.templateModel
      .findOneAndUpdate(
        { id: templateVariable.emailTemplateId },
        { $push: { template_variables: { $each: variables } } },
        { returnDocument: 'after' },
      )
      .select({ _id: 0, template_variables: 1 })
      .lean()
      .exec();
    if (!updated) throw new Error(`Email template not found: ${templateVariable.emailTemplateId}`);
    return updated.template_variables ?? [];
  }

  /**
   * List templates.
   */
  async listTemplate(limit: number, offset: number) {
    return await this.templateModel
      .find()
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .select({ _id: 0, __v: 0 })
      .lean()
      .exec();
  }
}
