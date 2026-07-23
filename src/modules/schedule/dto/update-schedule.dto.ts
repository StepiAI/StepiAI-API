import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateScheduleDto {
  @IsString()
  @MaxLength(255)
  summary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @IsISO8601()
  startDateTime!: string;

  @IsISO8601()
  endDateTime!: string;
}
