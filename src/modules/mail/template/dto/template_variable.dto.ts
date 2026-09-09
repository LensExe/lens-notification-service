import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class Variable {
  @IsString()
  @IsNotEmpty()
  variable_name!: string;

  @IsBoolean()
  @IsNotEmpty()
  is_required!: boolean;
}

export class TemplateVariableDto {
  @IsString()
  @IsNotEmpty()
  emailTemplateId!: string;

  @ValidateNested({ each: true })
  @Type(() => Variable)
  @IsNotEmpty()
  variables!: Variable[];
}
