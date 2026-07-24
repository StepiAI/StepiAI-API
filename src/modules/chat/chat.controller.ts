import {
  Body,
  Controller,
  Delete,
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
  async getMyChat(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.getOrCreateChat(user.id);
  }

  @Delete('messages')
  async clearChat(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.clearChat(user.id);
  }

  @Post('messages')
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chatService.sendMessage(user.id, dto);
  }

  @Post('voice/messages')
  async sendVoiceMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chatService.sendVoiceMessage(user.id, dto);
  }

  @Post('messages/:messageId/accept')
  async acceptSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.acceptScheduleProposal(
      user.id,
      messageId,
      user.provider,
    );
  }

  @Post('messages/:messageId/dismiss')
  async dismissSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.dismissScheduleProposal(user.id, messageId);
  }

  @Post('messages/:messageId/reject')
  async rejectProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.rejectProposal(user.id, messageId);
  }

  @Post('messages/:messageId/accept-schedule-update')
  async acceptScheduleUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.acceptScheduleUpdateProposal(
      user.id,
      messageId,
      user.provider,
    );
  }

  @Post('messages/:messageId/accept-schedule-delete')
  async acceptScheduleDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.acceptScheduleDeleteProposal(
      user.id,
      messageId,
      user.provider,
    );
  }

  @Post('messages/:messageId/accept-life-plan')
  async acceptLifePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.acceptLifePlanProposal(user.id, messageId);
  }

  @Post('messages/:messageId/accept-life-plan-update')
  async acceptLifePlanUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.acceptLifePlanUpdateProposal(user.id, messageId);
  }

  @Post('messages/:messageId/accept-life-plan-delete')
  async acceptLifePlanDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chatService.acceptLifePlanDeleteProposal(user.id, messageId);
  }
}
