import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth.module';
import { WeatherModule } from '../weather/weather.module';
import { RoutingModule } from '../routing/routing.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [AuthModule, WeatherModule, RoutingModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
