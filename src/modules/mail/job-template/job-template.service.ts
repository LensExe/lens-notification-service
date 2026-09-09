import { Repository } from 'typeorm';
import { JobTemplate } from '../entity/job_template.entity';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { fromMailJobNameEnum } from '../mail/enum/mail.enum';
import { TemplateService } from '../template/template.service';
import { CreateJobTemplateDto } from './dto/create-job-template.dto';

@Injectable()
export class JobTemplateService {
  private readonly logger = new Logger(JobTemplateService.name);

  constructor(
    @InjectRepository(JobTemplate)
    private readonly jobTemplateRepository: Repository<JobTemplate>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private readonly templateService: TemplateService,
  ) {}

  async listJobTemplates(): Promise<JobTemplate[]> {
    return await this.jobTemplateRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  async getJobTemplateRecords(): Promise<Record<string, string>> {
    const cacheKey = `job_template_records`;
    const jobTemplateRecords: Record<string, string> | null = await this.cacheManager.get(cacheKey);
    if (jobTemplateRecords) return jobTemplateRecords;
    const jobTemplates: JobTemplate[] = await this.jobTemplateRepository.find();
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

  async createJobTemplate(input: CreateJobTemplateDto): Promise<JobTemplate> {
    const jobTemplate = this.jobTemplateRepository.create(input);
    const saved = await this.jobTemplateRepository.save(jobTemplate);
    await this.cacheManager.del('job_template_records');
    return saved;
  }
}
