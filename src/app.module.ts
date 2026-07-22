import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './common/auth.module';
import { OpenAiModule } from './modules/openai/openai.module';
import { GoogleCalendarModule } from './modules/google-calendar/google-calendar.module';
import { ChatModule } from './modules/chat/chat.module';
import { StudyPlanModule } from './modules/studyPlan/studyplan.module';
import { WeatherModule } from './modules/weather/weather.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    SupabaseModule,
    AuthModule,
    OpenAiModule,
    GoogleCalendarModule,
    ChatModule,
    StudyPlanModule,
    ScheduleModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
