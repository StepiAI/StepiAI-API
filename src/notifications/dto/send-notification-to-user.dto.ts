export interface SendNotificationToUserDto {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}
