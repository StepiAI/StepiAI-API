import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export const realtimeVoices = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
];

export class CreateRealtimeSessionDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/)
  language?: string;

  @IsOptional()
  @IsIn(realtimeVoices)
  voice?: string;
}
