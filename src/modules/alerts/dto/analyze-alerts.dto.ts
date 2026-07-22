import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';

export class AlertOriginDto {
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;
}

export class AlertEventDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  summary!: string;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsISO8601()
  startDateTime!: string;

  @IsISO8601()
  endDateTime!: string;
}

export class AnalyzeAlertsDto {
  @ValidateNested()
  @Type(() => AlertOriginDto)
  origin!: AlertOriginDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertEventDto)
  events!: AlertEventDto[];

  @IsOptional()
  @IsString()
  timezone?: string;
}
