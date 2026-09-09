import { Body, Controller, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import { TemplateService } from './template.service';
import { TemplateVariableDto } from './dto/template_variable.dto';
import { EmailTemplateDto } from './dto/email_template.dto';
import { EmailTemplate } from '../entity/email_template.entity';

@Controller('mail/templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Post()
  async addTemplate(@Body() template: EmailTemplateDto) {
    return await this.templateService.addTemplate(template);
  }

  @Post('variable')
  async addTemplateVariable(@Body() templateVariable: TemplateVariableDto) {
    return await this.templateService.addTempalteVariable(templateVariable);
  }

  @Get()
  async listTemplate(
    @Query('limit', ParseIntPipe) limit: number = 10,
    @Query('offset', ParseIntPipe) offset: number = 0,
  ): Promise<EmailTemplate[]> {
    return await this.templateService.listTemplate(limit, offset);
  }
}
