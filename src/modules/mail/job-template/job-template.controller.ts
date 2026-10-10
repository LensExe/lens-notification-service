import { Body, Controller, Get, Post } from '@nestjs/common';
import { JobTemplate } from '../entity/job_template.entity';
import { CreateJobTemplateDto } from './dto/create-job-template.dto';
import { JobTemplateService } from './job-template.service';
import { RequireRoles } from '../../../common/security/role.guard';

@Controller('mail/job-templates')
@RequireRoles('admin')
export class JobTemplateController {
  constructor(private readonly jobTemplateService: JobTemplateService) {}

  @Post()
  async createJobTemplate(@Body() input: CreateJobTemplateDto): Promise<JobTemplate> {
    return await this.jobTemplateService.createJobTemplate(input);
  }

  @Get()
  async listJobTemplates(): Promise<JobTemplate[]> {
    return await this.jobTemplateService.listJobTemplates();
  }

  @Get('records')
  async getJobTemplateRecords(): Promise<Record<string, string>> {
    return await this.jobTemplateService.getJobTemplateRecords();
  }
}
