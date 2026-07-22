import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { CreateLifePlanDto } from './dto/create-lifeplan.dto';
import { LifePlanService } from './lifeplan.service';

@UseGuards(SupabaseAuthGuard)
@Controller('life-plans')
export class LifePlanController {
  constructor(private readonly lifePlanService: LifePlanService) {}

  @Post()
  createLifePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLifePlanDto,
  ) {
    return this.lifePlanService.createFromAi(user.id, dto);
  }

  @Get()
  findMyLifePlans(@CurrentUser() user: AuthenticatedUser) {
    return this.lifePlanService.findAllByUser(user.id);
  }

  @Get(':id')
  findOneLifePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.lifePlanService.findOneByUser(user.id, id);
  }
}
