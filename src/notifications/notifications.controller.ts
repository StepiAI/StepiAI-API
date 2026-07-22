import { Controller, Post, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { SaveDeviceTokenDto } from './dto/save-device-token.dto';
import type { SendNotificationToUserDto } from './dto/send-notification-to-user.dto';
import type { SaveNotificationToAllDto } from './dto/save-notification-to-all.dto';
import type { AddNotificationJobDto } from './dto/add-notification-job.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Post('register-device')
  async registerDevice(@Body() body: SaveDeviceTokenDto) {
    return this.notificationsService.saveDeviceToken(body);
  }

  @Post('send-to-user')
  async sendToUser(
    @Body()
    body: SendNotificationToUserDto,
  ) {
    return this.notificationsService.sendNotificationToUser(body);
  }

  @Post('send-all')
  async sendToAll(
    @Body()
    body: SaveNotificationToAllDto,
  ) {
    return this.notificationsService.sendNotificationToAll(body);
  }

  @Post('add-job')
  async addJob(
    @Body()
    body: AddNotificationJobDto,
  ) {
    return this.notificationsService.addNotificationJob(body);
  }
}
