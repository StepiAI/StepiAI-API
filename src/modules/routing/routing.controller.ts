import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { EstimateQueryDto } from './dto/estimate-query.dto';
import { RoutingService } from './routing.service';

@UseGuards(SupabaseAuthGuard)
@Controller('routing')
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  @Get('estimate')
  estimate(@Query() query: EstimateQueryDto) {
    return this.routingService.estimate(
      { latitude: query.fromLat, longitude: query.fromLng },
      { latitude: query.toLat, longitude: query.toLng },
      query.departAt ? new Date(query.departAt) : undefined,
    );
  }
}
