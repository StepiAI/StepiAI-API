import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { ListSchedulesQueryDto } from './dto/list-schedules-query.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

  findAllByUser(userId: string, query: ListSchedulesQueryDto) {
    return this.prisma.schedule.findMany({
      where: {
        userId,
        isDeleted: false,
        // sesi life plan yg planners-nya di-archive/di-hapus jangan ikut muncul
        // — ini yg bikin kalender otomatis "bersih" pas plan di-archive
        OR: [
          { lifePlanId: null },
          { lifePlan: { archived: false, isDeleted: false } },
        ],
        ...(query.status ? { status: query.status } : {}),
        ...(query.timeMin
          ? { endDateTime: { gt: new Date(query.timeMin) } }
          : {}),
        ...(query.timeMax
          ? { startDateTime: { lt: new Date(query.timeMax) } }
          : {}),
      },
      orderBy: {
        startDateTime: 'asc',
      },
    });
  }

  // edit jadwal lokal (termasuk sesi life plan) — beda sama event Google yg
  // diedit lewat modul google-calendar
  async updateByUser(
    userId: string,
    scheduleId: string,
    dto: UpdateScheduleDto,
  ) {
    await this.findOneByUser(userId, scheduleId);

    const start = new Date(dto.startDateTime);
    const end = new Date(dto.endDateTime);

    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('Schedule must end after it starts.');
    }

    const schedule = await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        summary: dto.summary,
        description: dto.description ?? null,
        location: dto.location ?? null,
        startDateTime: start,
        endDateTime: end,
      },
    });

    const googleCalendarSync =
      await this.googleCalendarService.syncScheduleToGoogleCalendar(
        userId,
        schedule,
      );

    return { ...schedule, googleCalendarSync };
  }

  // soft delete satu sesi (dipakai buat hapus task dari life plan)
  async removeByUser(userId: string, scheduleId: string) {
    const schedule = await this.findOneByUser(userId, scheduleId);

    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: { isDeleted: true },
    });

    const googleCalendarSync =
      await this.googleCalendarService.deleteScheduleFromGoogleCalendar(
        userId,
        schedule,
      );

    return { deleted: true as const, googleCalendarSync };
  }

  async findOneByUser(userId: string, scheduleId: string) {
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

    return schedule;
  }
}
