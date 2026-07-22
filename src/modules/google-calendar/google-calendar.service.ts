import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Auth, calendar_v3, google } from 'googleapis';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

@Injectable()
export class GoogleCalendarService {
  private readonly oauthClientId: string;
  private readonly oauthClientSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService<AppConfig, true>,
  ) {
    const { clientId, clientSecret } = configService.get('google', {
      infer: true,
    });

    this.oauthClientId = clientId;
    this.oauthClientSecret = clientSecret;
  }

  private createOAuthClient() {
    return new google.auth.OAuth2(
      this.oauthClientId,
      this.oauthClientSecret,
      '',
    );
  }

  async connect(userId: string, serverAuthCode: string) {
    const oauthClient = this.createOAuthClient();
    let tokens: Auth.Credentials;

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

    let credentials: Auth.Credentials;
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
    return google.calendar({ version: 'v3', auth: oauthClient });
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
      return data.items ?? [];
    } catch (error) {
      throw this.toGoogleApiException(error, 'list calendar events');
    }
  }

  async createEvent(userId: string, input: CreateEventDto) {
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
        },
      });
      return data;
    } catch (error) {
      throw this.toGoogleApiException(error, 'create calendar event');
    }
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
    return data;
  }

  async deleteEvent(userId: string, eventId: string) {
    const calendar = await this.getCalendarClient(userId);
    await calendar.events.delete({ calendarId: 'primary', eventId });
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
