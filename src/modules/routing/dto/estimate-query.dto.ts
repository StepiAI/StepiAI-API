import { Type } from 'class-transformer';
import { IsISO8601, IsLatitude, IsLongitude, IsOptional } from 'class-validator';

export class EstimateQueryDto {
  @Type(() => Number)
  @IsLatitude()
  fromLat!: number;

  @Type(() => Number)
  @IsLongitude()
  fromLng!: number;

  @Type(() => Number)
  @IsLatitude()
  toLat!: number;

  @Type(() => Number)
  @IsLongitude()
  toLng!: number;

  @IsOptional()
  @IsISO8601()
  departAt?: string;
}
