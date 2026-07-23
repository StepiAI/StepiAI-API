import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SynthesizeVoiceDto {
  @IsString()
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  voice?: string;
}
