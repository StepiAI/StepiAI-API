import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';

type SupabaseAuthenticatedRequest = Request & {
  user?: {
    id?: string;
    sub?: string;
  };
};

@UseGuards(SupabaseAuthGuard)
@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  private getUserId(request: SupabaseAuthenticatedRequest): string {
    // `sub` is the standard Supabase JWT user identifier.
    const userId = request.user?.sub ?? request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Unauthorized');
    }

    return userId;
  }

  @Get()
  getMyChat(@Req() request: SupabaseAuthenticatedRequest) {
    return this.chatService.getOrCreateChat(this.getUserId(request));
  }

  @Post('messages')
  sendMessage(
    @Req() request: SupabaseAuthenticatedRequest,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chatService.sendMessage(this.getUserId(request), dto);
  }
}
