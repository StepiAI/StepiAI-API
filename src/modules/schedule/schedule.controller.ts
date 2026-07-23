import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { ListSchedulesQueryDto } from './dto/list-schedules-query.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ScheduleService } from './schedule.service';

@UseGuards(SupabaseAuthGuard)
@Controller('schedules')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  findMySchedules(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSchedulesQueryDto,
  ) {
    return this.scheduleService.findAllByUser(user.id, query);
  }

  @Get(':scheduleId')
  findMySchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ) {
    return this.scheduleService.findOneByUser(user.id, scheduleId);
  }

  @Put(':scheduleId')
  updateMySchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.scheduleService.updateByUser(user.id, scheduleId, dto);
  }

  @Delete(':scheduleId')
  removeMySchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ) {
    return this.scheduleService.removeByUser(user.id, scheduleId);
  }
}
