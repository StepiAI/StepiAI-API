import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { ScheduleStatus } from '@prisma/client';

export class ListSchedulesQueryDto {
  @IsOptional()
  @IsISO8601()
  timeMin?: string;

  @IsOptional()
  @IsISO8601()
  timeMax?: string;

  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;
}
