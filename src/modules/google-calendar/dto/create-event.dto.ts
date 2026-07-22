import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MaxLength(255)
  summary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsISO8601()
  startDateTime!: string;

  @IsISO8601()
  endDateTime!: string;

  /**
   * Aturan pengulangan format RFC 5545, mis. ["RRULE:FREQ=WEEKLY;INTERVAL=2"].
   * Diteruskan apa adanya ke Google — mereka yang jadi sumber kebenaran soal
   * tanggal instance-nya, jadi kita gak perlu ngitung sendiri.
   */
  /**
   * Zona waktu IANA, mis. "Asia/Jakarta". Wajib diisi kalau `recurrence` ada —
   * Google nolak event berulang tanpa ini, karena RRULE butuh tau "jam 2 pagi"
   * itu jam 2 di zona mana buat ngitung instance berikutnya.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeZone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @Matches(/^(RRULE|RDATE|EXRULE|EXDATE):/, {
    each: true,
    message:
      'recurrence harus diawali RRULE:, RDATE:, EXRULE:, atau EXDATE: (RFC 5545)',
  })
  recurrence?: string[];
}
