import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { JobTemplate, JobTemplateDocument } from '../entity/job_template.entity';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { fromMailJobNameEnum } from '../mail/enum/mail.enum';
import { TemplateService } from '../template/template.service';
import { CreateJobTemplateDto } from './dto/create-job-template.dto';

@Injectable()
export class JobTemplateService {
  private readonly logger = new Logger(JobTemplateService.name);

  constructor(
    @InjectModel(JobTemplate.name)
    private readonly jobTemplateModel: Model<JobTemplateDocument>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private readonly templateService: TemplateService,
  ) {}

  async listJobTemplates(): Promise<JobTemplate[]> {
    return await this.jobTemplateModel.find().sort({ created_at: -1 }).lean().exec();
  }

  async getJobTemplateRecords(): Promise<Record<string, string>> {
    const cacheKey = `job_template_records`;
    const jobTemplateRecords: Record<string, string> | null = await this.cacheManager.get(cacheKey);
    if (jobTemplateRecords) return jobTemplateRecords;
    const jobTemplates = await this.jobTemplateModel.find().lean().exec();
    const newRecords: Record<string, string> = {};
    for (const jobTemplate of jobTemplates) {
      const { job_name, template_type, version } = jobTemplate;
      const template = await this.templateService.getTemplate(template_type, version);
      if (!template) {
        this.logger.error(`Template not found for template type: ${template_type}`);
        continue;
      }
      newRecords[fromMailJobNameEnum(job_name)] = template.id;
    }
    await this.cacheManager.set(cacheKey, newRecords);
    return newRecords;
  }

  async assertActiveTemplateIds(templateIds: Iterable<string>): Promise<void> {
    const uniqueIds = [...new Set(templateIds)];
    if (uniqueIds.length === 0) return;

    const templates = await Promise.all(
      uniqueIds.map((templateId) => this.templateService.getTemplateById(templateId)),
    );
    const missingIds = uniqueIds.filter((_, index) => !templates[index]);
    if (missingIds.length > 0) {
      throw new Error(`Active email template not found: ${missingIds.join(', ')}`);
    }
  }

  async createJobTemplate(input: CreateJobTemplateDto): Promise<JobTemplate> {
    const saved = await this.jobTemplateModel.create({ ...input, id: randomUUID() });
    await this.cacheManager.del('job_template_records');
    return saved.toObject();
  }
}
