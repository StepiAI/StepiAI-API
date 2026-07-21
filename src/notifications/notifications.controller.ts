// import { Controller, Post, Body } from '@nestjs/common';
// import { NotificationsService } from './notifications.service';

// @Controller('notifications')
// export class NotificationsController {
//   constructor(private notificationsService: NotificationsService) {}

//   @Post('register-device')
//   async registerDevice(@Body() body: { userId: string; deviceToken: string }) {
//     return this.notificationsService.saveDeviceToken(
//       body.userId,
//       body.deviceToken,
//     );
//   }

//   @Post('send-to-user')
//   async sendToUser(
//     @Body()
//     body: {
//       userId: string;
//       title: string;
//       body: string;
//       data?: Record<string, string>;
//     },
//   ) {
//     return this.notificationsService.sendNotificationToUser(
//       body.userId,
//       body.title,
//       body.body,
//       body.data,
//     );
//   }

//   @Post('send-all')
//   async sendToAll(
//     @Body()
//     body: {
//       title: string;
//       body: string;
//       data?: Record<string, string>;
//     },
//   ) {
//     return this.notificationsService.sendNotificationToAll(
//       body.title,
//       body.body,
//       body.data,
//     );
//   }
// }
