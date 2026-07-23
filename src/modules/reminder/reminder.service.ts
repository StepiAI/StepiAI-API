import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

const GRACE_MINUTES = 5;
const MAX_LEAD_MINUTES = 1440;

function reminderBody(minutesBefore: number): string {
  if (minutesBefore <= 0) return 'Jadwalmu dimulai sekarang.';
  if (minutesBefore < 60) return `Jadwalmu dimulai dalam ${minutesBefore} menit.`;
  if (minutesBefore < 1440) {
    return `Jadwalmu dimulai dalam ${minutesBefore / 60} jam.`;
  }
  return `Jadwalmu dimulai dalam ${minutesBefore / 1440} hari.`;
}

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
    const maxLead = new Date(now.getTime() + MAX_LEAD_MINUTES * 60 * 1000);

    const candidates = await this.prisma.schedule.findMany({
      where: {
        status: 'ACCEPTED',
        isDeleted: { not: true },
        reminderSentAt: null,
        startDateTime: { gte: graceStart, lte: maxLead },
      },
    });

    for (const schedule of candidates) {
      const minutesBefore = schedule.reminderMinutesBefore ?? 0;
      const notifyAt = new Date(
        schedule.startDateTime.getTime() - minutesBefore * 60 * 1000,
      );

      if (notifyAt < graceStart || notifyAt > now) {
        continue;
      }

      try {
        await this.notifications.sendNotificationToUser({
          userId: schedule.userId,
          title: schedule.summary,
          body: reminderBody(minutesBefore),
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
