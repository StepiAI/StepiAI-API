import { IsISO8601 } from 'class-validator';

export class RescheduleEventDto {
  @IsISO8601()
  startDateTime!: string;

  @IsISO8601()
  endDateTime!: string;
}
