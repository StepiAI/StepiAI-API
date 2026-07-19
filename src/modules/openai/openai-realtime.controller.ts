// openai-realtime.controller.ts

import { Body, Controller, Post } from '@nestjs/common';
import { buildRealtimeScheduleInstructions } from '../chat/schedule-instructions';
import { CreateRealtimeSessionDto } from './dto/create-realtime-session.dto';
import { OpenAiService } from './openai.service';

@Controller('openai/realtime')
export class OpenAiRealtimeController {
  constructor(private readonly openAiService: OpenAiService) {}

  @Post('session')
  async createSession(
    @Body()
    dto: CreateRealtimeSessionDto,
  ) {
    return this.openAiService.createRealtimeClientSecret({
      language: dto.language,
      voice: dto.voice,
      instructions: buildRealtimeScheduleInstructions(new Date(), dto.timezone),
    });
  }
}
