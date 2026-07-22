import { BadGatewayException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeocodingService } from './geocoding.service';
import { WeatherService } from './weather.service';

const HOUR_MS = 3_600_000;

function fakeForecast(
  startHour: Date,
  hours: { code: number; pop: number; temp?: number }[],
) {
  const base = Math.floor(startHour.getTime() / 1000);
  return {
    hourly: {
      time: hours.map((_, i) => base + i * 3600),
      temperature_2m: hours.map((h) => h.temp ?? 27),
      precipitation_probability: hours.map((h) => h.pop),
      precipitation: hours.map((h) => (h.pop > 50 ? 1.2 : 0)),
      weather_code: hours.map((h) => h.code),
    },
  };
}

function mockFetchOnce(payload: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(payload),
  });
}

describe('WeatherService', () => {
  const geocoding = {
    resolve: jest.fn(),
  } as unknown as jest.Mocked<GeocodingService>;
  const prisma = {
    schedule: { findFirst: jest.fn() },
  } as unknown as PrismaService;
  let service: WeatherService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new WeatherService(geocoding, prisma);
  });

  it('maps WMO codes to a readable condition and flags wet hours', async () => {
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    mockFetchOnce(
      fakeForecast(start, [
        { code: 0, pop: 0 },
        { code: 61, pop: 80 },
        { code: 95, pop: 90 },
      ]),
    );

    const hourly = await service.getHourlyForecast(
      -6.2,
      106.8,
      start,
      new Date(start.getTime() + 2 * HOUR_MS),
    );

    expect(hourly).toHaveLength(3);
    expect(hourly[0]).toMatchObject({
      condition: 'Cerah',
      category: 'clear',
      isWet: false,
    });
    expect(hourly[1]).toMatchObject({
      condition: 'Hujan ringan',
      category: 'rain',
      isWet: true,
      precipitationProbability: 80,
    });
    expect(hourly[2]).toMatchObject({ category: 'thunderstorm', isWet: true });
  });

  it('keeps only the hours inside the requested window', async () => {
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    mockFetchOnce(
      fakeForecast(
        start,
        Array.from({ length: 6 }, () => ({ code: 0, pop: 0 })),
      ),
    );

    const hourly = await service.getHourlyForecast(
      -6.2,
      106.8,
      new Date(start.getTime() + 2 * HOUR_MS),
      new Date(start.getTime() + 4 * HOUR_MS),
    );

    expect(hourly.map((h) => h.time)).toEqual([
      new Date(start.getTime() + 2 * HOUR_MS).toISOString(),
      new Date(start.getTime() + 3 * HOUR_MS).toISOString(),
      new Date(start.getTime() + 4 * HOUR_MS).toISOString(),
    ]);
  });

  it('picks the hour bucket containing the event and includes the hours before it', async () => {
    const eventStart = new Date();
    eventStart.setUTCHours(eventStart.getUTCHours() + 5, 0, 0, 0);
    const windowStart = new Date(eventStart.getTime() - 3 * HOUR_MS);

    geocoding.resolve.mockResolvedValue({
      latitude: -6.2,
      longitude: 106.8,
      label: 'Jakarta',
      provider: 'open-meteo',
    });
    mockFetchOnce(
      fakeForecast(windowStart, [
        { code: 0, pop: 0 }, // -3 jam
        { code: 3, pop: 20 }, // -2 jam
        { code: 61, pop: 85 }, // -1 jam 
        { code: 3, pop: 30 }, // jam acara
      ]),
    );

    const result = await service.getForecastForEvent({
      location: 'Jakarta',
      startDateTime: eventStart,
      endDateTime: eventStart,
    });

    expect(result).not.toBeNull();
    expect(result!.weatherAtStart?.time).toBe(eventStart.toISOString());
    expect(result!.lookahead).toHaveLength(4);

    const rainBefore = result!.lookahead.filter((h) => h.isWet);
    expect(rainBefore).toHaveLength(1);
    expect(rainBefore[0].time).toBe(
      new Date(eventStart.getTime() - HOUR_MS).toISOString(),
    );
  });

  it('returns null when the location cannot be geocoded', async () => {
    geocoding.resolve.mockResolvedValue(null);

    await expect(
      service.getForecastForEvent({
        location: 'lokasi ngawur',
        startDateTime: new Date(),
      }),
    ).resolves.toBeNull();
  });

  it('returns nothing for events beyond the 16-day forecast horizon', async () => {
    global.fetch = jest.fn();
    const farFuture = new Date(Date.now() + 40 * 24 * HOUR_MS);

    const hourly = await service.getHourlyForecast(
      -6.2,
      106.8,
      farFuture,
      farFuture,
    );

    expect(hourly).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces upstream failures as a bad gateway', async () => {
    mockFetchOnce({ error: true, reason: 'invalid latitude' }, false);

    await expect(
      service.getHourlyForecast(999, 106.8, new Date(), new Date()),
    ).rejects.toThrow(BadGatewayException);
  });
});
