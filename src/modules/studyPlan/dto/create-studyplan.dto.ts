import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DifficultyLevel, FocusPreferences, Weekday } from '@prisma/client';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateStudyPlanDto {
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
}
