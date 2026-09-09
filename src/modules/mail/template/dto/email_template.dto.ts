import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { TemplateTypeEnum } from '../../mail/enum/template.enum';

export class EmailTemplateDto {
  @IsEnum(TemplateTypeEnum)
  @IsNotEmpty()
  template_type!: TemplateTypeEnum;

  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsString()
  @IsNotEmpty()
  engine!: string;
}
