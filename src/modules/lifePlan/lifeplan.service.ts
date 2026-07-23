import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Schedule, ScheduleStatus, LifePlan, Weekday } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLifePlanDto } from './dto/create-lifeplan.dto';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SAME_DAY_SEARCH_START_HOUR = 6;
const SAME_DAY_SEARCH_END_HOUR = 23;

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function getWeekday(value: Date): Weekday {
  const dayLookup: Record<number, Weekday> = {
    0: Weekday.SUNDAY,
    1: Weekday.MONDAY,
    2: Weekday.TUESDAY,
    3: Weekday.WEDNESDAY,
    4: Weekday.THURSDAY,
    5: Weekday.FRIDAY,
    6: Weekday.SATURDAY,
  };

  return dayLookup[value.getUTCDay()];
}

function toUtcDateTime(dateOnly: string, time: string): Date {
  const date = parseDateOnly(dateOnly);
  const [hour, minute] = time.split(':').map(Number);

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hour,
      minute,
    ),
  );
}

function isOverlapping(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

export interface LifePlanScheduleData {
  userId: string;
  summary: string;
  description: string;
  location: string;
  startDateTime: Date;
  endDateTime: Date;
}

export interface LifePlanScheduleOverride {
  date: string;
  startTime: string;
  endTime: string;
}

export type CreateLifePlanFromAiDto = CreateLifePlanDto & {
  scheduleOverrides?: LifePlanScheduleOverride[];
  skippedDates?: string[];
  messageId?: string;
};

export interface LifePlanConflict {
  date: string;
  proposedStartDateTime: string;
  proposedEndDateTime: string;
  conflictingSchedules: Array<{
    id: string;
    summary: string;
    startDateTime: string;
    endDateTime: string;
  }>;
}

export interface LifePlanConflictResolutionOption {
  type: 'skip_day_and_extend' | 'change_time_for_day';
  content: string;
  updatedEndDate?: string;
  skippedDates?: string[];
  replacementDates?: string[];
  scheduleOverrides?: LifePlanScheduleOverride[];
}

export interface LifePlanConflictResult {
  type: 'life_plan_conflict';
  content: string;
  conflicts: LifePlanConflict[];
  options: LifePlanConflictResolutionOption[];
}

export type CreateLifePlanFromAiResult =
  | {
      created: true;
      lifePlan: LifePlan;
    }
  | {
      created: false;
      conflict: LifePlanConflictResult;
    };

export type UpdateLifePlanFromAiResult =
  | {
      updated: true;
      lifePlan: LifePlan;
    }
  | {
      updated: false;
      conflict: LifePlanConflictResult;
    };

export interface LifePlanAiWriteOptions {
  allowConflicts?: boolean;
}

export function buildLifePlanScheduleData(
  dto: Pick<
    CreateLifePlanDto,
    | 'title'
    | 'goal'
    | 'startDate'
    | 'endDate'
    | 'availableDays'
    | 'startTime'
    | 'endTime'
  > & { userId: string },
  userId: string,
) {
  const startDate = parseDateOnly(dto.startDate);
  const endDate = parseDateOnly(dto.endDate);

  const schedules: LifePlanScheduleData[] = [];

  const currentDate = new Date(startDate);

  while (currentDate.getTime() <= endDate.getTime()) {
    const currentWeekday = getWeekday(currentDate);

    if (dto.availableDays.includes(currentWeekday)) {
      const dateOnly = formatDateOnly(currentDate);

      schedules.push({
        userId,
        summary: dto.title,
        description: dto.goal,
        location: 'ONLINE',
        startDateTime: toUtcDateTime(dateOnly, dto.startTime),
        endDateTime: toUtcDateTime(dateOnly, dto.endTime),
      });
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return schedules;
}

@Injectable()
export class LifePlanService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromAi(
    userId: string,
    dto: CreateLifePlanFromAiDto,
    options: LifePlanAiWriteOptions = {},
  ): Promise<CreateLifePlanFromAiResult> {
    const scheduleData = this.buildAiScheduleData(userId, dto);
    const conflict = await this.checkAiScheduleConflicts(
      userId,
      dto,
      scheduleData,
    );

    if (conflict && !options.allowConflicts) {
      return {
        created: false,
        conflict,
      };
    }

    return {
      created: true,
      lifePlan: await this.createWithSchedules(
        userId,
        dto,
        scheduleData,
        ScheduleStatus.ACCEPTED,
      ),
    };
  }

  async previewFromAi(
    userId: string,
    dto: CreateLifePlanFromAiDto,
  ): Promise<LifePlanConflictResult | null> {
    const scheduleData = this.buildAiScheduleData(userId, dto);

    return this.checkAiScheduleConflicts(userId, dto, scheduleData);
  }

  async updateFromAi(
    userId: string,
    lifePlanId: string,
    dto: CreateLifePlanFromAiDto,
    options: LifePlanAiWriteOptions = {},
  ): Promise<UpdateLifePlanFromAiResult> {
    await this.findOwnedLifePlan(userId, lifePlanId);

    const scheduleData = this.buildAiScheduleData(userId, dto);
    const conflict = await this.checkAiScheduleConflicts(
      userId,
      dto,
      scheduleData,
      lifePlanId,
    );

    if (conflict && !options.allowConflicts) {
      return {
        updated: false,
        conflict,
      };
    }

    return {
      updated: true,
      lifePlan: await this.updateWithSchedules(
        userId,
        lifePlanId,
        dto,
        scheduleData,
        ScheduleStatus.ACCEPTED,
      ),
    };
  }

  async previewUpdateFromAi(
    userId: string,
    lifePlanId: string,
    dto: CreateLifePlanFromAiDto,
  ): Promise<LifePlanConflictResult | null> {
    await this.findOwnedLifePlan(userId, lifePlanId);

    const scheduleData = this.buildAiScheduleData(userId, dto);

    return this.checkAiScheduleConflicts(userId, dto, scheduleData, lifePlanId);
  }

  async deleteFromAi(userId: string, lifePlanId: string) {
    await this.findOwnedLifePlan(userId, lifePlanId);

    return this.prisma.lifePlan.update({
      where: { id: lifePlanId },
      data: {
        isDeleted: true,
        schedules: {
          updateMany: {
            where: { isDeleted: false },
            data: { isDeleted: true },
          },
        },
      },
    });
  }

  async findForAi(userId: string, lifePlanId: string) {
    return this.findOwnedLifePlan(userId, lifePlanId);
  }

  async setArchived(userId: string, lifePlanId: string, archived: boolean) {
    await this.findOwnedLifePlan(userId, lifePlanId);

    return this.prisma.lifePlan.update({
      where: { id: lifePlanId },
      data: { archived },
    });
  }

  async removeByUser(userId: string, lifePlanId: string) {
    await this.deleteFromAi(userId, lifePlanId);

    return { deleted: true };
  }

  private buildAiScheduleData(userId: string, dto: CreateLifePlanFromAiDto) {
    this.validateLifePlanInput(dto);
    this.validateSkippedDates(dto.skippedDates);
    this.validateScheduleOverrides(dto.scheduleOverrides);

    let scheduleData = buildLifePlanScheduleData(
      {
        userId,
        title: dto.title,
        goal: dto.goal,
        startDate: dto.startDate,
        endDate: dto.endDate,
        availableDays: dto.availableDays,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
      userId,
    );

    scheduleData = this.filterSkippedDates(scheduleData, dto.skippedDates);

    scheduleData = this.applyScheduleOverrides(
      scheduleData,
      dto.scheduleOverrides,
    );

    return scheduleData;
  }

  private async checkAiScheduleConflicts(
    userId: string,
    dto: CreateLifePlanFromAiDto,
    scheduleData: LifePlanScheduleData[],
    ignoredLifePlanId?: string,
  ) {
    const conflicts = await this.findScheduleConflicts(
      userId,
      scheduleData,
      ignoredLifePlanId,
    );

    if (conflicts.length > 0) {
      return this.buildAiConflictResult(
        userId,
        dto,
        conflicts,
        ignoredLifePlanId,
      );
    }

    return null;
  }

  private async findOwnedLifePlan(userId: string, lifePlanId: string) {
    const lifePlan = await this.prisma.lifePlan.findFirst({
      where: {
        id: lifePlanId,
        userId,
        isDeleted: false,
      },
    });

    if (!lifePlan) {
      throw new NotFoundException('Life plan not found');
    }

    return lifePlan;
  }

  private validateLifePlanInput(dto: CreateLifePlanDto) {
    const startDate = parseDateOnly(dto.startDate);

    const endDate = parseDateOnly(dto.endDate);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }
  }

  private validateScheduleOverrides(overrides?: LifePlanScheduleOverride[]) {
    if (!overrides) return;

    for (const override of overrides) {
      if (!TIME_PATTERN.test(override.startTime)) {
        throw new BadRequestException(
          'scheduleOverrides.startTime must be in HH:mm format',
        );
      }

      if (!TIME_PATTERN.test(override.endTime)) {
        throw new BadRequestException(
          'scheduleOverrides.endTime must be in HH:mm format',
        );
      }

      if (override.endTime <= override.startTime) {
        throw new BadRequestException(
          'scheduleOverrides.endTime must be after startTime',
        );
      }
    }
  }

  private validateSkippedDates(skippedDates?: string[]) {
    if (!skippedDates) return;

    for (const date of skippedDates) {
      if (!Number.isFinite(parseDateOnly(date).getTime())) {
        throw new BadRequestException(
          'skippedDates must contain valid date strings',
        );
      }
    }
  }

  private createWithSchedules(
    userId: string,
    dto: CreateLifePlanDto,
    scheduleData: LifePlanScheduleData[],
    scheduleStatus?: ScheduleStatus,
  ) {
    const startDate = parseDateOnly(dto.startDate);
    const endDate = parseDateOnly(dto.endDate);

    return this.prisma.$transaction(async (tx) => {
      const lifePlan = await tx.lifePlan.create({
        data: {
          userId,
          title: dto.title,
          goal: dto.goal,
          topics: dto.topic,

          startDate,
          endDate,

          availableDays: dto.availableDays,

          startTime: dto.startTime,

          endTime: dto.endTime,

          difficultyLevel: dto.difficultyLevel,

          focusPreferences: dto.focusPreferences,
        },
      });

      if (scheduleData.length > 0) {
        await tx.schedule.createMany({
          data: scheduleStatus
            ? scheduleData.map((schedule) => ({
                ...schedule,
                lifePlanId: lifePlan.id,
                status: scheduleStatus,
              }))
            : scheduleData.map((schedule) => ({
                ...schedule,
                lifePlanId: lifePlan.id,
              })),
        });
      }

      return lifePlan;
    });
  }

  private updateWithSchedules(
    userId: string,
    lifePlanId: string,
    dto: CreateLifePlanDto,
    scheduleData: LifePlanScheduleData[],
    scheduleStatus: ScheduleStatus,
  ) {
    const startDate = parseDateOnly(dto.startDate);
    const endDate = parseDateOnly(dto.endDate);

    return this.prisma.$transaction(async (tx) => {
      const lifePlan = await tx.lifePlan.update({
        where: {
          id: lifePlanId,
        },
        data: {
          title: dto.title,
          goal: dto.goal,
          topics: dto.topic,
          startDate,
          endDate,
          availableDays: dto.availableDays,
          startTime: dto.startTime,
          endTime: dto.endTime,
          difficultyLevel: dto.difficultyLevel,
          focusPreferences: dto.focusPreferences,
        },
      });

      await tx.schedule.updateMany({
        where: {
          userId,
          lifePlanId,
          isDeleted: false,
        },
        data: { isDeleted: true },
      });

      if (scheduleData.length > 0) {
        await tx.schedule.createMany({
          data: scheduleData.map((schedule) => ({
            ...schedule,
            lifePlanId,
            status: scheduleStatus,
          })),
        });
      }

      return lifePlan;
    });
  }

  private applyScheduleOverrides(
    scheduleData: LifePlanScheduleData[],
    overrides?: LifePlanScheduleOverride[],
  ) {
    if (!overrides?.length) return scheduleData;

    const overridesByDate = new Map(
      overrides.map((override) => [override.date, override]),
    );

    return scheduleData.map((schedule) => {
      const date = formatDateOnly(schedule.startDateTime);
      const override = overridesByDate.get(date);

      if (!override) return schedule;

      return {
        ...schedule,
        startDateTime: toUtcDateTime(date, override.startTime),
        endDateTime: toUtcDateTime(date, override.endTime),
      };
    });
  }

  private filterSkippedDates(
    scheduleData: LifePlanScheduleData[],
    skippedDates?: string[],
  ) {
    if (!skippedDates?.length) return scheduleData;

    const skippedDateSet = new Set(skippedDates);

    return scheduleData.filter(
      (schedule) => !skippedDateSet.has(formatDateOnly(schedule.startDateTime)),
    );
  }

  private async findScheduleConflicts(
    userId: string,
    scheduleData: LifePlanScheduleData[],
    ignoredLifePlanId?: string,
  ): Promise<LifePlanConflict[]> {
    if (scheduleData.length === 0) return [];

    const minStartTime = Math.min(
      ...scheduleData.map((schedule) => schedule.startDateTime.getTime()),
    );
    const maxEndTime = Math.max(
      ...scheduleData.map((schedule) => schedule.endDateTime.getTime()),
    );

    const existingSchedules = await this.prisma.schedule.findMany({
      where: {
        userId,
        isDeleted: false,
        status: ScheduleStatus.ACCEPTED,
        startDateTime: { lt: new Date(maxEndTime) },
        endDateTime: { gt: new Date(minStartTime) },
        ...(ignoredLifePlanId
          ? {
              OR: [
                { lifePlanId: null },
                { lifePlanId: { not: ignoredLifePlanId } },
              ],
            }
          : {}),
      },
      orderBy: { startDateTime: 'asc' },
    });

    return scheduleData
      .map((schedule) => {
        const conflictingSchedules = existingSchedules.filter((existing) =>
          isOverlapping(
            schedule.startDateTime,
            schedule.endDateTime,
            existing.startDateTime,
            existing.endDateTime,
          ),
        );

        return {
          date: formatDateOnly(schedule.startDateTime),
          proposedStartDateTime: schedule.startDateTime.toISOString(),
          proposedEndDateTime: schedule.endDateTime.toISOString(),
          conflictingSchedules: conflictingSchedules.map((conflict) => ({
            id: conflict.id,
            summary: conflict.summary,
            startDateTime: conflict.startDateTime.toISOString(),
            endDateTime: conflict.endDateTime.toISOString(),
          })),
        };
      })
      .filter((conflict) => conflict.conflictingSchedules.length > 0);
  }

  private async buildAiConflictResult(
    userId: string,
    dto: CreateLifePlanFromAiDto,
    conflicts: LifePlanConflict[],
    ignoredLifePlanId?: string,
  ): Promise<LifePlanConflictResult> {
    const skipOption = await this.buildSkipDayAndExtendOption(
      userId,
      dto,
      conflicts,
      ignoredLifePlanId,
    );
    const changeTimeOption = await this.buildChangeTimeForDayOption(
      userId,
      conflicts,
      ignoredLifePlanId,
    );

    return {
      type: 'life_plan_conflict',
      content:
        'Ada beberapa sesi belajar yang bentrok sama jadwal kamu. Kamu bisa pilih: skip hari yang bentrok lalu durasinya diperpanjang, atau ubah jam khusus di hari itu aja.',
      conflicts,
      options: [skipOption, changeTimeOption],
    };
  }

  private async buildSkipDayAndExtendOption(
    userId: string,
    dto: CreateLifePlanFromAiDto,
    conflicts: LifePlanConflict[],
    ignoredLifePlanId?: string,
  ): Promise<LifePlanConflictResolutionOption> {
    const extension = await this.findReplacementStudyDates(
      userId,
      dto,
      conflicts.length,
      ignoredLifePlanId,
    );
    const skippedDates = [
      ...conflicts.map((conflict) => conflict.date),
      ...extension.skippedDates,
    ];

    return {
      type: 'skip_day_and_extend',
      content: `Skip tanggal ${skippedDates.join(
        ', ',
      )}, lalu life plan diperpanjang sampai ${
        extension.replacementDates.at(-1) ?? dto.endDate
      }.`,
      updatedEndDate: extension.replacementDates.at(-1) ?? dto.endDate,
      skippedDates,
      replacementDates: extension.replacementDates,
    };
  }

  private async findReplacementStudyDates(
    userId: string,
    dto: CreateLifePlanFromAiDto,
    neededCount: number,
    ignoredLifePlanId?: string,
  ): Promise<{ replacementDates: string[]; skippedDates: string[] }> {
    const replacementDates: string[] = [];
    const skippedDates: string[] = [];
    let cursor = addUtcDays(parseDateOnly(dto.endDate), 1);
    const maxSearchDays = 366;

    for (
      let searchedDays = 0;
      searchedDays < maxSearchDays && replacementDates.length < neededCount;
      searchedDays += 1
    ) {
      const date = formatDateOnly(cursor);

      if (dto.availableDays.includes(getWeekday(cursor))) {
        if (
          await this.hasConflictAt(
            userId,
            date,
            dto.startTime,
            dto.endTime,
            ignoredLifePlanId,
          )
        ) {
          skippedDates.push(date);
        } else {
          replacementDates.push(date);
        }
      }

      cursor = addUtcDays(cursor, 1);
    }

    return { replacementDates, skippedDates };
  }

  private async hasConflictAt(
    userId: string,
    date: string,
    startTime: string,
    endTime: string,
    ignoredLifePlanId?: string,
  ): Promise<boolean> {
    const startDateTime = toUtcDateTime(date, startTime);
    const endDateTime = toUtcDateTime(date, endTime);

    const conflict = await this.prisma.schedule.findFirst({
      where: {
        userId,
        isDeleted: false,
        status: ScheduleStatus.ACCEPTED,
        startDateTime: { lt: endDateTime },
        endDateTime: { gt: startDateTime },
        ...(ignoredLifePlanId
          ? {
              OR: [
                { lifePlanId: null },
                { lifePlanId: { not: ignoredLifePlanId } },
              ],
            }
          : {}),
      },
    });

    return Boolean(conflict);
  }

  private async buildChangeTimeForDayOption(
    userId: string,
    conflicts: LifePlanConflict[],
    ignoredLifePlanId?: string,
  ): Promise<LifePlanConflictResolutionOption> {
    const scheduleOverrides = (
      await Promise.all(
        conflicts.map(async (conflict) =>
          this.findSameDayAlternative(userId, conflict, ignoredLifePlanId),
        ),
      )
    ).filter((override): override is LifePlanScheduleOverride =>
      Boolean(override),
    );

    return {
      type: 'change_time_for_day',
      content:
        scheduleOverrides.length === conflicts.length
          ? 'Ubah jam hanya untuk hari yang bentrok ke waktu kosong yang disarankan.'
          : 'Belum ketemu jam kosong di hari yang sama untuk semua tanggal bentrok. Tanya user mau pindah ke jam berapa untuk tanggal itu.',
      scheduleOverrides,
    };
  }

  private async findSameDayAlternative(
    userId: string,
    conflict: LifePlanConflict,
    ignoredLifePlanId?: string,
  ): Promise<LifePlanScheduleOverride | null> {
    const proposedStart = new Date(conflict.proposedStartDateTime);
    const proposedEnd = new Date(conflict.proposedEndDateTime);
    const durationMs = proposedEnd.getTime() - proposedStart.getTime();
    const day = parseDateOnly(conflict.date);
    const searchStart = new Date(
      Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        SAME_DAY_SEARCH_START_HOUR,
      ),
    );
    const searchEnd = new Date(
      Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        SAME_DAY_SEARCH_END_HOUR,
      ),
    );

    const existingSchedules = await this.prisma.schedule.findMany({
      where: {
        userId,
        isDeleted: false,
        status: ScheduleStatus.ACCEPTED,
        startDateTime: { lt: searchEnd },
        endDateTime: { gt: searchStart },
        ...(ignoredLifePlanId
          ? {
              OR: [
                { lifePlanId: null },
                { lifePlanId: { not: ignoredLifePlanId } },
              ],
            }
          : {}),
      },
      orderBy: { startDateTime: 'asc' },
    });

    const slot = this.findFirstAvailableSlot(
      searchStart,
      searchEnd,
      durationMs,
      existingSchedules,
    );

    if (!slot) return null;

    return {
      date: conflict.date,
      startTime: this.formatUtcTime(slot.start),
      endTime: this.formatUtcTime(slot.end),
    };
  }

  private findFirstAvailableSlot(
    searchStart: Date,
    searchEnd: Date,
    durationMs: number,
    existingSchedules: Schedule[],
  ) {
    let cursor = searchStart.getTime();

    for (const existing of existingSchedules) {
      const availableEnd = existing.startDateTime.getTime();

      if (cursor + durationMs <= availableEnd) {
        return {
          start: new Date(cursor),
          end: new Date(cursor + durationMs),
        };
      }

      cursor = Math.max(cursor, existing.endDateTime.getTime());
    }

    if (cursor + durationMs <= searchEnd.getTime()) {
      return {
        start: new Date(cursor),
        end: new Date(cursor + durationMs),
      };
    }

    return null;
  }

  private formatUtcTime(value: Date): string {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(
      value.getUTCMinutes(),
    ).padStart(2, '0')}`;
  }

  async findAllByUser(userId: string) {
    return this.prisma.lifePlan.findMany({
      where: {
        userId,
        isDeleted: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOneByUser(userId: string, lifePlanId: string) {
    const lifePlan = await this.prisma.lifePlan.findFirst({
      where: {
        id: lifePlanId,
        userId,
        isDeleted: false,
      },
      include: {
        schedules: {
          where: { isDeleted: false },
          orderBy: {
            startDateTime: 'asc',
          },
        },
      },
    });

    if (!lifePlan) {
      throw new NotFoundException('Life plan not found');
    }

    return lifePlan;
  }
}
