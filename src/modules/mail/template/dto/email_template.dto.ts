import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { TemplateTypeEnum } from '../../mail/enum/template.enum';
import { Variable } from './template_variable.dto';

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

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => Variable)
  template_variables?: Variable[];
}
