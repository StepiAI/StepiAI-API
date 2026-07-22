import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private firebase: FirebaseService,
  ) {}

  async saveDeviceToken(userId: string, deviceToken: string) {
    return this.prisma.deviceToken.upsert({
      where: { token: deviceToken },
      update: { userId, lastUsed: new Date() },
      create: { userId, token: deviceToken },
    });
  }

  async sendNotificationToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
    });

    if (tokens.length === 0) {
      console.warn(`No device tokens found for user ${userId}`);
      return;
    }

    const deviceTokens = tokens.map((t) => t.token);

    return this.firebase.sendMulticastNotification(
      deviceTokens,
      title,
      body,
      data,
    );
  }

  async sendNotificationToAll(
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    const tokens = await this.prisma.deviceToken.findMany();
    const deviceTokens = tokens.map((t) => t.token);

    return this.firebase.sendMulticastNotification(
      deviceTokens,
      title,
      body,
      data,
    );
  }
}
