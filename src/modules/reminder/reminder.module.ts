import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [ReminderService],
})
export class ReminderModule {}
