import { SendNotificationToUserDto } from './send-notification-to-user.dto';

export interface AddNotificationJobDto {
  name: string;
  cronExpression: string;
  notificationData: SendNotificationToUserDto;
}
