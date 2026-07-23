import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [AuthModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
