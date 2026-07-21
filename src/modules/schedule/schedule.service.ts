import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListSchedulesQueryDto } from './dto/list-schedules-query.dto';

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  findAllByUser(userId: string, query: ListSchedulesQueryDto) {
    return this.prisma.schedule.findMany({
      where: {
        userId,
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

  async findOneByUser(userId: string, scheduleId: string) {
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        id: scheduleId,
        userId,
      },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    return schedule;
  }
}
