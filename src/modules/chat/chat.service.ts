import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Schedule, StudyPlan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { OpenAiService } from '../openai/openai.service';
import {
  CreateStudyPlanFromAiDto,
  StudyPlanConflictResult,
  StudyPlanService,
} from '../studyPlan/studyplan.service';
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

export type StudyPlanProposal = CreateStudyPlanFromAiDto & {
  type: 'study_plan_proposal';
};

export type StudyPlanUpdateProposal = CreateStudyPlanFromAiDto & {
  type: 'study_plan_update_proposal';
  studyPlanId: string;
};

export interface StudyPlanAcceptedMessage {
  type: 'study_plan_accepted';
  content: string;
  studyPlanId: string;
  proposal: StudyPlanProposal;
}

export interface StudyPlanUpdateAcceptedMessage {
  type: 'study_plan_update_accepted';
  content: string;
  studyPlanId: string;
  proposal: StudyPlanUpdateProposal;
}

export interface StudyPlanDeleteProposal {
  type: 'study_plan_delete_proposal';
  studyPlanId: string;
  title: string;
}

export interface StudyPlanDeleteAcceptedMessage {
  type: 'study_plan_delete_accepted';
  content: string;
  studyPlanId: string;
  proposal: StudyPlanDeleteProposal;
}

type ParsedAssistantResponse =
  | ScheduleProposal
  | ScheduleUpdateProposal
  | ScheduleUpdateAcceptedMessage
  | ScheduleDeleteProposal
  | ScheduleDeleteAcceptedMessage
  | AssistantMessage
  | NeedsInfoMessage
  | StudyPlanProposal
  | StudyPlanUpdateProposal
  | StudyPlanConflictResult
  | StudyPlanAcceptedMessage
  | StudyPlanUpdateAcceptedMessage
  | StudyPlanDeleteProposal
  | StudyPlanDeleteAcceptedMessage;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAiService: OpenAiService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly studyPlanService: StudyPlanService,
  ) {}

  async getOrCreateChat(userId: string) {
    const chat = await this.findOrCreateChatRecord(userId);
    return { ...chat };
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
    let isStudyPlanProposal = parsed.type === 'study_plan_proposal';
    let isStudyPlanUpdateProposal =
      parsed.type === 'study_plan_update_proposal';
    let isStudyPlanDeleteProposal =
      parsed.type === 'study_plan_delete_proposal';
    let studyPlan: StudyPlan | null = null;
    let studyPlanConflict: StudyPlanConflictResult | null = null;
    let scheduleUpdateProposal: ScheduleUpdateProposal | undefined;
    let scheduleDeleteProposal: ScheduleDeleteProposal | undefined;
    let studyPlanProposal: StudyPlanProposal | undefined;
    let studyPlanUpdateProposal: StudyPlanUpdateProposal | undefined;
    let studyPlanDeleteProposal: StudyPlanDeleteProposal | undefined;

    if (parsed.type === 'schedule_update_proposal') {
      await this.findUpdatableSchedule(userId, parsed.scheduleId);
      this.validateScheduleProposalTime(parsed);
      scheduleUpdateProposal = parsed;
    }

    if (parsed.type === 'schedule_delete_proposal') {
      await this.findUpdatableSchedule(userId, parsed.scheduleId);
      scheduleDeleteProposal = parsed;
    }

    if (parsed.type === 'study_plan_proposal') {
      const conflict = await this.studyPlanService.previewFromAi(
        userId,
        parsed,
      );

      if (conflict) {
        studyPlanConflict = conflict;
        parsed = studyPlanConflict;
        isStudyPlanProposal = false;
      } else {
        studyPlanProposal = parsed;
      }
    }

    if (parsed.type === 'study_plan_delete_proposal') {
      await this.studyPlanService.findForAi(userId, parsed.studyPlanId);
      studyPlanDeleteProposal = parsed;
    }

    if (parsed.type === 'study_plan_update_proposal') {
      const conflict = await this.studyPlanService.previewUpdateFromAi(
        userId,
        parsed.studyPlanId,
        parsed,
      );

      if (conflict) {
        studyPlanConflict = conflict;
        parsed = studyPlanConflict;
        isStudyPlanUpdateProposal = false;
      } else {
        studyPlanUpdateProposal = parsed;
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
        isStudyPlanProposal ||
        isStudyPlanUpdateProposal ||
        isStudyPlanDeleteProposal,
      proposal: isScheduleProposal ? (parsed as ScheduleProposal) : undefined,
      scheduleUpdateProposal,
      scheduleDeleteProposal,
      studyPlanProposal,
      studyPlanUpdateProposal,
      studyPlanDeleteProposal,
      isNeedMoreData: parsed.type === 'need_info',
      studyPlan,
      studyPlanConflict,
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

    if (schedule.studyPlanId) {
      throw new BadRequestException(
        'Use study plan update for schedules generated by a study plan',
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

  async acceptStudyPlanProposal(userId: string, messageId: string) {
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
        'This message is not a study plan proposal',
      );
    }

    if (parsed.type === 'study_plan_accepted') {
      throw new ConflictException('This study plan has already been accepted');
    }

    if (parsed.type !== 'study_plan_proposal') {
      throw new BadRequestException(
        'This message is not a study plan proposal',
      );
    }

    const result = await this.studyPlanService.createFromAi(userId, parsed);

    if (!result.created) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { content: JSON.stringify(result.conflict) },
      });

      return {
        created: false as const,
        studyPlan: null,
        studyPlanConflict: result.conflict,
      };
    }

    const acceptedMessage: StudyPlanAcceptedMessage = {
      type: 'study_plan_accepted',
      content: 'Study plan sudah dibuat.',
      studyPlanId: result.studyPlan.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    return {
      created: true as const,
      studyPlan: result.studyPlan,
      studyPlanConflict: null,
    };
  }

  async acceptStudyPlanUpdateProposal(userId: string, messageId: string) {
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
        'This message is not a study plan update proposal',
      );
    }

    if (parsed.type === 'study_plan_update_accepted') {
      throw new ConflictException(
        'This study plan update has already been accepted',
      );
    }

    if (parsed.type !== 'study_plan_update_proposal') {
      throw new BadRequestException(
        'This message is not a study plan update proposal',
      );
    }

    const result = await this.studyPlanService.updateFromAi(
      userId,
      parsed.studyPlanId,
      parsed,
    );

    if (!result.updated) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { content: JSON.stringify(result.conflict) },
      });

      return {
        updated: false as const,
        studyPlan: null,
        studyPlanConflict: result.conflict,
      };
    }

    const acceptedMessage: StudyPlanUpdateAcceptedMessage = {
      type: 'study_plan_update_accepted',
      content: 'Study plan sudah di-update.',
      studyPlanId: result.studyPlan.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    return {
      updated: true as const,
      studyPlan: result.studyPlan,
      studyPlanConflict: null,
    };
  }

  async acceptStudyPlanDeleteProposal(userId: string, messageId: string) {
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
        'This message is not a study plan delete proposal',
      );
    }

    if (parsed.type === 'study_plan_delete_accepted') {
      throw new ConflictException(
        'This study plan delete has already been accepted',
      );
    }

    if (parsed.type !== 'study_plan_delete_proposal') {
      throw new BadRequestException(
        'This message is not a study plan delete proposal',
      );
    }

    const studyPlan = await this.studyPlanService.deleteFromAi(
      userId,
      parsed.studyPlanId,
    );

    const acceptedMessage: StudyPlanDeleteAcceptedMessage = {
      type: 'study_plan_delete_accepted',
      content: 'Study plan sudah dihapus.',
      studyPlanId: studyPlan.id,
      proposal: parsed,
    };

    await this.prisma.message.update({
      where: { id: message.id },
      data: { content: JSON.stringify(acceptedMessage) },
    });

    return {
      deleted: true as const,
      studyPlan,
    };
  }
}
