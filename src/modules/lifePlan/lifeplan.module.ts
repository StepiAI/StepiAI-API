import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { LifePlanController } from './lifeplan.controller';
import { LifePlanService } from './lifeplan.service';

@Module({
  imports: [AuthModule, GoogleCalendarModule],
  controllers: [LifePlanController],
  providers: [LifePlanService],
  exports: [LifePlanService],
})
export class LifePlanModule {}
