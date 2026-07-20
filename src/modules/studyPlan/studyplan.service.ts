import { BadRequestException, Injectable } from '@nestjs/common';
import { Weekday } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStudyPlanDto } from './dto/create-studyplan.dto';

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day));
}

export function buildStudyPlanScheduleData(
  dto: Pick<
    CreateStudyPlanDto,
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

  const [startHour, startMinute] = dto.startTime.split(':').map(Number);

  const [endHour, endMinute] = dto.endTime.split(':').map(Number);

  const schedules: Array<{
    userId: string;
    summary: string;
    description: string;
    location: string;
    startDateTime: Date;
    endDateTime: Date;
  }> = [];

  const dayLookup: Record<number, Weekday> = {
    0: Weekday.SUNDAY,
    1: Weekday.MONDAY,
    2: Weekday.TUESDAY,
    3: Weekday.WEDNESDAY,
    4: Weekday.THURSDAY,
    5: Weekday.FRIDAY,
    6: Weekday.SATURDAY,
  };

  const currentDate = new Date(startDate);

  while (currentDate.getTime() <= endDate.getTime()) {
    const currentWeekday = dayLookup[currentDate.getUTCDay()];

    if (dto.availableDays.includes(currentWeekday)) {
      const year = currentDate.getUTCFullYear();
      const month = currentDate.getUTCMonth();
      const day = currentDate.getUTCDate();

      schedules.push({
        userId,
        summary: dto.title,
        description: dto.goal,
        location: 'ONLINE',

        startDateTime: new Date(
          Date.UTC(year, month, day, startHour, startMinute),
        ),

        endDateTime: new Date(Date.UTC(year, month, day, endHour, endMinute)),
      });
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return schedules;
}

@Injectable()
export class StudyPlanService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateStudyPlanDto) {
    const startDate = parseDateOnly(dto.startDate);

    const endDate = parseDateOnly(dto.endDate);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }

    const scheduleData = buildStudyPlanScheduleData(
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

    return this.prisma.$transaction(async (tx) => {
      const studyPlan = await tx.studyPlan.create({
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
          data: scheduleData,
        });
      }

      return studyPlan;
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.studyPlan.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
