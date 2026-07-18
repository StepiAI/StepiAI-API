import { IsISO8601, IsOptional } from 'class-validator';

export class ListEventsQueryDto {
  @IsOptional()
  @IsISO8601()
  timeMin?: string;

  @IsOptional()
  @IsISO8601()
  timeMax?: string;
}
