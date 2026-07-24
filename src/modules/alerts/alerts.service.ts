import { Injectable, Logger } from '@nestjs/common';
import {
  WeatherService,
  HourlyWeather,
  NON_PHYSICAL_LOCATIONS,
} from '../weather/weather.service';
import { RoutingService } from '../routing/routing.service';
import { onTimeProbability, recommendDeparture } from './on-time';

// ambang buat munculin warning macet — DITURUNIN sementara dari 5 menit ke 1
// menit biar gampang ke-trigger buat demo (macet tipis dikit langsung
// ngalert). Naikin lagi ke 5*60 kalau udah lewat demo/lomba.
const TRAFFIC_DELAY_ALERT_SEC = 1 * 60;
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
    const upcomingRaw = events.filter((event) => {
      const start = new Date(event.startDateTime).getTime();
      const location = event.location?.trim() ?? '';
      return (
        Number.isFinite(start) &&
        start > now.getTime() &&
        start - now.getTime() <= LOOKAHEAD_WINDOW_MS &&
        !!location &&
        // "Online"/"Zoom"/dst bukan koordinat fisik -- kalau lolos ke geocoding,
        // dia bisa ke-resolve ke tempat random & munculin "macet" ngawur
        // (nyata terjadi: event online jam 17:00 dpt alert "berangkat jam 2 siang").
        !NON_PHYSICAL_LOCATIONS.has(location.toLowerCase())
      );
    });

    // dedupe by id -- kalender/kalendar sync kadang ngirim event yg sama 2x+
    // (mis. life plan session yg juga ke-sync ke Google). Diproses 2x = 2
    // panggilan TomTom terpisah -> hasil dikit beda -> user liat 2 warning
    // buat 1 acara yg sama. Ambil kemunculan pertama aja.
    const seenIds = new Set<string>();
    const upcoming = upcomingRaw.filter((event) => {
      if (seenIds.has(event.id)) return false;
      seenIds.add(event.id);
      return true;
    });
    if (upcoming.length !== upcomingRaw.length) {
      this.logger.warn(
        `[ALERT DEBUG] buang ${upcomingRaw.length - upcoming.length} event duplikat (id sama)`,
      );
    }

    // [ALERT DEBUG] hapus setelah beres — biar keliatan di Railway logs
    this.logger.log(
      `[ALERT DEBUG] masuk=${events.length} lolos-window=${upcoming.length} (window=${LOOKAHEAD_WINDOW_MS / 3_600_000}h)`,
    );
    for (const e of events) {
      const start = new Date(e.startDateTime).getTime();
      const inH = ((start - now.getTime()) / 3_600_000).toFixed(1);
      const passes =
        Number.isFinite(start) &&
        start > now.getTime() &&
        start - now.getTime() <= LOOKAHEAD_WINDOW_MS &&
        !!e.location?.trim();
      this.logger.log(
        `[ALERT DEBUG] "${e.summary}" start=${e.startDateTime} (${inH}h dari now) loc="${e.location ?? ''}" -> ${passes ? 'DIPROSES' : 'DIBUANG'}`,
      );
    }

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
      // [ALERT DEBUG] cuaca null bikin traffic alert ikut ke-skip
      this.logger.warn(
        `[ALERT DEBUG] "${event.summary}" forecast NULL -> semua alert di-skip`,
      );
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

    // [ALERT DEBUG] angka mentah dari TomTom + hasil hitungnya
    this.logger.log(
      `[ALERT DEBUG] "${event.summary}" travel=${estimate.travelSeconds}s noTraffic=${estimate.noTrafficSeconds}s delay=${rec.trafficDelaySeconds}s (ambang=${TRAFFIC_DELAY_ALERT_SEC}s) -> ${rec.trafficDelaySeconds < TRAFFIC_DELAY_ALERT_SEC ? 'DI BAWAH AMBANG, nggak ngalert' : 'NGALERT'}`,
    );

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
