import { IsString } from 'class-validator';

export class CreateExampleDto {
  @IsString()
  title!: string;
}
