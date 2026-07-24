import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { GoogleCalendarService } from './google-calendar.service';
import { ConnectGoogleCalendarDto } from './dto/connect-google-calendar.dto';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { RescheduleEventDto } from './dto/reschedule-event.dto';
import { PushLaterDto } from './dto/push-later.dto';

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

  @Post('events')
  createEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEventDto,
  ) {
    return this.googleCalendarService.createEvent(user.id, dto);
  }

  @Post('events/push-later')
  pushEventsLater(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PushLaterDto,
  ) {
    return this.googleCalendarService.pushEventsLater(
      user.id,
      dto.fromDateTime,
      dto.toDateTime,
      dto.delayMinutes ?? 15,
    );
  }

  @Patch('events/:id')
  rescheduleEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') eventId: string,
    @Body() dto: RescheduleEventDto,
  ) {
    return this.googleCalendarService.rescheduleEvent(
      user.id,
      eventId,
      dto.startDateTime,
      dto.endDateTime,
    );
  }

  @Put('events/:id')
  updateEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') eventId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.googleCalendarService.updateEvent(user.id, eventId, dto);
  }

  @Delete('events/:id')
  async deleteEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') eventId: string,
  ) {
    await this.googleCalendarService.deleteEvent(user.id, eventId);
    // balikin JSON, jangan body kosong — client nge-parse response-nya
    return { deleted: true as const };
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
