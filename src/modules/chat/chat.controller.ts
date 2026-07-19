import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  getMyChat(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.getOrCreateChat(user.id);
  }

  @Get(':chatId')
  getChatById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('chatId', ParseUUIDPipe) chatId: string,
  ) {
    return this.chatService.getChatById(user.id, chatId);
  }

  @Post('messages')
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chatService.sendMessage(user.id, dto);
  }

  @Post('messages/:messageId/accept')
  acceptSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.acceptScheduleProposal(
      user.id,
      messageId,
      user.provider,
    );
  }
}
