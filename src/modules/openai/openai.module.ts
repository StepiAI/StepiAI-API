import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { OpenAiRealtimeController } from './openai-realtime.controller';
import { OpenAiService } from './openai.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [OpenAiRealtimeController],
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
