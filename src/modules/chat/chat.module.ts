import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  imports: [AuthModule, GoogleCalendarModule],
  controllers: [ChatController],
  providers: [ChatService, PrismaService],
  exports: [ChatService],
})
export class ChatModule {}
