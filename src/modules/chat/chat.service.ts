import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Schedule, LifePlan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { OpenAiService } from '../openai/openai.service';
import {
  CreateLifePlanFromAiDto,
  LifePlanConflictResult,
  LifePlanService,
} from '../lifePlan/lifeplan.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { buildScheduleInstructions } from './schedule-instructions';

export interface ScheduleProposal {
  type: 'schedule_proposal';
  summary: string;
  description: string | null;
  location: string | null;
  startDateTime: string;
  endDateTime: string;
}

export interface ScheduleAcceptedMessage {
  type: 'schedule_accepted';
  content: string;
  scheduleId: string;
  proposal: ScheduleProposal;
}

export interface ScheduleDismissedMessage {
  type: 'schedule_dismissed';
  content: string;
  proposal: ScheduleProposal;
}

export interface ScheduleUpdateProposal {
  type: 'schedule_update_proposal';
  scheduleId: string;
  summary: string;
  description: string | null;
  location: string | null;
  startDateTime: string;
  endDateTime: string;
}

export interface ScheduleUpdateAcceptedMessage {
  type: 'schedule_update_accepted';
  content: string;
  scheduleId: string;
  proposal: ScheduleUpdateProposal;
}

export interface ScheduleDeleteProposal {
  type: 'schedule_delete_proposal';
  scheduleId: string;
  summary: string;
}

export interface ScheduleDeleteAcceptedMessage {
  type: 'schedule_delete_accepted';
  content: string;
  scheduleId: string;
  proposal: ScheduleDeleteProposal;
}

export interface AssistantMessage {
  type: 'message';
  content: string;
}

export interface NeedsInfoMessage {
  type: 'need_info';
  content: string;
}

export type LifePlanProposal = CreateLifePlanFromAiDto & {
  type: 'life_plan_proposal';
};

export type LifePlanUpdateProposal = CreateLifePlanFromAiDto & {
  type: 'life_plan_update_proposal';
  lifePlanId: string;
};

export interface LifePlanAcceptedMessage {
  type: 'life_plan_accepted';
  content: string;
  lifePlanId: string;
  proposal: LifePlanProposal;
}

export interface LifePlanUpdateAcceptedMessage {
  type: 'life_plan_update_accepted';
  content: string;
  lifePlanId: string;
  proposal: LifePlanUpdateProposal;
}

export interface LifePlanDeleteProposal {
  type: 'life_plan_delete_proposal';
  lifePlanId: string;
  title: string;
}

export interface LifePlanDeleteAcceptedMessage {
  type: 'life_plan_delete_accepted';
  content: string;
  lifePlanId: string;
  proposal: LifePlanDeleteProposal;
}

type ParsedAssistantResponse =
  | ScheduleProposal
  | ScheduleAcceptedMessage
  | ScheduleDismissedMessage
  | ScheduleUpdateProposal
  | ScheduleUpdateAcceptedMessage
  | ScheduleDeleteProposal
  | ScheduleDeleteAcceptedMessage
  | AssistantMessage
  | NeedsInfoMessage
  | LifePlanProposal
  | LifePlanUpdateProposal
  | LifePlanConflictResult
  | LifePlanAcceptedMessage
  | LifePlanUpdateAcceptedMessage
  | LifePlanDeleteProposal
  | LifePlanDeleteAcceptedMessage;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAiService: OpenAiService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly lifePlanService: LifePlanService,
  ) {}

  async getOrCreateChat(userId: string) {
    const chat = await this.findOrCreateChatRecord(userId);
    return { ...chat };
  }

  /**
   * Clears message history for the user's chat. Schedules created from those
   * messages are real calendar data, not chat state, so they're unlinked
   * (messageId -> null) rather than deleted.
   */
  async clearChat(userId: string) {
    const chat = await this.findOrCreateChatRecord(userId);

    await this.prisma.$transaction([
      this.prisma.schedule.updateMany({
        where: { message: { chatId: chat.id } },
        data: { messageId: null },
      }),
      this.prisma.message.deleteMany({ where: { chatId: chat.id } }),
    ]);

    return { ...chat, messages: [] };
  }

  private async findOrCreateChatRecord(userId: string) {
    const existing = await this.prisma.chat.findUnique({
      where: { userId: userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { schedule: true },
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.chat.create({
      data: { userId },
      include: { messages: { include: { schedule: true } } },
    });
  }

  async sendMessage(userId: string, dto: CreateMessageDto) {
    const chat = await this.findOrCreateChatRecord(userId);

    const userMessage = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'user',
        content: dto.content,
      },
    });

    const history = await this.prisma.message.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'asc' },
      include: { schedule: true },
    });

    const conversation = history
      .map((message) => {
        const base = `${message.role}: ${message.content}`;

        if (!message.schedule) return base;

        return `${base}\nschedule_context: ${JSON.stringify({
          scheduleId: message.schedule.id,
          status: message.schedule.status,
          summary: message.schedule.summary,
          description: message.schedule.description,
          location: message.schedule.location,
          startDateTime: message.schedule.startDateTime.toISOString(),
          endDateTime: message.schedule.endDateTime.toISOString(),
        })}`;
      })
      .join('\n');

    let parsed: ParsedAssistantResponse;

    try {
      const raw = await this.openAiService.generateText(conversation, {
        instructions: buildScheduleInstructions(new Date(), dto.timezone),
      });

      parsed = JSON.parse(raw) as ParsedAssistantResponse;
    } catch (error) {
      throw new InternalServerErrorException(
        'Unable to get a response from the AI assistant',
        String(error),
      );
    }

    const isScheduleProposal = parsed.type === 'schedule_proposal';
    let isScheduleUpdateProposal = parsed.type === 'schedule_update_proposal';
    let isScheduleDeleteProposal = parsed.type === 'schedule_delete_proposal';
    let isLifePlanProposal = parsed.type === 'life_plan_proposal';
    let isLifePlanUpdateProposal =
      parsed.type === 'life_plan_update_proposal';
    let isLifePlanDeleteProposal =
      parsed.type === 'life_plan_delete_proposal';
    let lifePlan: LifePlan | null = null;
    let lifePlanConflict: LifePlanConflictResult | null = null;
    let scheduleUpdateProposal: ScheduleUpdateProposal | undefined;
    let scheduleDeleteProposal: ScheduleDeleteProposal | undefined;
    let lifePlanProposal: LifePlanProposal | undefined;
    let lifePlanUpdateProposal: LifePlanUpdateProposal | undefined;
    let lifePlanDeleteProposal: LifePlanDeleteProposal | undefined;

    if (parsed.type === 'schedule_update_proposal') {
      await this.findUpdatableSchedule(userId, parsed.scheduleId);
      this.validateScheduleProposalTime(parsed);
      scheduleUpdateProposal = parsed;
    }

    if (parsed.type === 'schedule_delete_proposal') {
      await this.findUpdatableSchedule(userId, parsed.scheduleId);
      scheduleDeleteProposal = parsed;
    }

    if (parsed.type === 'life_plan_proposal') {
      const conflict = await this.lifePlanService.previewFromAi(
        userId,
        parsed,
      );

      if (conflict) {
        lifePlanConflict = conflict;
        parsed = lifePlanConflict;
        isLifePlanProposal = false;
      } else {
        lifePlanProposal = parsed;
      }
    }

    if (parsed.type === 'life_plan_delete_proposal') {
      await this.lifePlanService.findForAi(userId, parsed.lifePlanId);
      lifePlanDeleteProposal = parsed;
    }

    if (parsed.type === 'life_plan_update_proposal') {
      const conflict = await this.lifePlanService.previewUpdateFromAi(
        userId,
        parsed.lifePlanId,
        parsed,
      );

      if (conflict) {
        lifePlanConflict = conflict;
        parsed = lifePlanConflict;
        isLifePlanUpdateProposal = false;
      } else {
        lifePlanUpdateProposal = parsed;
      }
    }

    const assistantMessage = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: JSON.stringify(parsed),
        isScheduleProposal,
      },
    });

    let schedule: Schedule | null = null;

    if (isScheduleProposal) {
      const proposal = parsed as ScheduleProposal;

      // Persist the proposal immediately so it survives even before the user
      // accepts it, and so chat reads can surface a "pending proposal" section.
      schedule = await this.prisma.schedule.create({
        data: {
          userId,
          messageId: assistantMessage.id,
          summary: proposal.summary,
          description: proposal.description,
          location: proposal.location,
          startDateTime: new Date(proposal.startDateTime),
          endDateTime: new Date(proposal.endDateTime),
        },
      });
    }

    await this.prisma.chat.update({
      where: { id: chat.id },
      data: { updatedAt: new Date() },
    });

    return {
      chatId: chat.id,
      userMessage,
      parsed,
      assistantMessage,
      requiresConfirmation:
        isScheduleProposal ||
        isScheduleUpdateProposal ||
        isScheduleDeleteProposal ||
        isLifePlanProposal ||
        isLifePlanUpdateProposal ||
        isLifePlanDeleteProposal,
      proposal: isScheduleProposal ? (parsed as ScheduleProposal) : undefined,
      scheduleUpdateProposal,
      scheduleDeleteProposal,
      lifePlanProposal,
      lifePlanUpdateProposal,
      lifePlanDeleteProposal,
      isNeedMoreData: parsed.type === 'need_info',
      lifePlan,
      lifePlanConflict,
      schedule,
    };
  }

  private validateScheduleProposalTime(
    proposal: ScheduleProposal | ScheduleUpdateProposal,
  ) {
    const start = new Date(proposal.startDateTime);
    const end = new Date(proposal.endDateTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Schedule proposal has invalid date/time');
    }

    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('Schedule must end after it starts');
    }
  }

  private async findUpdatableSchedule(userId: string, scheduleId: string) {
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        id: scheduleId,
        userId,
      },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    if (schedule.lifePlanId) {
      throw new BadRequestException(
        'Use life plan update for schedules generated by a life plan',
      );
    }

    return schedule;
  }

  /**
   * Accepts a previously proposed schedule: persists it as a Schedule row and,
   * only when the user authenticated via the Google provider, best-effort
   * syncs it to their connected Google Calendar. The Schedule is kept even if
   * the Google Calendar sync fails or is skipped.
   */
  async acceptScheduleProposal(
    userId: string,
    messageId: string,
    provider: string,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true, schedule: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.chat) {
      throw new NotFoundException('Message not found');
    }

    if (message.chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (!message.isScheduleProposal) {
      throw new BadRequestException('This message is not a schedule proposal');
    }

    if (!message.schedule) {
      throw new NotFoundException('No pending proposal found for this message');
    }

    if (message.schedule.status === 'ACCEPTED') {
      throw new ConflictException('This schedule has already been accepted');
    }

    const proposal: ScheduleProposal = {
      type: 'schedule_proposal',
      summary: message.schedule.summary,
      description: message.schedule.description,
      location: message.schedule.location,
      startDateTime: message.schedule.startDateTime.toISOString(),
      endDateTime: message.schedule.endDateTime.toISOString(),
    };

    const schedule = await this.prisma.schedule.update({
      where: { id: message.schedule.id },
      data: { status: 'ACCEPTED' },
    });

    const acceptedMessage: ScheduleAcceptedMessage = {
      type: 'schedule_accepted',
      content: 'Jadwal sudah ditambahkan ke kalender.',
      scheduleId: schedule.id,
      proposal,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    // Signing in with Supabase's Google provider doesn't by itself grant
    // Calendar API access — that still requires the separate Google Calendar
    // integration (GoogleCalendarAccount). We only attempt the sync for
    // Google-provider users, and never let a failed/missing sync block the
    // schedule from being saved.
    if (provider !== 'google') {
      return { schedule, syncedToGoogleCalendar: false as const };
    }

    try {
      const event = await this.googleCalendarService.createEvent(userId, {
        summary: proposal.summary,
        description: proposal.description ?? undefined,
        location: proposal.location ?? undefined,
        startDateTime: proposal.startDateTime,
        endDateTime: proposal.endDateTime,
      });

      const updatedSchedule = await this.prisma.schedule.update({
        where: { id: schedule.id },
        data: { googleCalendarEventId: event.id ?? null },
      });

      return {
        schedule: updatedSchedule,
        syncedToGoogleCalendar: true as const,
      };
    } catch (error) {
      return {
        schedule,
        syncedToGoogleCalendar: false as const,
        googleSyncError: String(error),
      };
    }
  }

  /**
   * Dismisses a previously proposed schedule the user chose not to add. The
   * proposal never became a real booking, so its placeholder Schedule row is
   * removed rather than kept around in a "declined" state.
   */
  async dismissScheduleProposal(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true, schedule: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.chat) {
      throw new NotFoundException('Message not found');
    }

    if (message.chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (!message.isScheduleProposal) {
      throw new BadRequestException('This message is not a schedule proposal');
    }

    if (!message.schedule) {
      throw new NotFoundException('No pending proposal found for this message');
    }

    if (message.schedule.status === 'ACCEPTED') {
      throw new ConflictException('This schedule has already been accepted');
    }

    const proposal: ScheduleProposal = {
      type: 'schedule_proposal',
      summary: message.schedule.summary,
      description: message.schedule.description,
      location: message.schedule.location,
      startDateTime: message.schedule.startDateTime.toISOString(),
      endDateTime: message.schedule.endDateTime.toISOString(),
    };

    await this.prisma.schedule.delete({ where: { id: message.schedule.id } });

    const dismissedMessage: ScheduleDismissedMessage = {
      type: 'schedule_dismissed',
      content: 'Oke, jadwal ini nggak ditambahkan.',
      proposal,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(dismissedMessage) },
    });

    return { dismissed: true as const };
  }

  async acceptScheduleUpdateProposal(
    userId: string,
    messageId: string,
    provider: string,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.chat) {
      throw new NotFoundException('Message not found');
    }

    if (message.chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    let parsed: ParsedAssistantResponse;

    try {
      parsed = JSON.parse(message.content) as ParsedAssistantResponse;
    } catch {
      throw new BadRequestException(
        'This message is not a schedule update proposal',
      );
    }

    if (parsed.type === 'schedule_update_accepted') {
      throw new ConflictException(
        'This schedule update has already been accepted',
      );
    }

    if (parsed.type !== 'schedule_update_proposal') {
      throw new BadRequestException(
        'This message is not a schedule update proposal',
      );
    }

    await this.findUpdatableSchedule(userId, parsed.scheduleId);
    this.validateScheduleProposalTime(parsed);

    const schedule = await this.prisma.schedule.update({
      where: { id: parsed.scheduleId },
      data: {
        summary: parsed.summary,
        description: parsed.description,
        location: parsed.location,
        startDateTime: new Date(parsed.startDateTime),
        endDateTime: new Date(parsed.endDateTime),
        status: 'ACCEPTED',
      },
    });

    const acceptedMessage: ScheduleUpdateAcceptedMessage = {
      type: 'schedule_update_accepted',
      content: 'Jadwal sudah di-update.',
      scheduleId: schedule.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    if (provider !== 'google' || !schedule.googleCalendarEventId) {
      return {
        updated: true as const,
        schedule,
        syncedToGoogleCalendar: false as const,
      };
    }

    try {
      await this.googleCalendarService.patchEvent(
        userId,
        schedule.googleCalendarEventId,
        {
          summary: parsed.summary,
          description: parsed.description,
          location: parsed.location,
          start: { dateTime: new Date(parsed.startDateTime).toISOString() },
          end: { dateTime: new Date(parsed.endDateTime).toISOString() },
        },
      );

      return {
        updated: true as const,
        schedule,
        syncedToGoogleCalendar: true as const,
      };
    } catch (error) {
      return {
        updated: true as const,
        schedule,
        syncedToGoogleCalendar: false as const,
        googleSyncError: String(error),
      };
    }
  }

  async acceptScheduleDeleteProposal(
    userId: string,
    messageId: string,
    provider: string,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.chat) {
      throw new NotFoundException('Message not found');
    }

    if (message.chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    let parsed: ParsedAssistantResponse;

    try {
      parsed = JSON.parse(message.content) as ParsedAssistantResponse;
    } catch {
      throw new BadRequestException(
        'This message is not a schedule delete proposal',
      );
    }

    if (parsed.type === 'schedule_delete_accepted') {
      throw new ConflictException(
        'This schedule delete has already been accepted',
      );
    }

    if (parsed.type !== 'schedule_delete_proposal') {
      throw new BadRequestException(
        'This message is not a schedule delete proposal',
      );
    }

    const schedule = await this.findUpdatableSchedule(
      userId,
      parsed.scheduleId,
    );

    await this.prisma.schedule.delete({
      where: { id: schedule.id },
    });

    const acceptedMessage: ScheduleDeleteAcceptedMessage = {
      type: 'schedule_delete_accepted',
      content: 'Jadwal sudah dihapus.',
      scheduleId: schedule.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    if (provider !== 'google' || !schedule.googleCalendarEventId) {
      return {
        deleted: true as const,
        schedule,
        syncedToGoogleCalendar: false as const,
      };
    }

    try {
      await this.googleCalendarService.deleteEvent(
        userId,
        schedule.googleCalendarEventId,
      );

      return {
        deleted: true as const,
        schedule,
        syncedToGoogleCalendar: true as const,
      };
    } catch (error) {
      return {
        deleted: true as const,
        schedule,
        syncedToGoogleCalendar: false as const,
        googleSyncError: String(error),
      };
    }
  }

  async acceptLifePlanProposal(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.chat) {
      throw new NotFoundException('Message not found');
    }

    if (message.chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    let parsed: ParsedAssistantResponse;

    try {
      parsed = JSON.parse(message.content) as ParsedAssistantResponse;
    } catch {
      throw new BadRequestException(
        'This message is not a life plan proposal',
      );
    }

    if (parsed.type === 'life_plan_accepted') {
      throw new ConflictException('This life plan has already been accepted');
    }

    if (parsed.type !== 'life_plan_proposal') {
      throw new BadRequestException(
        'This message is not a life plan proposal',
      );
    }

    const result = await this.lifePlanService.createFromAi(userId, parsed);

    if (!result.created) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { content: JSON.stringify(result.conflict) },
      });

      return {
        created: false as const,
        lifePlan: null,
        lifePlanConflict: result.conflict,
      };
    }

    const acceptedMessage: LifePlanAcceptedMessage = {
      type: 'life_plan_accepted',
      content: 'Life plan sudah dibuat.',
      lifePlanId: result.lifePlan.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    return {
      created: true as const,
      lifePlan: result.lifePlan,
      lifePlanConflict: null,
    };
  }

  async acceptLifePlanUpdateProposal(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.chat) {
      throw new NotFoundException('Message not found');
    }

    if (message.chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    let parsed: ParsedAssistantResponse;

    try {
      parsed = JSON.parse(message.content) as ParsedAssistantResponse;
    } catch {
      throw new BadRequestException(
        'This message is not a life plan update proposal',
      );
    }

    if (parsed.type === 'life_plan_update_accepted') {
      throw new ConflictException(
        'This life plan update has already been accepted',
      );
    }

    if (parsed.type !== 'life_plan_update_proposal') {
      throw new BadRequestException(
        'This message is not a life plan update proposal',
      );
    }

    const result = await this.lifePlanService.updateFromAi(
      userId,
      parsed.lifePlanId,
      parsed,
    );

    if (!result.updated) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { content: JSON.stringify(result.conflict) },
      });

      return {
        updated: false as const,
        lifePlan: null,
        lifePlanConflict: result.conflict,
      };
    }

    const acceptedMessage: LifePlanUpdateAcceptedMessage = {
      type: 'life_plan_update_accepted',
      content: 'Life plan sudah di-update.',
      lifePlanId: result.lifePlan.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    return {
      updated: true as const,
      lifePlan: result.lifePlan,
      lifePlanConflict: null,
    };
  }

  async acceptLifePlanDeleteProposal(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.chat) {
      throw new NotFoundException('Message not found');
    }

    if (message.chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    let parsed: ParsedAssistantResponse;

    try {
      parsed = JSON.parse(message.content) as ParsedAssistantResponse;
    } catch {
      throw new BadRequestException(
        'This message is not a life plan delete proposal',
      );
    }

    if (parsed.type === 'life_plan_delete_accepted') {
      throw new ConflictException(
        'This life plan delete has already been accepted',
      );
    }

    if (parsed.type !== 'life_plan_delete_proposal') {
      throw new BadRequestException(
        'This message is not a life plan delete proposal',
      );
    }

    const lifePlan = await this.lifePlanService.deleteFromAi(
      userId,
      parsed.lifePlanId,
    );

    const acceptedMessage: LifePlanDeleteAcceptedMessage = {
      type: 'life_plan_delete_accepted',
      content: 'Life plan sudah dihapus.',
      lifePlanId: lifePlan.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    return {
      deleted: true as const,
      lifePlan,
    };
  }
}
