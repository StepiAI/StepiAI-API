import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
