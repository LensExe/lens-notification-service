import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsObject,
  IsEmail,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

@ValidatorConstraint({ name: 'isStringRecord', async: false })
class IsStringRecordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === 'string')
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must contain only string values`;
  }
}

export class SendSingleMailDto {
  @IsEmail()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  template_id?: string | null;

  @IsObject()
  @Validate(IsStringRecordConstraint)
  @IsOptional()
  variables?: Record<string, string>;
}

export class SendBulkMailDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SendSingleMailDto)
  recipients!: SendSingleMailDto[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @IsOptional()
  campaignId?: string;
}
