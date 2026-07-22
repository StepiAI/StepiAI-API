import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { ReverseGeocodeQueryDto } from './dto/reverse-geocode-query.dto';
import { SearchPlacesQueryDto } from './dto/search-places-query.dto';
import { GeocodingService } from './geocoding.service';
import { WeatherService } from './weather.service';

const DEFAULT_WINDOW_HOURS = 24;

@UseGuards(SupabaseAuthGuard)
@Controller('weather')
export class WeatherController {
  constructor(
    private readonly weatherService: WeatherService,
    private readonly geocodingService: GeocodingService,
  ) {}

  @Get('places')
  searchPlaces(@Query() query: SearchPlacesQueryDto) {
    return this.geocodingService.searchPlaces(query.q, query.limit);
  }

  @Get('reverse')
  async reverseGeocode(@Query() query: ReverseGeocodeQueryDto) {
    const place = await this.geocodingService.reverseGeocode(
      query.latitude,
      query.longitude,
    );

    if (!place) {
      throw new NotFoundException('Lokasi tidak ketemu buat koordinat itu.');
    }

    return place;
  }

  @Get('forecast')
  async getForecast(@Query() query: ForecastQueryDto) {
    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to
      ? new Date(query.to)
      : new Date(from.getTime() + DEFAULT_WINDOW_HOURS * 3_600_000);

    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('`to` harus setelah `from`.');
    }

    let latitude = query.latitude;
    let longitude = query.longitude;
    let resolvedLocation = null as Awaited<
      ReturnType<GeocodingService['resolve']>
    >;

    if (latitude === undefined || longitude === undefined) {
      resolvedLocation = await this.geocodingService.resolve(
        query.location as string,
      );

      if (!resolvedLocation) {
        throw new NotFoundException(
          `Lokasi "${query.location}" tidak ketemu koordinatnya.`,
        );
      }

      ({ latitude, longitude } = resolvedLocation);
    }

    const hourly = await this.weatherService.getHourlyForecast(
      latitude,
      longitude,
      from,
      to,
    );

    return { resolvedLocation, latitude, longitude, hourly };
  }

  @Get('schedules/:scheduleId')
  getScheduleForecast(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ) {
    return this.weatherService.getForecastForSchedule(user.id, scheduleId);
  }
}
