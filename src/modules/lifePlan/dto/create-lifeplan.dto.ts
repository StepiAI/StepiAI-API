import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DifficultyLevel, FocusPreferences, Weekday } from '@prisma/client';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ScheduleOverrideDto {
  @IsISO8601()
  date!: string;

  @Matches(TIME_PATTERN, { message: 'startTime must be in HH:mm format' })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: 'endTime must be in HH:mm format' })
  endTime!: string;
}

export class CreateLifePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @MinLength(5)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @MinLength(5)
  goal!: string;

  @IsArray()
  @IsString({ each: true })
  topic!: string[];

  @IsISO8601()
  startDate!: string;

  @IsISO8601()
  endDate!: string;

  @IsArray()
  @IsEnum(Weekday, { each: true })
  availableDays!: Weekday[];

  @Matches(TIME_PATTERN, { message: 'startTime must be in HH:mm format' })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: 'endTime must be in HH:mm format' })
  endTime!: string;

  @IsEnum(DifficultyLevel)
  difficultyLevel!: DifficultyLevel;

  @IsEnum(FocusPreferences)
  focusPreferences!: FocusPreferences;

  @IsOptional()
  @IsArray()
  @IsISO8601({}, { each: true })
  skippedDates?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleOverrideDto)
  scheduleOverrides?: ScheduleOverrideDto[];
}
