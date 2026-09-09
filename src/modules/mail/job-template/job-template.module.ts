import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobTemplate } from '../entity/job_template.entity';
import { TemplateModule } from '../template/template.module';
import { JobTemplateService } from './job-template.service';
import { JobTemplateController } from './job-template.controller';

@Module({
  imports: [CacheModule.register(), TypeOrmModule.forFeature([JobTemplate]), TemplateModule],
  controllers: [JobTemplateController],
  providers: [JobTemplateService],
  exports: [JobTemplateService],
})
export class JobTemplateModule {}
