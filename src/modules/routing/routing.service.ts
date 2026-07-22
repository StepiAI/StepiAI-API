import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

const TOMTOM_ROUTE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';

const CACHE_TTL_MS = 5 * 60_000;
const DEPART_BUCKET_MS = 5 * 60_000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface TravelEstimate {
  distanceMeters: number;
  travelSeconds: number;
  noTrafficSeconds: number;
  trafficDelaySeconds: number;
  departAt: Date;
  arriveAt: Date;
}

interface TomTomSummary {
  lengthInMeters?: number;
  travelTimeInSeconds?: number;
  trafficDelayInSeconds?: number;
  noTrafficTravelTimeInSeconds?: number;
  departureTime?: string;
  arrivalTime?: string;
}

interface TomTomRouteResponse {
  routes?: { summary?: TomTomSummary }[];
  detailedError?: { message?: string };
  error?: { description?: string };
}

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly cache = new Map<
    string,
    { value: TravelEstimate; expiresAt: number }
  >();

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async estimate(
    origin: Coordinates,
    destination: Coordinates,
    departAt?: Date,
  ): Promise<TravelEstimate> {
    const apiKey = this.configService.get('routing', { infer: true })
      .tomTomApiKey;

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Routing is not configured. Set TOMTOM_API_KEY before requesting travel times.',
      );
    }

    const cacheKey = this.cacheKey(origin, destination, departAt);
    const cached = this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    const summary = await this.fetchSummary(origin, destination, departAt, apiKey);
    const estimate = this.toEstimate(summary);

    this.writeCache(cacheKey, estimate);
    return estimate;
  }

  private async fetchSummary(
    origin: Coordinates,
    destination: Coordinates,
    departAt: Date | undefined,
    apiKey: string,
  ): Promise<TomTomSummary> {
    const path = `${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}`;
    const url = new URL(`${TOMTOM_ROUTE_URL}/${path}/json`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('travelMode', 'car');
    url.searchParams.set('traffic', 'true');
    url.searchParams.set('computeTravelTimeFor', 'all');

    if (departAt && departAt.getTime() > Date.now()) {
      url.searchParams.set('departAt', departAt.toISOString());
    }

    let body: TomTomRouteResponse;
    try {
      const response = await fetch(url);
      body = (await response.json()) as TomTomRouteResponse;
      if (!response.ok) {
        const reason =
          body.detailedError?.message ??
          body.error?.description ??
          `HTTP ${response.status}`;
        throw new Error(reason);
      }
    } catch (error) {
      throw new BadGatewayException(
        `Gagal ambil estimasi perjalanan: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const summary = body.routes?.[0]?.summary;
    if (!summary || summary.travelTimeInSeconds === undefined) {
      throw new BadGatewayException('Rute tidak ditemukan untuk lokasi itu.');
    }

    return summary;
  }

  private toEstimate(summary: TomTomSummary): TravelEstimate {
    const travelSeconds = summary.travelTimeInSeconds ?? 0;
    const noTrafficSeconds =
      summary.noTrafficTravelTimeInSeconds ??
      travelSeconds - (summary.trafficDelayInSeconds ?? 0);
    const trafficDelaySeconds = Math.max(travelSeconds - noTrafficSeconds, 0);

    const departAt = summary.departureTime
      ? new Date(summary.departureTime)
      : new Date();
    const arriveAt = summary.arrivalTime
      ? new Date(summary.arrivalTime)
      : new Date(departAt.getTime() + travelSeconds * 1000);

    return {
      distanceMeters: summary.lengthInMeters ?? 0,
      travelSeconds,
      noTrafficSeconds,
      trafficDelaySeconds,
      departAt,
      arriveAt,
    };
  }

  private cacheKey(
    origin: Coordinates,
    destination: Coordinates,
    departAt?: Date,
  ): string {
    const round = (n: number) => n.toFixed(4);
    const bucket = departAt
      ? Math.round(departAt.getTime() / DEPART_BUCKET_MS)
      : 'now';
    return [
      round(origin.latitude),
      round(origin.longitude),
      round(destination.latitude),
      round(destination.longitude),
      bucket,
    ].join('|');
  }

  private readCache(key: string): TravelEstimate | null {
    const hit = this.cache.get(key);
    if (!hit) {
      return null;
    }
    if (hit.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  private writeCache(key: string, value: TravelEstimate): void {
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}
