import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { GeocodingService } from './geocoding.service';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

@Module({
  imports: [AuthModule],
  controllers: [WeatherController],
  providers: [WeatherService, GeocodingService],
  exports: [WeatherService, GeocodingService],
})
export class WeatherModule {}
