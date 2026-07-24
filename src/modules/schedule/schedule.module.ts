import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [AuthModule, GoogleCalendarModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
