import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PushLaterDto {
  @IsISO8601()
  fromDateTime!: string;

  @IsISO8601()
  toDateTime!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  delayMinutes?: number;
}
