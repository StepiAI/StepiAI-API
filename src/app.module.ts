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
// import { NotificationsModule } from './notifications/notifications.module';
// import { FirebaseModule } from './firebase/firebase.module';
import { StudyPlanModule } from './modules/studyPlan/studyplan.module';
import { ScheduleModule } from './modules/schedule/schedule.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    SupabaseModule,
    AuthModule,
    OpenAiModule,
    GoogleCalendarModule,
    ChatModule,
    // NotificationsModule,
    // FirebaseModule,
    StudyPlanModule,
    ScheduleModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
