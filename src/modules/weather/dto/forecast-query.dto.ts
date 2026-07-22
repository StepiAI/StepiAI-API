import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class ForecastQueryDto {
  @ValidateIf((dto: ForecastQueryDto) => dto.latitude === undefined)
  @IsString()
  @IsNotEmpty()
  location?: string;

  @ValidateIf((dto: ForecastQueryDto) => dto.location === undefined)
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ValidateIf((dto: ForecastQueryDto) => dto.location === undefined)
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
