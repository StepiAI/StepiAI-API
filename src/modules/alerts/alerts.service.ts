import { Injectable, Logger } from '@nestjs/common';
import { WeatherService, HourlyWeather } from '../weather/weather.service';
import { RoutingService } from '../routing/routing.service';
import { onTimeProbability, recommendDeparture } from './on-time';

// ambang buat munculin warning macet
const TRAFFIC_DELAY_ALERT_SEC = 5 * 60;
const PUSH_DELAY_SEC = 15 * 60;
const WET_PROBABILITY_THRESHOLD = 40;
const LOOKAHEAD_WINDOW_MS = 7 * 24 * 3_600_000;

const DEFAULT_TIME_ZONE = 'Asia/Jakarta';

export type ScheduleAlertType = 'HEAVY_TRAFFIC' | 'WEATHER_RAIN';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertOrigin {
  latitude: number;
  longitude: number;
}

export interface AlertEventInput {
  id: string;
  summary: string;
  location?: string | null;
  startDateTime: string;
  endDateTime: string;
}

export interface ScheduleAlert {
  eventId: string;
  summary: string;
  eventStart: string;
  eventEnd: string;
  type: ScheduleAlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  traffic?: {
    recommendedDeparture: string;
    naiveDeparture: string;
    onTimeBefore: number;
    onTimeAfter: number;
    pushOnTime: number;
    pushDelayMinutes: number;
    travelMinutes: number;
    trafficDelayMinutes: number;
  };
  weather?: {
    condition: string;
    category: string;
    precipitationProbability: number | null;
    wetDuringCommute: boolean;
  };
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly weatherService: WeatherService,
    private readonly routingService: RoutingService,
  ) {}

  async analyze(
    origin: AlertOrigin,
    events: AlertEventInput[],
    now: Date = new Date(),
    timeZone: string = DEFAULT_TIME_ZONE,
  ): Promise<ScheduleAlert[]> {
    const upcoming = events.filter((event) => {
      const start = new Date(event.startDateTime).getTime();
      return (
        Number.isFinite(start) &&
        start > now.getTime() &&
        start - now.getTime() <= LOOKAHEAD_WINDOW_MS &&
        !!event.location?.trim()
      );
    });

    const perEvent = await Promise.all(
      upcoming.map((event) => this.analyzeEvent(origin, event, timeZone)),
    );

    const severityRank: Record<AlertSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return perEvent
      .flat()
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }

  private async analyzeEvent(
    origin: AlertOrigin,
    event: AlertEventInput,
    timeZone: string,
  ): Promise<ScheduleAlert[]> {
    const start = new Date(event.startDateTime);
    const end = new Date(event.endDateTime);

    let forecast: Awaited<
      ReturnType<WeatherService['getForecastForEvent']>
    > = null;
    try {
      forecast = await this.weatherService.getForecastForEvent({
        location: event.location as string,
        startDateTime: start,
        endDateTime: end,
      });
    } catch (error) {
      this.logger.warn(
        `Cuaca gagal buat "${event.summary}": ${this.describe(error)}`,
      );
    }

    if (!forecast) {
      return [];
    }

    const alerts: ScheduleAlert[] = [];

    const trafficAlert = await this.buildTrafficAlert(
      origin,
      forecast.resolvedLocation,
      event,
      start,
      timeZone,
    );
    if (trafficAlert) {
      alerts.push(trafficAlert);
    }

    const weatherAlert = this.buildWeatherAlert(
      event,
      forecast.weatherAtStart,
      forecast.lookahead,
      start,
    );
    if (weatherAlert) {
      alerts.push(weatherAlert);
    }

    return alerts;
  }

  private async buildTrafficAlert(
    origin: AlertOrigin,
    dest: { latitude: number; longitude: number },
    event: AlertEventInput,
    start: Date,
    timeZone: string,
  ): Promise<ScheduleAlert | null> {
    let estimate;
    try {
      estimate = await this.routingService.estimate(origin, dest, start);
    } catch (error) {
      this.logger.warn(
        `Routing gagal buat "${event.summary}" (origin ${origin.latitude},${origin.longitude} → dest ${dest.latitude},${dest.longitude}): ${this.describe(error)}`,
      );
      return null;
    }

    const rec = recommendDeparture({
      eventStartMs: start.getTime(),
      travelSeconds: estimate.travelSeconds,
      noTrafficSeconds: estimate.noTrafficSeconds,
    });

    // cuma munculin kartu kalau macet prediksi beneran berarti (>= 5 menit).
    // di luar itu (mis. jam sepi) nggak usah ganggu.
    if (rec.trafficDelaySeconds < TRAFFIC_DELAY_ALERT_SEC) {
      return null;
    }

    const severity: AlertSeverity =
      rec.onTimeBefore < 0.4
        ? 'critical'
        : rec.onTimeBefore < 0.7
          ? 'warning'
          : 'info';

    const before = this.formatClock(rec.naiveDepartureMs, timeZone);
    const after = this.formatClock(rec.recommendedDepartureMs, timeZone);
    const pctBefore = Math.round(rec.onTimeBefore * 100);
    const pctAfter = Math.round(rec.onTimeAfter * 100);

    const pushOnTime = onTimeProbability(
      PUSH_DELAY_SEC - rec.trafficDelaySeconds,
      rec.spreadSeconds,
    );

    return {
      eventId: event.id,
      summary: event.summary,
      eventStart: event.startDateTime,
      eventEnd: event.endDateTime,
      type: 'HEAVY_TRAFFIC',
      severity,
      title: 'Heavy traffic detected',
      body: `Leaving at ${after} instead of ${before} increases your on-time probability from ${pctBefore}% to ${pctAfter}%.`,
      traffic: {
        recommendedDeparture: new Date(rec.recommendedDepartureMs).toISOString(),
        naiveDeparture: new Date(rec.naiveDepartureMs).toISOString(),
        onTimeBefore: rec.onTimeBefore,
        onTimeAfter: rec.onTimeAfter,
        pushOnTime,
        pushDelayMinutes: PUSH_DELAY_SEC / 60,
        travelMinutes: Math.round(estimate.travelSeconds / 60),
        trafficDelayMinutes: Math.round(rec.trafficDelaySeconds / 60),
      },
    };
  }

  private buildWeatherAlert(
    event: AlertEventInput,
    weatherAtStart: HourlyWeather | null,
    lookahead: HourlyWeather[],
    start: Date,
  ): ScheduleAlert | null {
    const startMs = start.getTime();
    const wetBefore = lookahead.filter(
      (hour) =>
        new Date(hour.time).getTime() < startMs && this.isWetEnough(hour),
    );
    const wetAtStart = weatherAtStart ? this.isWetEnough(weatherAtStart) : false;

    if (!wetAtStart && wetBefore.length === 0) {
      return null;
    }

    const drivingCondition = wetBefore[0] ?? weatherAtStart;
    const category = drivingCondition?.category ?? 'rain';
    const severity: AlertSeverity =
      category === 'thunderstorm'
        ? 'critical'
        : category === 'drizzle'
          ? 'info'
          : 'warning';

    const body =
      wetBefore.length > 0
        ? `${wetBefore[0].condition} di perjalanan kamu — berangkat lebih awal atau bawa payung.`
        : `${weatherAtStart?.condition ?? 'Hujan'} pas jam acara kamu.`;

    return {
      eventId: event.id,
      summary: event.summary,
      eventStart: event.startDateTime,
      eventEnd: event.endDateTime,
      type: 'WEATHER_RAIN',
      severity,
      title: 'Rain expected',
      body,
      weather: {
        condition: drivingCondition?.condition ?? 'Hujan',
        category,
        precipitationProbability:
          drivingCondition?.precipitationProbability ?? null,
        wetDuringCommute: wetBefore.length > 0,
      },
    };
  }

  private isWetEnough(hour: HourlyWeather): boolean {
    return (
      hour.isWet ||
      (hour.precipitationProbability ?? 0) >= WET_PROBABILITY_THRESHOLD
    );
  }

  private formatClock(ms: number, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ms));
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
