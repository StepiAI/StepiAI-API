import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../common/interfaces/request-with-user.interface';
import { CreateRealtimeSessionDto } from './dto/create-realtime-session.dto';
import { OpenAiService } from './openai.service';

@UseGuards(SupabaseAuthGuard)
@Controller('openai/realtime')
export class OpenAiRealtimeController {
  constructor(private readonly openAi: OpenAiService) {}

  @Post('session')
  createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRealtimeSessionDto,
  ) {
    return this.openAi.createRealtimeClientSecret({
      language: dto.language,
      voice: dto.voice,
      safetyIdentifier: createHash('sha256').update(user.id).digest('hex'),
    });
  }
}