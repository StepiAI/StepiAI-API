import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { LifePlanController } from './lifeplan.controller';
import { LifePlanService } from './lifeplan.service';

@Module({
  imports: [AuthModule],
  controllers: [LifePlanController],
  providers: [LifePlanService],
  exports: [LifePlanService],
})
export class LifePlanModule {}
