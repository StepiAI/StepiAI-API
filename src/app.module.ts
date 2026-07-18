import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './common/auth.module';
import { ExampleModule } from './modules/example/example.module';
import { OpenAiModule } from './modules/openai/openai.module';
import { GoogleCalendarModule } from './modules/google-calendar/google-calendar.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    SupabaseModule,
    AuthModule,
    ExampleModule,
    OpenAiModule,
    GoogleCalendarModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
