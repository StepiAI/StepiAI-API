import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { OpenAiService } from './openai.service';

@Global()
@Module({
  imports: [AuthModule],
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
