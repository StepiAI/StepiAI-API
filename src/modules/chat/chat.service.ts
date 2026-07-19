import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Schedule } from '@prisma/client';
import type { calendar_v3 } from 'googleapis';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { OpenAiService } from '../openai/openai.service';
import { CreateMessageDto } from './dto/create-message.dto';
import {
  analyzeScheduleConflicts,
  CalendarBusyEvent,
  getOffsetDayBounds,
  ScheduleConflictAnalysis,
} from './schedule-conflicts';
import {
  buildConflictExplanationInstructions,
  buildScheduleInstructions,
  normalizeTimeZone,
} from './schedule-instructions';

export interface ScheduleProposal {
  type: 'schedule_proposal';
  summary: string;
  description: string | null;
  location: string | null;
  startDateTime: string;
  endDateTime: string;
}

export interface AssistantMessage {
  type: 'message';
  content: string;
}

export interface MissingInformationMessage {
  type: 'missing_information';
  question: string;
  missingFields: string[];
}

type AssistantOutput =
  ScheduleProposal | AssistantMessage | MissingInformationMessage;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAiService: OpenAiService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  async getOrCreateChat(userId: string) {
    const chat = await this.findOrCreateChatRecord(userId);
    return { ...chat };
  }

  async getChatById(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { schedule: true },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return chat;
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
    });

    const conversation = history
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');

    let parsed: AssistantOutput;

    try {
      const raw = await this.openAiService.generateText(conversation, {
        instructions: buildScheduleInstructions(new Date(), dto.timezone),
      });

      parsed = JSON.parse(raw) as AssistantOutput;
    } catch (error) {
      throw new InternalServerErrorException(
        'Unable to get a response from the AI assistant',
        String(error),
      );
    }

    const proposalConflictAnalysis =
      parsed.type === 'schedule_proposal'
        ? await this.analyzeProposalConflicts(userId, parsed)
        : undefined;
    const hasProposalTimingIssue =
      Boolean(proposalConflictAnalysis?.hasConflict) ||
      Boolean(proposalConflictAnalysis?.hasTightBuffer);
    const userKeepsOriginalTime =
      parsed.type === 'schedule_proposal' &&
      hasProposalTimingIssue &&
      this.isKeepingOriginalTimeRequest(dto.content) &&
      this.hasRecentConflictWarning(history.slice(0, -1));

    const finalResponse =
      parsed.type === 'schedule_proposal' &&
      proposalConflictAnalysis &&
      hasProposalTimingIssue &&
      !userKeepsOriginalTime
        ? await this.explainProposalConflicts(
            parsed,
            proposalConflictAnalysis,
            dto.timezone,
          )
        : parsed;

    const isScheduleProposal = finalResponse.type === 'schedule_proposal';

    const assistantMessage = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: JSON.stringify(finalResponse),
        isScheduleProposal,
      },
    });

    let schedule: Schedule | null = null;

    if (isScheduleProposal) {
      const proposal = finalResponse as ScheduleProposal;

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
      assistantMessage,
      requiresConfirmation: isScheduleProposal,
      proposal: isScheduleProposal
        ? (finalResponse as ScheduleProposal)
        : undefined,
      conflictAnalysis: proposalConflictAnalysis,
      conflictOverrideAccepted: userKeepsOriginalTime,
      schedule,
    };
  }

  private isKeepingOriginalTimeRequest(content: string) {
    const normalized = content.toLowerCase();
    const rejectsSuggestion =
      /\b(enggak|nggak|ngga|gak|ga|tidak|no|jangan)\b/.test(normalized) ||
      normalized.includes('tidak usah') ||
      normalized.includes('gak usah') ||
      normalized.includes('ga usah') ||
      normalized.includes('nggak usah') ||
      normalized.includes('enggak usah');
    const keepsTime =
      normalized.includes('tetap') ||
      normalized.includes('tetep') ||
      normalized.includes('jam yang sama') ||
      normalized.includes('waktu yang sama') ||
      normalized.includes('di jam itu') ||
      normalized.includes('jam segitu') ||
      normalized.includes('di situ') ||
      normalized.includes('lanjut') ||
      normalized.includes('keep');

    return rejectsSuggestion && keepsTime;
  }

  private hasRecentConflictWarning(
    messages: Array<{ role: string; content: string }>,
  ) {
    return messages.slice(-6).some((message) => {
      if (message.role !== 'assistant') {
        return false;
      }

      const content = message.content.toLowerCase();
      return (
        content.includes('bentrok') ||
        content.includes('terlalu mepet') ||
        content.includes('tidak ada jeda') ||
        content.includes('tanpa jeda') ||
        content.includes('waktu istirahat') ||
        content.includes('alternatif') ||
        content.includes('jadwalkan ulang')
      );
    });
  }

  private async analyzeProposalConflicts(
    userId: string,
    proposal: ScheduleProposal,
  ): Promise<ScheduleConflictAnalysis> {
    const start = new Date(proposal.startDateTime);
    const end = new Date(proposal.endDateTime);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end.getTime() <= start.getTime()
    ) {
      return {
        hasConflict: false,
        hasTightBuffer: false,
        conflicts: [],
      };
    }

    const { timeMin, timeMax, offset } = getOffsetDayBounds(
      proposal.startDateTime,
    );
    const events = await this.collectBusyEvents(userId, timeMin, timeMax);

    return analyzeScheduleConflicts(start, end, events, {
      outputOffset: offset,
    });
  }

  private async collectBusyEvents(
    userId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<CalendarBusyEvent[]> {
    const [localSchedules, googleEvents] = await Promise.all([
      this.prisma.schedule.findMany({
        where: {
          userId,
          status: 'ACCEPTED',
          startDateTime: { lt: new Date(timeMax) },
          endDateTime: { gt: new Date(timeMin) },
        },
      }),
      this.listGoogleEventsSafely(userId, timeMin, timeMax),
    ]);

    const localBusyEvents = localSchedules.map((schedule) => ({
      id: schedule.googleCalendarEventId ?? schedule.id,
      title: schedule.summary,
      start: schedule.startDateTime,
      end: schedule.endDateTime,
      source: 'local' as const,
    }));

    const googleBusyEvents = googleEvents
      .map((event) => this.toBusyEvent(event))
      .filter((event): event is CalendarBusyEvent => Boolean(event));

    return this.dedupeBusyEvents([...googleBusyEvents, ...localBusyEvents]);
  }

  private async listGoogleEventsSafely(
    userId: string,
    timeMin: string,
    timeMax: string,
  ) {
    try {
      const status = await this.googleCalendarService.getStatus(userId);

      if (!status.connected) {
        return [];
      }

      return await this.googleCalendarService.listEvents(
        userId,
        timeMin,
        timeMax,
      );
    } catch {
      return [];
    }
  }

  private toBusyEvent(
    event: calendar_v3.Schema$Event,
  ): CalendarBusyEvent | undefined {
    if (event.status === 'cancelled') {
      return undefined;
    }

    const startRaw = event.start?.dateTime ?? event.start?.date;
    const endRaw = event.end?.dateTime ?? event.end?.date;

    if (!startRaw || !endRaw) {
      return undefined;
    }

    const start = new Date(startRaw);
    const end = new Date(endRaw);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end.getTime() <= start.getTime()
    ) {
      return undefined;
    }

    return {
      id: event.id ?? undefined,
      title: event.summary ?? 'Busy',
      start,
      end,
      source: 'google',
    };
  }

  private dedupeBusyEvents(events: CalendarBusyEvent[]) {
    const seen = new Set<string>();
    const unique: CalendarBusyEvent[] = [];

    for (const event of events) {
      const key = [
        event.id ?? '',
        event.title.trim().toLowerCase(),
        event.start.toISOString(),
        event.end.toISOString(),
      ].join('|');

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(event);
    }

    return unique;
  }

  private async explainProposalConflicts(
    proposal: ScheduleProposal,
    analysis: ScheduleConflictAnalysis,
    rawTimeZone?: string | null,
  ): Promise<AssistantMessage> {
    const timeZone = normalizeTimeZone(rawTimeZone);
    const input = this.buildConflictExplanationInput(
      proposal,
      analysis,
      timeZone,
    );

    try {
      const raw = await this.openAiService.generateText(input, {
        instructions: buildConflictExplanationInstructions(),
      });
      const parsed = JSON.parse(raw) as AssistantOutput;

      if (parsed.type === 'message') {
        return parsed;
      }
    } catch {
      // Fall through to deterministic fallback below.
    }

    return {
      type: 'message',
      content: this.buildFallbackConflictMessage(proposal, analysis, timeZone),
    };
  }

  private buildConflictExplanationInput(
    proposal: ScheduleProposal,
    analysis: ScheduleConflictAnalysis,
    timeZone: string,
  ) {
    const existingSchedules = analysis.conflicts.length
      ? analysis.conflicts
      : [analysis.nearestBefore, analysis.nearestAfter].filter(Boolean);
    const existingSchedulesText =
      existingSchedules.length > 0
        ? existingSchedules
            .map((event, index) => {
              if (!event) return '';

              return `${index + 1}.
${event.title}
${this.formatDateTime(event.startDateTime, timeZone)} - ${this.formatDateTime(
                event.endDateTime,
                timeZone,
              )}`;
            })
            .join('\n\n')
        : 'None';

    return `Existing schedules:

${existingSchedulesText}

Proposed event:
${proposal.summary}
${this.formatDateTime(proposal.startDateTime, timeZone)} - ${this.formatDateTime(
      proposal.endDateTime,
      timeZone,
    )}

Conflict analysis:
${JSON.stringify(analysis, null, 2)}

Jika recommendedStartDateTime dan recommendedEndDateTime tersedia, itu adalah slot pertama yang backend temukan tanpa bentrok dan dengan buffer dari jadwal sekitar.
Determine if there are conflicts or timing issues.`;
  }

  private buildFallbackConflictMessage(
    proposal: ScheduleProposal,
    analysis: ScheduleConflictAnalysis,
    timeZone: string,
  ) {
    const recommended =
      analysis.recommendedStartDateTime && analysis.recommendedEndDateTime
        ? ` Mau aku pindahkan ke ${this.formatDateTime(
            analysis.recommendedStartDateTime,
            timeZone,
          )} saja?`
        : '';

    if (analysis.hasConflict) {
      const conflict = analysis.conflicts[0];
      return `${proposal.summary} bentrok dengan ${conflict.title} sekitar ${conflict.overlapMinutes} menit.${recommended}`;
    }

    const neighbor = analysis.nearestBefore ?? analysis.nearestAfter;

    if (neighbor) {
      return `${proposal.summary} terlalu mepet dengan ${neighbor.title}, jaraknya cuma ${neighbor.gapMinutes} menit.${recommended}`;
    }

    return `Ada masalah waktu untuk ${proposal.summary}.${recommended}`;
  }

  private formatDateTime(value: string, timeZone: string) {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
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
      return {
        schedule,
        syncedToGoogleCalendar: false as const,
        closeAgent: true as const,
      };
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
        closeAgent: true as const,
      };
    } catch (error) {
      return {
        schedule,
        syncedToGoogleCalendar: false as const,
        googleSyncError: String(error),
        closeAgent: true as const,
      };
    }
  }
}
