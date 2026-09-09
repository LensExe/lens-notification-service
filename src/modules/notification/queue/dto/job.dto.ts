import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NotificationDto } from '../../notification/dto/notification.dto';
import { NotificationJobName } from '../enum/job.enum';
import { Type } from 'class-transformer';

export class JobDto {
  @IsEnum(NotificationJobName)
  type!: NotificationJobName;

  @ValidateIf((o: JobDto) => o.type === NotificationJobName.SCHEDULED)
  @IsPositive()
  @IsOptional()
  delay?: number;

  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => NotificationDto)
  payload!: NotificationDto;
}
