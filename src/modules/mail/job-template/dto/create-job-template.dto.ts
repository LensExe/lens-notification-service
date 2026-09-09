import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { MailJobName } from '../../mail/enum/mail.enum';
import { TemplateTypeEnum } from '../../mail/enum/template.enum';

export class CreateJobTemplateDto {
  @IsEnum(MailJobName)
  job_name!: MailJobName;

  @IsEnum(TemplateTypeEnum)
  template_type!: TemplateTypeEnum;

  @IsString()
  @IsNotEmpty()
  version!: string;
}
