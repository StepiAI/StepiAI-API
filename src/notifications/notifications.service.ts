import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { SaveDeviceTokenDto } from './dto/save-device-token.dto';
import type { SendNotificationToUserDto } from './dto/send-notification-to-user.dto';
import type { SaveNotificationToAllDto } from './dto/save-notification-to-all.dto';
import type { AddNotificationJobDto } from './dto/add-notification-job.dto';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private firebase: FirebaseService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  async saveDeviceToken(dto: SaveDeviceTokenDto) {
    return this.prisma.deviceToken.upsert({
      where: { token: dto.deviceToken },
      update: { userId: dto.userId, lastUsed: new Date() },
      create: { userId: dto.userId, token: dto.deviceToken },
    });
  }

  async sendNotificationToUser(dto: SendNotificationToUserDto) {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: dto.userId },
    });

    if (tokens.length === 0) {
      console.warn(`No device tokens found for user ${dto.userId}`);
      return;
    }

    const deviceTokens = tokens.map((t) => t.token);

    return this.firebase.sendMulticastNotification(
      deviceTokens,
      dto.title,
      dto.body,
      dto.data,
    );
  }

  async sendNotificationToAll(dto: SaveNotificationToAllDto) {
    const tokens = await this.prisma.deviceToken.findMany();
    const deviceTokens = tokens.map((t) => t.token);

    return this.firebase.sendMulticastNotification(
      deviceTokens,
      dto.title,
      dto.body,
      dto.data,
    );
  }

  async addNotificationJob(dto: AddNotificationJobDto) {
    const jobName = `${dto.name}-${Date.now()}-${Math.random()}`;
    const notificationData = structuredClone(dto.notificationData);

    try {
      if (!this.isValidCronExpression(dto.cronExpression)) {
        throw new Error('Invalid cron expression');
      }

      const job = new CronJob(
        dto.cronExpression,
        async () => {
          try {
            await this.sendNotificationToUser(notificationData);
          } catch (error) {
            throw error;
          } finally {
            this.removeNotificationJob(jobName);
          }
        },
        null,
        true,
        'UTC',
      );

      this.schedulerRegistry.addCronJob(jobName, job);
    } catch (error) {
      throw error;
    }
  }

  private removeNotificationJob(jobName: string) {
    try {
      const job = this.schedulerRegistry.getCronJob(jobName);
      job.stop();
      this.schedulerRegistry.deleteCronJob(jobName);
    } catch (error) {
      throw error;
    }
  }

  private isValidCronExpression(expression: string): boolean {
    try {
      new CronJob(expression, () => {});
      return true;
    } catch {
      return false;
    }
  }
}
