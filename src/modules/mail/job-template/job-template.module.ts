import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { MongooseModule } from '@nestjs/mongoose';
import { JobTemplate, JobTemplateSchema } from '../entity/job_template.entity';
import { TemplateModule } from '../template/template.module';
import { JobTemplateService } from './job-template.service';
import { JobTemplateController } from './job-template.controller';

@Module({
  imports: [
    CacheModule.register(),
    MongooseModule.forFeature([{ name: JobTemplate.name, schema: JobTemplateSchema }]),
    TemplateModule,
  ],
  controllers: [JobTemplateController],
  providers: [JobTemplateService],
  exports: [JobTemplateService],
})
export class JobTemplateModule {}
