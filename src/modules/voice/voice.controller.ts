import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { SynthesizeVoiceDto } from './dto/synthesize-voice.dto';
import { VoiceService } from './voice.service';

@UseGuards(SupabaseAuthGuard)
@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Post('tts')
  @HttpCode(200)
  async synthesizeSpeech(
    @Body() dto: SynthesizeVoiceDto,
    @Res() response: Response,
  ): Promise<void> {
    const speech = await this.voiceService.synthesizeSpeech(
      dto.text,
      dto.voice,
    );

    response.status(200);
    response.set({
      'Content-Type': speech.contentType,
      'Content-Length': speech.audio.length.toString(),
      'Content-Disposition': 'attachment; filename="stepi-voice.mp3"',
      'X-Audio-Output-Format': speech.outputFormat,
      'Cache-Control': 'no-store',
    });

    response.end(speech.audio);
  }
}
