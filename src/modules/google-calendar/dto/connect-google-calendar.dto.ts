import { IsString } from 'class-validator';

export class ConnectGoogleCalendarDto {
  @IsString()
  serverAuthCode!: string;
}
