import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

const GRACE_MINUTES = 5;

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueReminders() {
    const now = new Date();
    const graceStart = new Date(now.getTime() - GRACE_MINUTES * 60 * 1000);

    const dueSchedules = await this.prisma.schedule.findMany({
      where: {
        status: 'ACCEPTED',
        isDeleted: { not: true },
        reminderSentAt: null,
        startDateTime: { gte: graceStart, lte: now },
      },
    });

    if (dueSchedules.length === 0) {
      return;
    }

    for (const schedule of dueSchedules) {
      try {
        await this.notifications.sendNotificationToUser({
          userId: schedule.userId,
          title: schedule.summary,
          body: 'Jadwalmu dimulai sekarang.',
          data: { scheduleId: schedule.id, type: 'schedule_reminder' },
        });

        await this.prisma.schedule.update({
          where: { id: schedule.id },
          data: { reminderSentAt: new Date() },
        });
      } catch (error) {
        this.logger.error(
          `Gagal kirim reminder untuk schedule ${schedule.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
