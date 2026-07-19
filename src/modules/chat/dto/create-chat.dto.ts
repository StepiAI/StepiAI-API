import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
