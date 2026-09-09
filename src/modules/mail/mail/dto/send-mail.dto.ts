import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsObject,
  IsEmail,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SendSingleMailDto {
  @IsEmail()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsOptional()
  template_id?: string | null;

  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;
}

export class SendBulkMailDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SendSingleMailDto)
  recipients!: SendSingleMailDto[];

  @IsString()
  @IsOptional()
  campaignId?: string;
}
