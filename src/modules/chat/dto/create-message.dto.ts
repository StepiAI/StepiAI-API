import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  content!: string;
}
