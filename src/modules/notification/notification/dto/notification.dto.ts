import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class NotificationDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsObject()
  @IsOptional()
  data?: unknown;
}
