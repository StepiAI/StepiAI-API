import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeocodingService, ResolvedLocation } from './geocoding.service';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOUR_MS = 3_600_000;

const MAX_FORECAST_DAYS = 16;
const LOOKAHEAD_HOURS_BEFORE = 3;

export type WeatherCategory =
  | 'clear'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunderstorm'
  | 'unknown';

export interface HourlyWeather {
  time: string;
  temperature: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  weatherCode: number | null;
  category: WeatherCategory;
  condition: string;
  isWet: boolean;
}

interface OpenMeteoForecastResponse {
  error?: boolean;
  reason?: string;
  hourly?: {
    time?: number[];
    temperature_2m?: (number | null)[];
    precipitation_probability?: (number | null)[];
    precipitation?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

const WMO_CODES: Record<number, { category: WeatherCategory; label: string }> =
  {
    0: { category: 'clear', label: 'Cerah' },
    1: { category: 'clear', label: 'Cerah berawan' },
    2: { category: 'cloudy', label: 'Berawan sebagian' },
    3: { category: 'cloudy', label: 'Berawan' },
    45: { category: 'fog', label: 'Berkabut' },
    48: { category: 'fog', label: 'Kabut beku' },
    51: { category: 'drizzle', label: 'Gerimis ringan' },
    53: { category: 'drizzle', label: 'Gerimis' },
    55: { category: 'drizzle', label: 'Gerimis lebat' },
    56: { category: 'drizzle', label: 'Gerimis beku ringan' },
    57: { category: 'drizzle', label: 'Gerimis beku' },
    61: { category: 'rain', label: 'Hujan ringan' },
    63: { category: 'rain', label: 'Hujan' },
    65: { category: 'rain', label: 'Hujan lebat' },
    66: { category: 'rain', label: 'Hujan beku ringan' },
    67: { category: 'rain', label: 'Hujan beku' },
    71: { category: 'snow', label: 'Salju ringan' },
    73: { category: 'snow', label: 'Salju' },
    75: { category: 'snow', label: 'Salju lebat' },
    77: { category: 'snow', label: 'Butiran salju' },
    80: { category: 'rain', label: 'Hujan lokal ringan' },
    81: { category: 'rain', label: 'Hujan lokal' },
    82: { category: 'rain', label: 'Hujan lokal deras' },
    85: { category: 'snow', label: 'Hujan salju ringan' },
    86: { category: 'snow', label: 'Hujan salju lebat' },
    95: { category: 'thunderstorm', label: 'Badai petir' },
    96: { category: 'thunderstorm', label: 'Badai petir disertai hujan es' },
    99: { category: 'thunderstorm', label: 'Badai petir hujan es lebat' },
  };

const WET_CATEGORIES: ReadonlySet<WeatherCategory> = new Set([
  'drizzle',
  'rain',
  'snow',
  'thunderstorm',
]);

const NON_PHYSICAL_LOCATIONS: ReadonlySet<string> = new Set([
  'online',
  'daring',
  'zoom',
  'google meet',
  'gmeet',
]);

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(
    private readonly geocoding: GeocodingService,
    private readonly prisma: PrismaService,
  ) {}

  async getHourlyForecast(
    latitude: number,
    longitude: number,
    from: Date,
    to: Date,
  ): Promise<HourlyWeather[]> {
    const forecastDays = this.forecastDaysNeeded(to);
    if (forecastDays === null) {
      return [];
    }

    const url = new URL(OPEN_METEO_FORECAST_URL);
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set(
      'hourly',
      'temperature_2m,precipitation_probability,precipitation,weather_code',
    );
    url.searchParams.set('timeformat', 'unixtime');
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('forecast_days', forecastDays.toString());

    let body: OpenMeteoForecastResponse;
    try {
      const response = await fetch(url);
      body = (await response.json()) as OpenMeteoForecastResponse;
      if (!response.ok || body.error) {
        throw new Error(body.reason ?? `HTTP ${response.status}`);
      }
    } catch (error) {
      throw new BadGatewayException(
        `Gagal ambil ramalan cuaca: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const hourly = body.hourly;
    const times = hourly?.time ?? [];

    const fromMs = this.floorToHour(from).getTime();
    const toMs = to.getTime();

    return times
      .map((epochSeconds, index) => ({ epochSeconds, index }))
      .filter(({ epochSeconds }) => {
        const ms = epochSeconds * 1000;
        return ms >= fromMs && ms <= toMs;
      })
      .map(({ epochSeconds, index }) =>
        this.toHourlyWeather(epochSeconds, index, hourly),
      );
  }

  async getForecastAt(
    latitude: number,
    longitude: number,
    at: Date,
  ): Promise<HourlyWeather | null> {
    const hour = this.floorToHour(at);
    const [forecast] = await this.getHourlyForecast(
      latitude,
      longitude,
      hour,
      hour,
    );
    return forecast ?? null;
  }

  async getForecastForEvent(input: {
    location: string;
    startDateTime: Date;
    endDateTime?: Date;
  }): Promise<{
    resolvedLocation: ResolvedLocation;
    weatherAtStart: HourlyWeather | null;
    lookahead: HourlyWeather[];
  } | null> {
    const resolvedLocation = await this.geocoding.resolve(input.location);
    if (!resolvedLocation) {
      return null;
    }

    const { latitude, longitude } = resolvedLocation;
    const start = input.startDateTime;
    const end = input.endDateTime ?? start;

    const windowStart = new Date(
      start.getTime() - LOOKAHEAD_HOURS_BEFORE * HOUR_MS,
    );

    // Lokasi udah ketemu koordinatnya di atas — jangan biarin fetch cuaca yg
    // gagal (mis. kuota provider abis) ikut nggugurin resolvedLocation.
    // Traffic alert butuh koordinatnya doang, gak butuh data cuaca.
    let lookahead: HourlyWeather[] = [];
    try {
      lookahead = await this.getHourlyForecast(
        latitude,
        longitude,
        windowStart,
        end,
      );
    } catch (error) {
      this.logger.warn(
        `Forecast gagal buat "${input.location}", lanjut tanpa data cuaca: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const startHourMs = this.floorToHour(start).getTime();
    const weatherAtStart =
      lookahead.find((hour) => new Date(hour.time).getTime() === startHourMs) ??
      null;

    return { resolvedLocation, weatherAtStart, lookahead };
  }

  async getForecastForSchedule(userId: string, scheduleId: string) {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id: scheduleId, userId, isDeleted: false },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    const base = {
      scheduleId: schedule.id,
      summary: schedule.summary,
      location: schedule.location,
      startDateTime: schedule.startDateTime,
      endDateTime: schedule.endDateTime,
    };

    const unavailable = (reason: string, extra: object = {}) => ({
      ...base,
      ...extra,
      available: false as const,
      reason,
    });

    if (!schedule.location) {
      return unavailable('Schedule ini belum punya lokasi.');
    }

    if (NON_PHYSICAL_LOCATIONS.has(schedule.location.trim().toLowerCase())) {
      return unavailable('Acara online, cuaca gak relevan.');
    }

    const forecast = await this.getForecastForEvent({
      location: schedule.location,
      startDateTime: schedule.startDateTime,
      endDateTime: schedule.endDateTime,
    });

    if (!forecast) {
      return unavailable(
        `Lokasi "${schedule.location}" tidak ketemu koordinatnya.`,
      );
    }

    if (!forecast.weatherAtStart && forecast.lookahead.length === 0) {
      return unavailable('Di luar jangkauan ramalan (maksimal 16 hari).', {
        resolvedLocation: forecast.resolvedLocation,
      });
    }

    return {
      ...base,
      available: true as const,
      resolvedLocation: forecast.resolvedLocation,
      weatherAtStart: forecast.weatherAtStart,
      lookahead: forecast.lookahead,
    };
  }

  private toHourlyWeather(
    epochSeconds: number,
    index: number,
    hourly: OpenMeteoForecastResponse['hourly'],
  ): HourlyWeather {
    const weatherCode = hourly?.weather_code?.[index] ?? null;
    const mapped = weatherCode === null ? undefined : WMO_CODES[weatherCode];
    const category = mapped?.category ?? 'unknown';

    return {
      time: new Date(epochSeconds * 1000).toISOString(),
      temperature: hourly?.temperature_2m?.[index] ?? null,
      precipitationProbability:
        hourly?.precipitation_probability?.[index] ?? null,
      precipitation: hourly?.precipitation?.[index] ?? null,
      weatherCode,
      category,
      condition: mapped?.label ?? 'Tidak diketahui',
      isWet: WET_CATEGORIES.has(category),
    };
  }

  private forecastDaysNeeded(to: Date): number | null {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const days = Math.ceil(
      (to.getTime() - startOfToday.getTime()) / (24 * HOUR_MS),
    );

    if (days > MAX_FORECAST_DAYS) {
      return null;
    }

    return Math.min(Math.max(days, 1), MAX_FORECAST_DAYS);
  }

  private floorToHour(date: Date): Date {
    const floored = new Date(date);
    floored.setUTCMinutes(0, 0, 0);
    return floored;
  }
}
