import { IsBoolean } from 'class-validator';

export class ArchiveLifePlanDto {
  @IsBoolean()
  archived!: boolean;
}
