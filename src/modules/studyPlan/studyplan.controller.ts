import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { CreateStudyPlanDto } from './dto/create-studyplan.dto';
import { StudyPlanService } from './studyplan.service';

@UseGuards(SupabaseAuthGuard)
@Controller('study-plans')
export class StudyPlanController {
  constructor(private readonly studyPlanService: StudyPlanService) {}

  @Post()
  createStudyPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStudyPlanDto,
  ) {
    return this.studyPlanService.create(user.id, dto);
  }

  @Get()
  findMyStudyPlans(@CurrentUser() user: AuthenticatedUser) {
    return this.studyPlanService.findAllByUser(user.id);
  }
}
