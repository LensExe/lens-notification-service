import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Req,
  DefaultValuePipe,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationDto } from './dto/notification.dto';
import type { AuthenticatedRequest } from '../../../common/security/keycloak-jwt.guard';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  create(@Body() body: NotificationDto) {
    return this.notificationService.notifyUser(body);
  }

  @Get()
  get(
    @Req() request: AuthenticatedRequest,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    if (skip < 0 || limit < 1 || limit > 100)
      throw new BadRequestException('skip >= 0 and limit between 1 and 100 required');
    return this.notificationService.getNotifications(request.user.sub, skip, limit);
  }

  @Post('mark-read')
  markAsRead(@Req() request: AuthenticatedRequest) {
    return this.notificationService.markAsRead(request.user.sub);
  }
}
