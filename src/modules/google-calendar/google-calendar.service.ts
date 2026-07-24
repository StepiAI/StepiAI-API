import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  auth as googleAuth,
  calendar,
  calendar_v3,
} from '@googleapis/calendar';
import type { Credentials } from 'google-auth-library';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { GeocodingService } from '../weather/geocoding.service';
import { CreateEventDto } from './dto/create-event.dto';
import type { Schedule } from '@prisma/client';

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

// ubah menit-sebelum jadi bentuk reminders Google. undefined = jangan disentuh
// (pakai default kalender); null = tanpa alert; angka = override eksplisit.
function toReminders(
  minutesBefore?: number | null,
): calendar_v3.Schema$Event['reminders'] | undefined {
  if (minutesBefore === undefined) return undefined;

  return {
    useDefault: false,
    overrides:
      minutesBefore === null
        ? []
        : [{ method: 'popup', minutes: minutesBefore }],
  };
}

@Injectable()
export class GoogleCalendarService {
  private readonly oauthClientId: string;
  private readonly oauthClientSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    configService: ConfigService<AppConfig, true>,
  ) {
    const { clientId, clientSecret } = configService.get('google', {
      infer: true,
    });

    this.oauthClientId = clientId;
    this.oauthClientSecret = clientSecret;
  }

  private createOAuthClient() {
    return new googleAuth.OAuth2(
      this.oauthClientId,
      this.oauthClientSecret,
      '',
    );
  }

  async connect(userId: string, serverAuthCode: string) {
    const oauthClient = this.createOAuthClient();
    let tokens: Credentials;

    try {
      ({ tokens } = await oauthClient.getToken(serverAuthCode));
    } catch (error) {
      throw new BadRequestException(
        `Google rejected the authorization code: ${this.describeGoogleError(error)}`,
      );
    }

    if (!tokens.access_token || !tokens.expiry_date) {
      throw new BadGatewayException(
        'Google did not return a usable access token.',
      );
    }

    const existing = await this.prisma.googleCalendarAccount.findUnique({
      where: { userId },
    });

    const refreshToken = tokens.refresh_token ?? existing?.refreshToken;
    if (!refreshToken) {
      throw new BadRequestException('Google did not return a refresh token.');
    }

    const account = await this.prisma.googleCalendarAccount.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken,
        expiresAt: new Date(tokens.expiry_date),
        scope: tokens.scope ?? '',
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken,
        expiresAt: new Date(tokens.expiry_date),
        scope: tokens.scope ?? '',
      },
    });

    return this.toStatus(account);
  }

  async getStatus(userId: string) {
    const account = await this.prisma.googleCalendarAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      return { connected: false as const };
    }

    return {
      ...this.toStatus(account),
      email: await this.getPrimaryEmail(userId),
    };
  }

  // id primary calendar = alamat email akunnya, dipake buat mastiin akun mana yg ke-connect
  private async getPrimaryEmail(userId: string): Promise<string | null> {
    try {
      const calendar = await this.getCalendarClient(userId);
      const { data } = await calendar.calendars.get({ calendarId: 'primary' });
      return data.id ?? null;
    } catch (error) {
      console.error(
        '[GoogleCalendar] could not resolve primary email:',
        this.describeGoogleError(error),
      );
      return null;
    }
  }

  async disconnect(userId: string) {
    await this.prisma.googleCalendarAccount
      .delete({ where: { userId } })
      .catch(() => undefined);

    return { connected: false as const };
  }

  private async getValidAccessToken(userId: string): Promise<string> {
    const account = await this.prisma.googleCalendarAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      throw new NotFoundException('Google Calendar is not connected.');
    }

    const isExpired =
      account.expiresAt.getTime() - EXPIRY_SAFETY_MARGIN_MS <= Date.now();
    if (!isExpired) {
      return account.accessToken;
    }

    const oauthClient = this.createOAuthClient();
    oauthClient.setCredentials({ refresh_token: account.refreshToken });

    let credentials: Credentials;
    try {
      ({ credentials } = await oauthClient.refreshAccessToken());
    } catch (error) {
      throw new UnauthorizedException(
        `Google Calendar access expired, reconnect required: ${this.describeGoogleError(error)}`,
      );
    }

    if (!credentials.access_token || !credentials.expiry_date) {
      throw new BadGatewayException(
        'Failed to refresh Google Calendar access token.',
      );
    }

    await this.prisma.googleCalendarAccount.update({
      where: { userId },
      data: {
        accessToken: credentials.access_token,
        expiresAt: new Date(credentials.expiry_date),
      },
    });

    return credentials.access_token;
  }

  private async getCalendarClient(userId: string) {
    const accessToken = await this.getValidAccessToken(userId);
    const oauthClient = this.createOAuthClient();
    oauthClient.setCredentials({ access_token: accessToken });
    return calendar({ version: 'v3', auth: oauthClient });
  }

  async listEvents(userId: string, timeMin?: string, timeMax?: string) {
    const calendar = await this.getCalendarClient(userId);

    try {
      const { data } = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin ?? new Date().toISOString(),
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return this.attachSavedLocations(data.items ?? []);
    } catch (error) {
      throw this.toGoogleApiException(error, 'list calendar events');
    }
  }

  private async attachSavedLocations(items: calendar_v3.Schema$Event[]) {
    const locations = items
      .map((item) => item.location)
      .filter((location): location is string => Boolean(location));

    if (locations.length === 0) {
      return items;
    }

    const coordsByLocation = await this.geocoding.lookupCachedMany(locations);

    if (coordsByLocation.size === 0) {
      return items;
    }

    return items.map((item) => {
      const coords = item.location
        ? coordsByLocation.get(item.location)
        : undefined;

      return coords
        ? { ...item, latitude: coords.latitude, longitude: coords.longitude }
        : item;
    });
  }

  async createEvent(
    userId: string,
    input: CreateEventDto,
    options: { mirrorToSchedule?: boolean } = {},
  ) {
    const start = new Date(input.startDateTime);
    const end = new Date(input.endDateTime);

    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('Event must end after it starts.');
    }

    const calendar = await this.getCalendarClient(userId);

    try {
      const { data } = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: input.summary,
          location: input.location,
          description: input.description,
          start: { dateTime: start.toISOString(), timeZone: input.timeZone },
          end: { dateTime: end.toISOString(), timeZone: input.timeZone },
          // undefined = event sekali jalan; Google nolak array kosong
          recurrence: input.recurrence?.length ? input.recurrence : undefined,
          reminders: toReminders(input.reminderMinutesBefore),
        },
      });

      if (options.mirrorToSchedule !== false) {
        const isNoneAlert = input.reminderMinutesBefore === null;
        try {
          await this.prisma.schedule.create({
            data: {
              userId,
              summary: input.summary,
              description: input.description ?? null,
              location: input.location ?? null,
              startDateTime: start,
              endDateTime: end,
              status: 'ACCEPTED',
              googleCalendarEventId: data.id ?? null,
              reminderMinutesBefore: isNoneAlert
                ? null
                : (input.reminderMinutesBefore ?? 0),
              reminderSentAt: isNoneAlert ? new Date() : null,
            },
          });
        } catch (error) {
          console.error(
            '[GoogleCalendar] failed to mirror event to schedules:',
            error,
          );
        }
      }

      // Google gak nyimpen koordinat, jd kalau user milih tempat (ada lat/lng),
      // kita seed ke geocode_cache di-key sama teks lokasinya. nanti pas list/
      // detail, teks lokasi yg sama bakal ke-resolve ke koordinat pilihan ini.
      if (
        input.location &&
        input.latitude !== undefined &&
        input.longitude !== undefined
      ) {
        await this.geocoding.cachePlace(input.location, {
          latitude: input.latitude,
          longitude: input.longitude,
          label: input.location,
        });

        return {
          ...data,
          latitude: input.latitude,
          longitude: input.longitude,
        };
      }

      return data;
    } catch (error) {
      throw this.toGoogleApiException(error, 'create calendar event');
    }
  }

  async syncScheduleToGoogleCalendar(
    userId: string,
    schedule: Pick<
      Schedule,
      | 'id'
      | 'summary'
      | 'description'
      | 'location'
      | 'startDateTime'
      | 'endDateTime'
      | 'googleCalendarEventId'
    >,
  ) {
    try {
      if (schedule.googleCalendarEventId) {
        await this.patchEvent(userId, schedule.googleCalendarEventId, {
          summary: schedule.summary,
          description: schedule.description,
          location: schedule.location,
          start: { dateTime: schedule.startDateTime.toISOString() },
          end: { dateTime: schedule.endDateTime.toISOString() },
        });

        return {
          synced: true as const,
          googleCalendarEventId: schedule.googleCalendarEventId,
        };
      }

      const event = await this.createEvent(
        userId,
        {
          summary: schedule.summary,
          description: schedule.description ?? undefined,
          location: schedule.location ?? undefined,
          startDateTime: schedule.startDateTime.toISOString(),
          endDateTime: schedule.endDateTime.toISOString(),
        },
        { mirrorToSchedule: false },
      );

      await this.prisma.schedule.update({
        where: { id: schedule.id },
        data: { googleCalendarEventId: event.id ?? null },
      });

      return {
        synced: true as const,
        googleCalendarEventId: event.id ?? null,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return {
          synced: false as const,
          googleCalendarEventId: schedule.googleCalendarEventId,
        };
      }

      console.error(
        '[GoogleCalendar] failed to sync schedule to Google Calendar:',
        this.describeGoogleError(error),
      );

      return {
        synced: false as const,
        googleCalendarEventId: schedule.googleCalendarEventId,
        error: String(error),
      };
    }
  }

  async deleteScheduleFromGoogleCalendar(
    userId: string,
    schedule: Pick<Schedule, 'id' | 'googleCalendarEventId'>,
  ) {
    if (!schedule.googleCalendarEventId) {
      return { synced: false as const };
    }

    try {
      const calendar = await this.getCalendarClient(userId);
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: schedule.googleCalendarEventId,
      });

      await this.prisma.schedule
        .update({
          where: { id: schedule.id },
          data: { googleCalendarEventId: null },
        })
        .catch(() => undefined);

      return { synced: true as const };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { synced: false as const };
      }

      const status = (error as { response?: { status?: number } })?.response
        ?.status;

      if (status === 404) {
        await this.prisma.schedule
          .update({
            where: { id: schedule.id },
            data: { googleCalendarEventId: null },
          })
          .catch(() => undefined);

        return { synced: true as const };
      }

      console.error(
        '[GoogleCalendar] failed to delete schedule from Google Calendar:',
        this.describeGoogleError(error),
      );

      return {
        synced: false as const,
        error: String(error),
      };
    }
  }

  // update penuh dari sheet Edit (judul, lokasi, catatan, waktu sekaligus)
  async updateEvent(userId: string, eventId: string, input: CreateEventDto) {
    const start = new Date(input.startDateTime);
    const end = new Date(input.endDateTime);

    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('Event must end after it starts.');
    }

    const calendar = await this.getCalendarClient(userId);

    try {
      const { data } = await calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody: {
          summary: input.summary,
          // null = kosongin field-nya di Google, undefined bakal dibiarin
          location: input.location ?? null,
          description: input.description ?? null,
          start: { dateTime: start.toISOString(), timeZone: input.timeZone },
          end: { dateTime: end.toISOString(), timeZone: input.timeZone },
          recurrence: input.recurrence?.length ? input.recurrence : undefined,
          reminders: toReminders(input.reminderMinutesBefore),
        },
      });

      // sama kayak createEvent: seed koordinat pilihan ke geocode cache
      if (
        input.location &&
        input.latitude !== undefined &&
        input.longitude !== undefined
      ) {
        await this.geocoding.cachePlace(input.location, {
          latitude: input.latitude,
          longitude: input.longitude,
          label: input.location,
        });

        return {
          ...data,
          latitude: input.latitude,
          longitude: input.longitude,
        };
      }

      return data;
    } catch (error) {
      throw this.toGoogleApiException(error, 'update calendar event');
    }
  }

  // "Move this meeting"
  async rescheduleEvent(
    userId: string,
    eventId: string,
    startDateTime: string,
    endDateTime: string,
  ) {
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid start or end time.');
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('Event must end after it starts.');
    }

    return this.patchEvent(userId, eventId, {
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    });
  }

  async patchEvent(
    userId: string,
    eventId: string,
    patch: calendar_v3.Schema$Event,
  ) {
    const calendar = await this.getCalendarClient(userId);
    const { data } = await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: patch,
    });
    await this.syncScheduleFromPatch(userId, eventId, patch);

    return data;
  }

  private async syncScheduleFromPatch(
    userId: string,
    eventId: string,
    patch: calendar_v3.Schema$Event,
  ) {
    const data: {
      summary?: string;
      location?: string | null;
      description?: string | null;
      startDateTime?: Date;
      endDateTime?: Date;
      reminderSentAt?: Date | null;
    } = {};

    if (typeof patch.summary === 'string') data.summary = patch.summary;
    if (patch.location !== undefined) data.location = patch.location ?? null;
    if (patch.description !== undefined) {
      data.description = patch.description ?? null;
    }

    const startIso = patch.start?.dateTime;
    if (startIso) {
      data.startDateTime = new Date(startIso);
      data.reminderSentAt = null;
    }
    const endIso = patch.end?.dateTime;
    if (endIso) data.endDateTime = new Date(endIso);

    if (Object.keys(data).length === 0) return;

    try {
      await this.prisma.schedule.updateMany({
        where: { userId, googleCalendarEventId: eventId },
        data,
      });
    } catch (error) {
      console.error('[GoogleCalendar] failed to sync linked schedule:', error);
    }
  }

  // "Push everything later"
  async pushEventsLater(
    userId: string,
    fromDateTime: string,
    toDateTime: string,
    delayMinutes: number,
  ) {
    const delayMs = delayMinutes * 60_000;
    const events = await this.listEvents(userId, fromDateTime, toDateTime);

    let shifted = 0;
    for (const event of events) {
      const startIso = event.start?.dateTime;
      const endIso = event.end?.dateTime;
      if (!event.id || !startIso || !endIso) {
        continue;
      }

      const newStart = new Date(new Date(startIso).getTime() + delayMs);
      const newEnd = new Date(new Date(endIso).getTime() + delayMs);

      await this.patchEvent(userId, event.id, {
        start: { dateTime: newStart.toISOString() },
        end: { dateTime: newEnd.toISOString() },
      });
      shifted += 1;
    }

    return { shifted, delayMinutes };
  }

  async deleteEvent(userId: string, eventId: string) {
    const calendar = await this.getCalendarClient(userId);
    await calendar.events.delete({ calendarId: 'primary', eventId });

    try {
      await this.prisma.schedule.updateMany({
        where: { userId, googleCalendarEventId: eventId },
        data: { isDeleted: true },
      });
    } catch (error) {
      console.error(
        '[GoogleCalendar] failed to soft-delete linked schedule:',
        error,
      );
    }
  }

  private toStatus(account: { scope: string; updatedAt: Date }) {
    return {
      connected: true as const,
      scope: account.scope,
      connectedAt: account.updatedAt,
    };
  }

  private toGoogleApiException(error: unknown, action: string) {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    const detail = this.describeGoogleError(error);

    // 401 = token mati, reconnect bakal nolong
    if (status === 401) {
      return new UnauthorizedException(
        `Google Calendar access expired, reconnect required: ${detail}`,
      );
    }

    // 403 bisa scope kurang, api belum di-enable, ato kena quota. reconnect belum tentu nolong
    if (status === 403) {
      return new ForbiddenException(`Google denied the request: ${detail}`);
    }

    return new BadGatewayException(`Google failed to ${action}: ${detail}`);
  }

  // googleapis error
  private describeGoogleError(error: unknown): string {
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    const reason = (data as { error?: unknown })?.error;

    // oauth endpoint balikin string, calendar api balikin { code, message }
    if (typeof reason === 'string') {
      return reason;
    }
    const message = (reason as { message?: string })?.message;
    if (message) {
      return message;
    }

    return error instanceof Error ? error.message : 'unknown error';
  }
}
