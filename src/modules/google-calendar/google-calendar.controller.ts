import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { GoogleCalendarService } from './google-calendar.service';
import { ConnectGoogleCalendarDto } from './dto/connect-google-calendar.dto';
import { ListEventsQueryDto } from './dto/list-events-query.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('integrations/google-calendar')
export class GoogleCalendarController {
  constructor(private readonly googleCalendarService: GoogleCalendarService) {}

  @Post('connect')
  connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectGoogleCalendarDto,
  ) {
    return this.googleCalendarService.connect(user.id, dto.serverAuthCode);
  }

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.googleCalendarService.getStatus(user.id);
  }

  @Delete()
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.googleCalendarService.disconnect(user.id);
  }

  @Get('events')
  listEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEventsQueryDto,
  ) {
    return this.googleCalendarService.listEvents(
      user.id,
      query.timeMin,
      query.timeMax,
    );
  }
}
