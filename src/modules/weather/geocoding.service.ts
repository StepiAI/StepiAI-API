import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  label: string | null;
  provider: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const PHOTON_URL = 'https://photon.komoot.io/api/';

const BIAS_LAT = -6.2088;
const BIAS_LON = 106.8456;

const NOMINATIM_USER_AGENT = 'StepiAI/1.0 (hackathon project)';
const NOMINATIM_MIN_INTERVAL_MS = 1100;

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
}

export interface PlaceSuggestion {
  name: string;
  context: string | null;
  latitude: number;
  longitude: number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface OpenMeteoGeocodeResponse {
  results?: {
    name?: string;
    admin1?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }[];
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private nominatimQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(location: string): Promise<ResolvedLocation | null> {
    const query = this.normalize(location);
    if (!query) {
      return null;
    }

    const cached = await this.prisma.geocodeCache.findUnique({
      where: { query },
    });
    if (cached) {
      return {
        latitude: cached.latitude,
        longitude: cached.longitude,
        label: cached.label,
        provider: cached.provider,
      };
    }

    const resolved =
      (await this.geocodeWithNominatim(location)) ??
      (await this.geocodeWithOpenMeteo(location));

    if (!resolved) {
      return null;
    }

    await this.prisma.geocodeCache
      .create({ data: { query, ...resolved } })
      .catch(() => undefined);

    return resolved;
  }

  private normalize(location: string): string {
    return location.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // simpen koordinat yg user pilih sendiri ke cache (di-key sama teks lokasi).
  // dipake pas bikin event: user udah milih tempat pasti, jd gak perlu geocode ulang.
  async cachePlace(
    location: string,
    coords: { latitude: number; longitude: number; label?: string | null },
  ): Promise<void> {
    const query = this.normalize(location);
    if (!query) {
      return;
    }

    const data = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      label: coords.label ?? null,
      provider: 'user-pick',
    };

    await this.prisma.geocodeCache
      .upsert({ where: { query }, create: { query, ...data }, update: data })
      .catch(() => undefined);
  }

  // gw lookup cache-only buat banyak lokasi sekaligus
  async lookupCachedMany(
    locations: string[],
  ): Promise<Map<string, ResolvedLocation>> {
    const byOriginal = new Map<string, ResolvedLocation>();
    const originalsByQuery = new Map<string, string[]>();

    for (const location of locations) {
      const query = this.normalize(location);
      if (!query) {
        continue;
      }
      const originals = originalsByQuery.get(query) ?? [];
      originals.push(location);
      originalsByQuery.set(query, originals);
    }

    if (originalsByQuery.size === 0) {
      return byOriginal;
    }

    const rows = await this.prisma.geocodeCache.findMany({
      where: { query: { in: [...originalsByQuery.keys()] } },
    });

    for (const row of rows) {
      const resolved: ResolvedLocation = {
        latitude: row.latitude,
        longitude: row.longitude,
        label: row.label,
        provider: row.provider,
      };
      for (const original of originalsByQuery.get(row.query) ?? []) {
        byOriginal.set(original, resolved);
      }
    }

    return byOriginal;
  }

  async searchPlaces(query: string, limit = 5): Promise<PlaceSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [];
    }

    const url = new URL(PHOTON_URL);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('lat', String(BIAS_LAT));
    url.searchParams.set('lon', String(BIAS_LON));

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = (await response.json()) as PhotonResponse;

      return (body.features ?? [])
        .map((feature) => this.toSuggestion(feature))
        .filter((place): place is PlaceSuggestion => place !== null);
    } catch (error) {
      this.logger.warn(
        `Photon gagal buat "${trimmed}": ${this.describe(error)}`,
      );
      return [];
    }
  }

  private toSuggestion(feature: PhotonFeature): PlaceSuggestion | null {
    const [longitude, latitude] = feature.geometry?.coordinates ?? [];
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }

    const props = feature.properties ?? {};
    const name =
      props.name ??
      [props.street, props.housenumber].filter(Boolean).join(' ') ??
      null;

    if (!name) {
      return null;
    }

    const context = [props.district, props.city, props.state, props.country]
      .filter(Boolean)
      .join(', ');

    return {
      name,
      context: context || null,
      latitude,
      longitude,
    };
  }

  private enqueueNominatim<T>(task: () => Promise<T>): Promise<T> {
    const result = this.nominatimQueue.then(task, task);
    this.nominatimQueue = result
      .then(() => new Promise((r) => setTimeout(r, NOMINATIM_MIN_INTERVAL_MS)))
      .catch(() => undefined);
    return result;
  }

  private geocodeWithNominatim(
    location: string,
  ): Promise<ResolvedLocation | null> {
    return this.enqueueNominatim(async () => {
      const url = new URL(NOMINATIM_URL);
      url.searchParams.set('q', location);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'id');

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': NOMINATIM_USER_AGENT },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const results = (await response.json()) as NominatimResult[];
        const top = results[0];
        const latitude = Number(top?.lat);
        const longitude = Number(top?.lon);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }

        return {
          latitude,
          longitude,
          label: top.display_name ?? null,
          provider: 'nominatim',
        };
      } catch (error) {
        this.logger.warn(
          `Nominatim gagal buat "${location}": ${this.describe(error)}`,
        );
        return null;
      }
    });
  }

  private async geocodeWithOpenMeteo(
    location: string,
  ): Promise<ResolvedLocation | null> {
    const url = new URL(OPEN_METEO_GEOCODE_URL);
    url.searchParams.set('name', location);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'id');
    url.searchParams.set('format', 'json');

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = (await response.json()) as OpenMeteoGeocodeResponse;
      const top = body.results?.[0];

      if (
        typeof top?.latitude !== 'number' ||
        typeof top?.longitude !== 'number'
      ) {
        return null;
      }

      const label = [top.name, top.admin1, top.country]
        .filter(Boolean)
        .join(', ');

      return {
        latitude: top.latitude,
        longitude: top.longitude,
        label: label || null,
        provider: 'open-meteo',
      };
    } catch (error) {
      this.logger.warn(
        `Open-Meteo geocoding gagal buat "${location}": ${this.describe(error)}`,
      );
      return null;
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
