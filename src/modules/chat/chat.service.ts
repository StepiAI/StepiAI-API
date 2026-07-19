import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Schedule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { OpenAiService } from '../openai/openai.service';
import { CreateMessageDto } from './dto/create-message.dto';

const WIB_OFFSET_HOURS = 7;

/** Formats a date as ISO 8601 shifted by a fixed UTC offset, e.g. 2026-07-19T15:58:41+07:00. */
function formatWithOffset(date: Date, offsetHours: number): string {
  const shifted = new Date(date.getTime() + offsetHours * 60 * 60 * 1000);
  const sign = offsetHours >= 0 ? '+' : '-';
  const hh = String(Math.abs(offsetHours)).padStart(2, '0');
  return `${shifted.toISOString().slice(0, 19)}${sign}${hh}:00`;
}

function buildScheduleAssistantInstructions(now: Date): string {
  const currentDateTime = formatWithOffset(now, WIB_OFFSET_HOURS);

  return `You are StepiAI's scheduling assistant.
Reply with ONLY a single raw JSON object and nothing else (no markdown, no code fences, no commentary).

The current date and time is ${currentDateTime} (Asia/Jakarta, WIB, UTC+7). Treat this as "now" and resolve any relative date or time the user mentions (today, tomorrow, besok, hari ini, minggu depan, jam 1 siang, etc.) relative to it. Unless the user specifies another timezone, assume Asia/Jakarta (UTC+7) and return startDateTime/endDateTime as ISO 8601 with the "+07:00" offset.

If the user is asking you to create, update, or schedule an event/appointment/reminder, respond with:
{
  "type": "schedule_proposal",
  "summary": string,
  "description": string | null,
  "location": string | null,
  "startDateTime": string in ISO 8601 with UTC offset,
  "endDateTime": string in ISO 8601 with UTC offset
}
You are only proposing the event. Never assume it has been created — the user must explicitly confirm it afterwards.

For any other message, respond with:
{
  "type": "message",
  "content": string
}

Always return valid, parseable JSON matching one of the two shapes above.`;
}

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

    let parsed: ScheduleProposal | AssistantMessage;

    try {
      const raw = await this.openAiService.generateText(conversation, {
        instructions: buildScheduleAssistantInstructions(new Date()),
      });

      parsed = JSON.parse(raw) as ScheduleProposal | AssistantMessage;
    } catch (error) {
      throw new InternalServerErrorException(
        'Unable to get a response from the AI assistant',
        String(error),
      );
    }

    const isScheduleProposal = parsed.type === 'schedule_proposal';

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
      assistantMessage,
      requiresConfirmation: isScheduleProposal,
      proposal: isScheduleProposal ? (parsed as ScheduleProposal) : undefined,
      schedule,
    };
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
}
