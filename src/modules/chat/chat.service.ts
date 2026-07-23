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
  LifePlanConflictResolutionOption,
  LifePlanService,
  buildLifePlanScheduleData,
} from '../lifePlan/lifeplan.service';
import { CreateMessageDto } from './dto/create-message.dto';
import {
  buildScheduleInstructions,
  buildVoiceScheduleInstructions,
  normalizeTimeZone,
} from './schedule-instructions';
import {
  assessScheduleCapacity,
  explicitlyAllowsStressfulLoad,
  isProceedAnywayReply,
  parseConflictDecision,
  type CapacityAssessment,
  type ConflictDecision,
  type TimeRange,
} from './schedule-safety';
import { buildVoiceAgentResponse } from './voice-response';
import { Console } from 'console';

export { isAffirmativeReply } from './schedule-safety';

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

export interface ProposalRejectedMessage {
  type: 'proposal_rejected';
  content: string;
  proposal:
    | ScheduleUpdateProposal
    | ScheduleDeleteProposal
    | LifePlanProposal
    | LifePlanUpdateProposal
    | LifePlanDeleteProposal;
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

export type ParsedAssistantResponse =
  | ScheduleProposal
  | ScheduleAcceptedMessage
  | ScheduleDismissedMessage
  | ProposalRejectedMessage
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

export type StudyPlanConflictResolutionChoice =
  'skip_day_and_extend' | 'change_time_for_day';

export interface StudyPlanConflictResolution {
  type: 'study_plan_conflict_resolution';
  choice: StudyPlanConflictResolutionChoice;
}

export function parseStudyPlanConflictResolution(
  content: string,
): StudyPlanConflictResolution | null {
  const decision = parseConflictDecision(content);

  if (
    decision === 'change_time_for_day' ||
    decision === 'skip_day_and_extend'
  ) {
    return {
      type: 'study_plan_conflict_resolution',
      choice: decision,
    };
  }

  if (decision === 'ai_decides') {
    return {
      type: 'study_plan_conflict_resolution',
      choice: 'skip_day_and_extend',
    };
  }

  return null;
}

export function isProposalResponse(parsed: { type: string }): boolean {
  return [
    'schedule_proposal',
    'schedule_update_proposal',
    'schedule_delete_proposal',
    'life_plan_proposal',
    'life_plan_update_proposal',
    'life_plan_delete_proposal',
    // Accepted here only for backward compatibility with older stored chats.
    'study_plan_proposal',
    'study_plan_update_proposal',
    'study_plan_delete_proposal',
  ].includes(parsed.type);
}

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
      this.prisma.message.updateMany({
        where: { chatId: chat.id },
        data: { isDeleted: true },
      }),
    ]);

    return { ...chat, messages: [] };
  }

  private async findOrCreateChatRecord(userId: string) {
    const existing = await this.prisma.chat.findUnique({
      where: { userId: userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          where: {
            isDeleted: false,
          },
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
    return this.sendMessageWithMode(userId, dto, 'chat');
  }

  async sendVoiceMessage(userId: string, dto: CreateMessageDto) {
    const response = await this.sendMessageWithMode(userId, dto, 'voice');

    return buildVoiceAgentResponse(response, dto.timezone);
  }

  private async sendMessageWithMode(
    userId: string,
    dto: CreateMessageDto,
    mode: 'chat' | 'voice',
  ) {
    const chat = await this.findOrCreateChatRecord(userId);
    const now = new Date();

    const userMessage = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'user',
        content: dto.content,
      },
    });

    const [history, currentSchedules, lifePlans] = await Promise.all([
      this.prisma.message.findMany({
        where: { chatId: chat.id, isDeleted: false },
        orderBy: { createdAt: 'asc' },
        include: { schedule: true },
      }),
      this.prisma.schedule.findMany({
        where: {
          userId,
          isDeleted: false,
          status: 'ACCEPTED',
          endDateTime: {
            gt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          },
          startDateTime: {
            lt: new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { startDateTime: 'asc' },
        take: 300,
      }),
      this.lifePlanService.findAllByUser(userId),
    ]);

    const lifePlanContext = lifePlans
      .map((lifePlan) => this.formatLifePlanContext(lifePlan))
      .join('\n');
    const calendarContext = currentSchedules
      .map((schedule) => this.formatCalendarContext(schedule))
      .join('\n');
    const messageContext = history
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
    const conversation = [lifePlanContext, calendarContext, messageContext]
      .filter(Boolean)
      .join('\n');

    let parsed: ParsedAssistantResponse;

    try {
      const raw = await this.openAiService.generateText(conversation, {
        instructions:
          mode === 'voice'
            ? buildVoiceScheduleInstructions(now, dto.timezone)
            : buildScheduleInstructions(now, dto.timezone),
      });

      parsed = this.normalizeAssistantResponse(JSON.parse(raw));
    } catch (error) {
      throw new InternalServerErrorException(
        'Unable to get a response from the AI assistant',
        String(error),
      );
    }

    let isScheduleProposal = parsed.type === 'schedule_proposal';
    let isScheduleUpdateProposal = parsed.type === 'schedule_update_proposal';
    const isScheduleDeleteProposal = parsed.type === 'schedule_delete_proposal';
    let isLifePlanProposal = parsed.type === 'life_plan_proposal';
    let isLifePlanUpdateProposal = parsed.type === 'life_plan_update_proposal';
    const isLifePlanDeleteProposal =
      parsed.type === 'life_plan_delete_proposal';
    const lifePlan: LifePlan | null = null;
    let lifePlanConflict: LifePlanConflictResult | null = null;
    let scheduleUpdateProposal: ScheduleUpdateProposal | undefined;
    let scheduleDeleteProposal: ScheduleDeleteProposal | undefined;
    let lifePlanProposal: LifePlanProposal | undefined;
    let lifePlanUpdateProposal: LifePlanUpdateProposal | undefined;
    let lifePlanDeleteProposal: LifePlanDeleteProposal | undefined;
    const latestNeedInfo = this.findLatestNeedsInfoContent(history);
    const priorSafetyOverrides = this.findConfirmedSafetyOverrides(history);
    const proceedsAfterWarning = isProceedAnywayReply(dto.content);
    const conflictDecision =
      parseConflictDecision(dto.content) ??
      (proceedsAfterWarning && latestNeedInfo?.toLowerCase().includes('bentrok')
        ? 'allow_collision'
        : priorSafetyOverrides.allowCollision
          ? 'allow_collision'
          : null);
    const allowsStressfulLoad =
      explicitlyAllowsStressfulLoad(dto.content) ||
      priorSafetyOverrides.allowStressfulLoad ||
      (proceedsAfterWarning &&
        Boolean(
          latestNeedInfo
            ?.toLowerCase()
            .match(/berpotensi cukup berat|beban ini|terlalu padat/),
        ));
    const timeZone = normalizeTimeZone(dto.timezone);

    if (
      parsed.type === 'schedule_proposal' ||
      parsed.type === 'schedule_update_proposal'
    ) {
      this.validateScheduleProposalTime(parsed);
      const ignoredScheduleId =
        parsed.type === 'schedule_update_proposal'
          ? parsed.scheduleId
          : undefined;

      if (ignoredScheduleId) {
        await this.findUpdatableSchedule(userId, ignoredScheduleId);
      }

      let proposal: ScheduleProposal | ScheduleUpdateProposal = parsed;
      let collisions = this.findScheduleCollisions(
        currentSchedules,
        proposal,
        ignoredScheduleId,
      );

      const hasSpecificTimeInReply =
        /\b(?:[01]?\d|2[0-3])(?::|\.)[0-5]\d\b|\b(?:[1-9]|1[0-2])\s*(?:am|pm)\b/i.test(
          dto.content,
        );
      const shouldChooseFreeTime =
        conflictDecision === 'ai_decides' ||
        (conflictDecision === 'change_time_for_day' && !hasSpecificTimeInReply);

      if (collisions.length > 0 && shouldChooseFreeTime) {
        const saferProposal = this.findSaferScheduleProposal(
          proposal,
          currentSchedules,
          timeZone,
          ignoredScheduleId,
        );

        if (saferProposal) {
          proposal = saferProposal;
          collisions = this.findScheduleCollisions(
            currentSchedules,
            proposal,
            ignoredScheduleId,
          );
        }
      }

      if (collisions.length > 0 && conflictDecision !== 'allow_collision') {
        parsed = this.buildScheduleCollisionNeedInfo(proposal, collisions);
        isScheduleProposal = false;
        isScheduleUpdateProposal = false;
      } else {
        const existingForCapacity = currentSchedules.filter(
          (schedule) => schedule.id !== ignoredScheduleId,
        );
        let capacity = assessScheduleCapacity(
          existingForCapacity,
          [this.toTimeRange(proposal)],
          timeZone,
        );

        if (
          capacity.isPotentiallyStressful &&
          conflictDecision === 'ai_decides'
        ) {
          const saferProposal = this.findSaferScheduleProposal(
            proposal,
            currentSchedules,
            timeZone,
            ignoredScheduleId,
            true,
          );

          if (saferProposal) {
            proposal = saferProposal;
            capacity = assessScheduleCapacity(
              existingForCapacity,
              [this.toTimeRange(proposal)],
              timeZone,
            );
          }
        }

        if (
          capacity.isPotentiallyStressful &&
          !allowsStressfulLoad &&
          conflictDecision !== 'ai_decides'
        ) {
          parsed = this.buildCapacityNeedInfo(capacity);
          isScheduleProposal = false;
          isScheduleUpdateProposal = false;
        } else {
          parsed = proposal;

          if (proposal.type === 'schedule_update_proposal') {
            scheduleUpdateProposal = proposal;
          }
        }
      }
    }

    if (parsed.type === 'schedule_delete_proposal') {
      await this.findUpdatableSchedule(userId, parsed.scheduleId);
      scheduleDeleteProposal = parsed;
    }

    if (parsed.type === 'life_plan_proposal') {
      const evaluated = await this.evaluateLifePlanProposal(
        userId,
        parsed,
        currentSchedules,
        timeZone,
        conflictDecision,
        allowsStressfulLoad,
      );
      parsed = evaluated.parsed;
      lifePlanConflict = evaluated.conflict;
      isLifePlanProposal = evaluated.canConfirm;
      lifePlanProposal = evaluated.canConfirm
        ? (evaluated.parsed as LifePlanProposal)
        : undefined;
    }

    if (parsed.type === 'life_plan_delete_proposal') {
      await this.lifePlanService.findForAi(userId, parsed.lifePlanId);
      lifePlanDeleteProposal = parsed;
    }

    if (parsed.type === 'life_plan_update_proposal') {
      const evaluated = await this.evaluateLifePlanProposal(
        userId,
        parsed,
        currentSchedules,
        timeZone,
        conflictDecision,
        allowsStressfulLoad,
      );
      parsed = evaluated.parsed;
      lifePlanConflict = evaluated.conflict;
      isLifePlanUpdateProposal = evaluated.canConfirm;
      lifePlanUpdateProposal = evaluated.canConfirm
        ? (evaluated.parsed as LifePlanUpdateProposal)
        : undefined;
    }

    const assistantMessage = await this.prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        content: JSON.stringify(parsed),
        isScheduleProposal:
          isScheduleProposal ||
          isScheduleUpdateProposal ||
          isScheduleDeleteProposal ||
          isLifePlanProposal ||
          isLifePlanUpdateProposal ||
          isLifePlanDeleteProposal,
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

  private normalizeAssistantResponse(value: unknown): ParsedAssistantResponse {
    if (!value || typeof value !== 'object') {
      throw new Error('AI response must be a JSON object');
    }

    const response = { ...(value as Record<string, unknown>) };
    const typeAliases: Record<string, string> = {
      needs_info: 'need_info',
      study_plan_proposal: 'life_plan_proposal',
      study_plan_update_proposal: 'life_plan_update_proposal',
      study_plan_delete_proposal: 'life_plan_delete_proposal',
    };

    if (typeof response.type === 'string' && typeAliases[response.type]) {
      response.type = typeAliases[response.type];
    }

    if (
      response.studyPlanId &&
      !response.lifePlanId &&
      typeof response.studyPlanId === 'string'
    ) {
      response.lifePlanId = response.studyPlanId;
      delete response.studyPlanId;
    }

    const allowedTypes = new Set([
      'schedule_proposal',
      'schedule_update_proposal',
      'schedule_delete_proposal',
      'message',
      'need_info',
      'life_plan_proposal',
      'life_plan_update_proposal',
      'life_plan_delete_proposal',
    ]);

    if (typeof response.type !== 'string' || !allowedTypes.has(response.type)) {
      throw new Error(`Unsupported AI response type: ${String(response.type)}`);
    }

    return response as unknown as ParsedAssistantResponse;
  }

  private findLatestNeedsInfoContent(
    history: Array<{ role: string; content: string }>,
  ): string | null {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];

      if (message.role !== 'assistant') continue;

      try {
        const parsed = JSON.parse(message.content) as Partial<NeedsInfoMessage>;

        return parsed.type === 'need_info' && typeof parsed.content === 'string'
          ? parsed.content
          : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  private findConfirmedSafetyOverrides(
    history: Array<{ role: string; content: string }>,
  ) {
    let allowCollision = false;
    let allowStressfulLoad = false;
    let pendingWarning: 'collision' | 'capacity' | null = null;

    for (const message of history) {
      if (message.role === 'assistant') {
        try {
          const parsed = JSON.parse(
            message.content,
          ) as Partial<NeedsInfoMessage>;

          if (
            parsed.type !== 'need_info' ||
            typeof parsed.content !== 'string'
          ) {
            allowCollision = false;
            allowStressfulLoad = false;
            pendingWarning = null;
            continue;
          }

          const content = parsed.content.toLowerCase();
          pendingWarning = content.includes('bentrok')
            ? 'collision'
            : /berpotensi cukup berat|beban ini|terlalu padat/.test(content)
              ? 'capacity'
              : null;
        } catch {
          allowCollision = false;
          allowStressfulLoad = false;
          pendingWarning = null;
        }

        continue;
      }

      if (message.role !== 'user' || !pendingWarning) continue;

      if (
        pendingWarning === 'collision' &&
        (parseConflictDecision(message.content) === 'allow_collision' ||
          isProceedAnywayReply(message.content))
      ) {
        allowCollision = true;
      }

      if (
        pendingWarning === 'capacity' &&
        (explicitlyAllowsStressfulLoad(message.content) ||
          isProceedAnywayReply(message.content))
      ) {
        allowStressfulLoad = true;
      }

      pendingWarning = null;
    }

    return { allowCollision, allowStressfulLoad };
  }

  private formatLifePlanContext(lifePlan: LifePlan) {
    return `life_plan_context: ${JSON.stringify({
      lifePlanId: lifePlan.id,
      title: lifePlan.title,
      goal: lifePlan.goal,
      topic: lifePlan.topics,
      startDate: lifePlan.startDate.toISOString().slice(0, 10),
      endDate: lifePlan.endDate.toISOString().slice(0, 10),
      availableDays: lifePlan.availableDays,
      startTime: lifePlan.startTime,
      endTime: lifePlan.endTime,
      difficultyLevel: lifePlan.difficultyLevel,
      focusPreferences: lifePlan.focusPreferences,
    })}`;
  }

  private formatCalendarContext(schedule: Schedule) {
    return `calendar_context: ${JSON.stringify({
      scheduleId: schedule.id,
      status: schedule.status,
      summary: schedule.summary,
      description: schedule.description,
      location: schedule.location,
      startDateTime: schedule.startDateTime.toISOString(),
      endDateTime: schedule.endDateTime.toISOString(),
      lifePlanId: schedule.lifePlanId,
    })}`;
  }

  private toTimeRange(
    proposal: ScheduleProposal | ScheduleUpdateProposal,
  ): TimeRange {
    return {
      startDateTime: new Date(proposal.startDateTime),
      endDateTime: new Date(proposal.endDateTime),
    };
  }

  private findScheduleCollisions(
    schedules: Schedule[],
    proposal: ScheduleProposal | ScheduleUpdateProposal,
    ignoredScheduleId?: string,
  ) {
    const proposed = this.toTimeRange(proposal);

    return schedules.filter(
      (schedule) =>
        schedule.id !== ignoredScheduleId &&
        proposed.startDateTime.getTime() < schedule.endDateTime.getTime() &&
        proposed.endDateTime.getTime() > schedule.startDateTime.getTime(),
    );
  }

  private buildScheduleCollisionNeedInfo(
    proposal: ScheduleProposal | ScheduleUpdateProposal,
    collisions: Schedule[],
  ): NeedsInfoMessage {
    const names = collisions
      .slice(0, 3)
      .map((schedule) => `“${schedule.summary}”`)
      .join(', ');

    return {
      type: 'need_info',
      content: `Jadwal ${proposal.summary} bentrok dengan ${names}. Mau ganti jam, batal/skip jadwal ini, tetap dibuat meski bentrok, atau biar aku pilihkan waktu yang aman?`,
    };
  }

  private buildLifePlanCollisionNeedInfo(
    conflict: LifePlanConflictResult,
  ): NeedsInfoMessage {
    const dates = conflict.conflicts
      .slice(0, 4)
      .map((item) => item.date)
      .join(', ');
    const suffix = conflict.conflicts.length > 4 ? ', dan lainnya' : '';

    return {
      type: 'need_info',
      content: `Ada sesi study plan yang bentrok pada ${dates}${suffix}. Mau ubah jam di tanggal itu, skip tanggal yang bentrok, tetap lanjut meski bentrok, atau bilang “bebas” supaya aku pilihkan yang paling aman?`,
    };
  }

  private buildCapacityNeedInfo(
    capacity: CapacityAssessment,
  ): NeedsInfoMessage {
    const hours = Math.round((capacity.busiestMinutes / 60) * 10) / 10;
    const datePart = capacity.busiestDate
      ? ` pada ${capacity.busiestDate}`
      : '';

    return {
      type: 'need_info',
      content: `Jadwal ini berpotensi cukup berat${datePart} (sekitar ${hours} jam terjadwal). Mau diringankan, biar aku pilihkan waktu yang lebih aman, atau tetap lanjut karena kamu oke dengan beban ini?`,
    };
  }

  private findSaferScheduleProposal<
    T extends ScheduleProposal | ScheduleUpdateProposal,
  >(
    proposal: T,
    schedules: Schedule[],
    timeZone: string,
    ignoredScheduleId?: string,
    forceDifferentDay = false,
  ): T | null {
    const start = new Date(proposal.startDateTime);
    const duration = new Date(proposal.endDateTime).getTime() - start.getTime();
    const existing = schedules.filter(
      (schedule) => schedule.id !== ignoredScheduleId,
    );

    for (let step = 1; step <= 7 * 48; step += 1) {
      const candidateStart = new Date(start.getTime() + step * 30 * 60_000);
      const candidateEnd = new Date(candidateStart.getTime() + duration);
      const localHour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone,
          hour: '2-digit',
          hour12: false,
        }).format(candidateStart),
      );
      const localEndHour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone,
          hour: '2-digit',
          hour12: false,
        }).format(candidateEnd),
      );

      if (localHour < 7 || localEndHour > 22 || localEndHour < 7) continue;

      const candidate = {
        ...proposal,
        startDateTime: this.formatDateTimeInZone(candidateStart, timeZone),
        endDateTime: this.formatDateTimeInZone(candidateEnd, timeZone),
      };
      const hasCollision = this.findScheduleCollisions(
        existing,
        candidate,
      ).length;

      if (hasCollision) continue;

      if (forceDifferentDay) {
        const capacity = assessScheduleCapacity(
          existing,
          [this.toTimeRange(candidate)],
          timeZone,
        );

        if (capacity.isPotentiallyStressful) continue;
      }

      return candidate;
    }

    return null;
  }

  private formatDateTimeInZone(value: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'longOffset',
    }).formatToParts(value);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const offset = get('timeZoneName').replace('GMT', '') || '+00:00';

    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get(
      'minute',
    )}:${get('second')}${offset}`;
  }

  private async evaluateLifePlanProposal(
    userId: string,
    proposal: LifePlanProposal | LifePlanUpdateProposal,
    currentSchedules: Schedule[],
    timeZone: string,
    decision: ConflictDecision | null,
    allowsStressfulLoad: boolean,
  ): Promise<{
    parsed: LifePlanProposal | LifePlanUpdateProposal | NeedsInfoMessage;
    conflict: LifePlanConflictResult | null;
    canConfirm: boolean;
  }> {
    const preview = (candidate: LifePlanProposal | LifePlanUpdateProposal) =>
      candidate.type === 'life_plan_update_proposal'
        ? this.lifePlanService.previewUpdateFromAi(
            userId,
            candidate.lifePlanId,
            candidate,
          )
        : this.lifePlanService.previewFromAi(userId, candidate);
    let candidate = proposal;
    let conflict = await preview(candidate);

    if (conflict && decision !== 'allow_collision') {
      const resolution =
        decision === 'ai_decides' ? 'skip_day_and_extend' : decision;

      if (
        resolution === 'skip_day_and_extend' ||
        resolution === 'change_time_for_day'
      ) {
        const resolved = this.applyLifePlanConflictOption(
          candidate,
          conflict,
          resolution,
        );

        if (resolved) {
          candidate = resolved;
          conflict = await preview(candidate);
        }
      }
    }

    if (conflict && decision !== 'allow_collision') {
      return {
        parsed: this.buildLifePlanCollisionNeedInfo(conflict),
        conflict,
        canConfirm: false,
      };
    }

    const ignoredLifePlanId =
      candidate.type === 'life_plan_update_proposal'
        ? candidate.lifePlanId
        : undefined;
    const existingForCapacity = currentSchedules.filter(
      (schedule) => schedule.lifePlanId !== ignoredLifePlanId,
    );
    let capacity = assessScheduleCapacity(
      existingForCapacity,
      this.buildLifePlanTimeRanges(candidate, userId),
      timeZone,
    );

    if (capacity.isPotentiallyStressful && decision === 'ai_decides') {
      const lighter = this.buildLighterLifePlanProposal(
        candidate,
        userId,
        existingForCapacity,
        timeZone,
      );

      if (lighter) {
        candidate = lighter;
        capacity = assessScheduleCapacity(
          existingForCapacity,
          this.buildLifePlanTimeRanges(candidate, userId),
          timeZone,
        );
      }
    }

    if (capacity.isPotentiallyStressful && !allowsStressfulLoad) {
      return {
        parsed: this.buildCapacityNeedInfo(capacity),
        conflict: null,
        canConfirm: false,
      };
    }

    return { parsed: candidate, conflict: null, canConfirm: true };
  }

  private buildLighterLifePlanProposal<
    T extends LifePlanProposal | LifePlanUpdateProposal,
  >(
    proposal: T,
    userId: string,
    existing: Schedule[],
    timeZone: string,
  ): T | null {
    const [startHour, startMinute] = proposal.startTime.split(':').map(Number);
    const [endHour, endMinute] = proposal.endTime.split(':').map(Number);
    const duration = endHour * 60 + endMinute - (startHour * 60 + startMinute);
    let candidate: T = proposal;

    if (duration > 2 * 60) {
      const lighterEnd = startHour * 60 + startMinute + 2 * 60;
      candidate = {
        ...candidate,
        endTime: `${String(Math.floor(lighterEnd / 60)).padStart(2, '0')}:${String(
          lighterEnd % 60,
        ).padStart(2, '0')}`,
      };
    }

    const originalRanges = this.buildLifePlanTimeRanges(candidate, userId);
    const skippedDates = new Set(candidate.skippedDates ?? []);
    let remaining = originalRanges;

    for (let attempts = 0; attempts < originalRanges.length; attempts += 1) {
      const capacity = assessScheduleCapacity(existing, remaining, timeZone);

      if (!capacity.isPotentiallyStressful) {
        return remaining.length > 0
          ? { ...candidate, skippedDates: [...skippedDates] }
          : null;
      }

      if (!capacity.busiestDate) return null;

      const matching = remaining.find(
        (range) =>
          this.dateKeyInTimeZone(range.startDateTime, timeZone) ===
          capacity.busiestDate,
      );

      if (!matching) return null;

      skippedDates.add(matching.startDateTime.toISOString().slice(0, 10));
      remaining = remaining.filter((range) => range !== matching);
    }

    return null;
  }

  private dateKeyInTimeZone(value: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';

    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private applyLifePlanConflictOption<
    T extends LifePlanProposal | LifePlanUpdateProposal,
  >(
    proposal: T,
    conflict: LifePlanConflictResult,
    choice: 'skip_day_and_extend' | 'change_time_for_day',
  ): T | null {
    const option: LifePlanConflictResolutionOption | undefined =
      conflict.options.find((candidate) => candidate.type === choice);

    if (!option) return null;

    if (choice === 'change_time_for_day') {
      if (
        !option.scheduleOverrides?.length ||
        option.scheduleOverrides.length < conflict.conflicts.length
      ) {
        return null;
      }

      return {
        ...proposal,
        scheduleOverrides: option.scheduleOverrides,
      };
    }

    return {
      ...proposal,
      endDate: option.updatedEndDate ?? proposal.endDate,
      skippedDates: option.skippedDates ?? [],
    };
  }

  private buildLifePlanTimeRanges(
    proposal: LifePlanProposal | LifePlanUpdateProposal,
    userId: string,
  ): TimeRange[] {
    const skipped = new Set(proposal.skippedDates ?? []);
    const overrides = new Map(
      (proposal.scheduleOverrides ?? []).map((override) => [
        override.date,
        override,
      ]),
    );

    return buildLifePlanScheduleData({ ...proposal, userId }, userId)
      .filter(
        (schedule) =>
          !skipped.has(schedule.startDateTime.toISOString().slice(0, 10)),
      )
      .map((schedule) => {
        const date = schedule.startDateTime.toISOString().slice(0, 10);
        const override = overrides.get(date);

        if (!override) return schedule;

        return {
          ...schedule,
          startDateTime: new Date(`${date}T${override.startTime}:00.000Z`),
          endDateTime: new Date(`${date}T${override.endTime}:00.000Z`),
        };
      });
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
        isDeleted: false,
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

  private async hasAcceptedScheduleCollision(
    userId: string,
    proposal: ScheduleProposal | ScheduleUpdateProposal,
    ignoredScheduleId?: string,
  ) {
    const collision = await this.prisma.schedule.findFirst({
      where: {
        userId,
        isDeleted: false,
        status: 'ACCEPTED',
        ...(ignoredScheduleId ? { id: { not: ignoredScheduleId } } : {}),
        startDateTime: { lt: new Date(proposal.endDateTime) },
        endDateTime: { gt: new Date(proposal.startDateTime) },
      },
      select: { id: true },
    });

    return Boolean(collision);
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

    if (
      (await this.hasAcceptedScheduleCollision(userId, proposal)) &&
      !(await this.proposalAllowsCollisionOverride(message))
    ) {
      throw new ConflictException(
        'Jadwal ini sekarang bentrok dengan jadwal lain. Kirim pilihanmu lewat chat dulu.',
      );
    }

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

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(acceptedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    // Signing in with Supabase's Google provider doesn't by itself grant
    // Calendar API access — that still requires the separate Google Calendar
    // integration (GoogleCalendarAccount). We only attempt the sync for
    // Google-provider users, and never let a failed/missing sync block the
    // schedule from being saved.
    if (provider !== 'google') {
      return {
        schedule,
        message: updatedMessage,
        syncedToGoogleCalendar: false as const,
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
        message: updatedMessage,
        syncedToGoogleCalendar: true as const,
      };
    } catch (error) {
      return {
        schedule,
        message: updatedMessage,
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

    await this.prisma.schedule.update({
      where: { id: message.schedule.id },
      data: {
        isDeleted: true,
        messageId: null,
      },
    });

    const dismissedMessage: ScheduleDismissedMessage = {
      type: 'schedule_dismissed',
      content: 'Oke, jadwal ini nggak ditambahkan.',
      proposal,
    };

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(dismissedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    return {
      dismissed: true as const,
      message: updatedMessage,
    };
  }

  async rejectProposal(userId: string, messageId: string) {
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

    let parsed: ParsedAssistantResponse;

    try {
      parsed = JSON.parse(message.content) as ParsedAssistantResponse;
    } catch {
      throw new BadRequestException('This message is not a proposal');
    }

    if (parsed.type === 'schedule_proposal') {
      if (message.schedule?.status === 'ACCEPTED') {
        throw new ConflictException('This schedule has already been accepted');
      }

      if (message.schedule) {
        await this.prisma.schedule.update({
          where: { id: message.schedule.id },
          data: {
            isDeleted: true,
            messageId: null,
          },
        });
      }

      const dismissedMessage: ScheduleDismissedMessage = {
        type: 'schedule_dismissed',
        content: 'Oke, jadwal ini nggak ditambahkan.',
        proposal: parsed,
      };

      const updatedMessage = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          content: JSON.stringify(dismissedMessage),
          isScheduleProposal: false,
        },
        include: { schedule: true },
      });

      return {
        rejected: true as const,
        message: updatedMessage,
      };
    }

    const proposal = this.getRejectableProposal(parsed);

    if (!proposal) {
      throw new BadRequestException('This message is not a proposal');
    }

    const rejectedMessage: ProposalRejectedMessage = {
      type: 'proposal_rejected',
      content: this.getProposalRejectedContent(proposal),
      proposal,
    };

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(rejectedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    return {
      rejected: true as const,
      message: updatedMessage,
    };
  }

  private getProposalRejectedContent(
    proposal: ProposalRejectedMessage['proposal'],
  ) {
    switch (proposal.type) {
      case 'schedule_update_proposal':
        return 'Oke, perubahan jadwal ini nggak disimpan.';
      case 'schedule_delete_proposal':
        return 'Oke, jadwal ini nggak dihapus.';
      case 'life_plan_proposal':
        return 'Oke, life plan ini nggak dibuat.';
      case 'life_plan_update_proposal':
        return 'Oke, perubahan life plan ini nggak disimpan.';
      case 'life_plan_delete_proposal':
        return 'Oke, life plan ini nggak dihapus.';
    }
  }

  private getRejectableProposal(
    parsed: ParsedAssistantResponse,
  ): ProposalRejectedMessage['proposal'] | null {
    switch (parsed.type) {
      case 'schedule_update_proposal':
      case 'schedule_delete_proposal':
      case 'life_plan_proposal':
      case 'life_plan_update_proposal':
      case 'life_plan_delete_proposal':
        return parsed;
      default:
        return null;
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

    if (
      (await this.hasAcceptedScheduleCollision(
        userId,
        parsed,
        parsed.scheduleId,
      )) &&
      !(await this.proposalAllowsCollisionOverride(message))
    ) {
      throw new ConflictException(
        'Perubahan ini sekarang bentrok dengan jadwal lain. Kirim pilihanmu lewat chat dulu.',
      );
    }

    console.log(`AMAN SAMPAI SINI`);

    const schedule = await this.prisma.schedule.update({
      where: { id: parsed.scheduleId },
      data: {
        summary: parsed.summary,
        messageId: messageId,
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

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(acceptedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    if (provider !== 'google' || !schedule.googleCalendarEventId) {
      return {
        updated: true as const,
        schedule,
        message: updatedMessage,
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
        message: updatedMessage,
        syncedToGoogleCalendar: true as const,
      };
    } catch (error) {
      return {
        updated: true as const,
        schedule,
        message: updatedMessage,
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

    await this.prisma.schedule.update({
      where: { id: schedule.id },
      data: {
        isDeleted: true,
        messageId: null,
      },
    });

    const acceptedMessage: ScheduleDeleteAcceptedMessage = {
      type: 'schedule_delete_accepted',
      content: 'Jadwal sudah dihapus.',
      scheduleId: schedule.id,
      proposal: parsed,
    };

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(acceptedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    if (provider !== 'google' || !schedule.googleCalendarEventId) {
      return {
        deleted: true as const,
        schedule,
        message: updatedMessage,
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
        message: updatedMessage,
        syncedToGoogleCalendar: true as const,
      };
    } catch (error) {
      return {
        deleted: true as const,
        schedule,
        message: updatedMessage,
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
      throw new BadRequestException('This message is not a life plan proposal');
    }

    if (parsed.type === 'life_plan_accepted') {
      throw new ConflictException('This life plan has already been accepted');
    }

    if (parsed.type !== 'life_plan_proposal') {
      throw new BadRequestException('This message is not a life plan proposal');
    }

    const result = await this.lifePlanService.createFromAi(userId, parsed, {
      allowConflicts: await this.proposalAllowsCollisionOverride(message),
    });

    if (!result.created) {
      const needsInfo = this.buildLifePlanCollisionNeedInfo(result.conflict);

      const updatedMessage = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          content: JSON.stringify(needsInfo),
          isScheduleProposal: false,
        },
        include: { schedule: true },
      });

      return {
        created: false as const,
        lifePlan: null,
        lifePlanConflict: result.conflict,
        message: updatedMessage,
      };
    }

    const acceptedMessage: LifePlanAcceptedMessage = {
      type: 'life_plan_accepted',
      content: 'Life plan sudah dibuat.',
      lifePlanId: result.lifePlan.id,
      proposal: parsed,
    };

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(acceptedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    return {
      created: true as const,
      lifePlan: result.lifePlan,
      lifePlanConflict: null,
      message: updatedMessage,
    };
  }

  private async proposalAllowsCollisionOverride(message: {
    chatId: string;
    createdAt: Date;
  }) {
    const history = await this.prisma.message.findMany({
      where: {
        chatId: message.chatId,
        isDeleted: false,
        createdAt: { lt: message.createdAt },
      },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    const latestUserMessage = [...history]
      .reverse()
      .find((candidate) => candidate.role === 'user');

    if (
      parseConflictDecision(latestUserMessage?.content ?? '') ===
      'allow_collision'
    ) {
      return true;
    }

    return this.findConfirmedSafetyOverrides(history).allowCollision;
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
      {
        allowConflicts: await this.proposalAllowsCollisionOverride(message),
      },
    );

    if (!result.updated) {
      const needsInfo = this.buildLifePlanCollisionNeedInfo(result.conflict);

      const updatedMessage = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          content: JSON.stringify(needsInfo),
          isScheduleProposal: false,
        },
        include: { schedule: true },
      });

      return {
        updated: false as const,
        lifePlan: null,
        lifePlanConflict: result.conflict,
        message: updatedMessage,
      };
    }

    const acceptedMessage: LifePlanUpdateAcceptedMessage = {
      type: 'life_plan_update_accepted',
      content: 'Life plan sudah di-update.',
      lifePlanId: result.lifePlan.id,
      proposal: parsed,
    };

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(acceptedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    return {
      updated: true as const,
      lifePlan: result.lifePlan,
      lifePlanConflict: null,
      message: updatedMessage,
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

    const updatedMessage = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        content: JSON.stringify(acceptedMessage),
        isScheduleProposal: false,
      },
      include: { schedule: true },
    });

    return {
      deleted: true as const,
      lifePlan,
      message: updatedMessage,
    };
  }
}
