import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { StudyPlanController } from './studyplan.controller';
import { StudyPlanService } from './studyplan.service';

@Module({
  imports: [AuthModule],
  controllers: [StudyPlanController],
  providers: [StudyPlanService],
  exports: [StudyPlanService],
})
export class StudyPlanModule {}
