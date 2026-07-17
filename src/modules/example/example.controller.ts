import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/request-with-user.interface';
import { ExampleService } from './example.service';
import { CreateExampleDto } from './dto/create-example.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('examples')
export class ExampleController {
  constructor(private readonly exampleService: ExampleService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.exampleService.findAllForUser(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExampleDto,
  ) {
    return this.exampleService.create(user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.exampleService.remove(user.id, id);
  }
}
