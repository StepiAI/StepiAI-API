import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { AlertsService } from './alerts.service';
import { AnalyzeAlertsDto } from './dto/analyze-alerts.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post('analyze')
  analyze(@Body() dto: AnalyzeAlertsDto) {
    return this.alertsService.analyze(
      dto.origin,
      dto.events,
      new Date(),
      dto.timezone,
    );
  }
}
