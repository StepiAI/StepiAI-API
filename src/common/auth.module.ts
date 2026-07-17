import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';

@Module({
  imports: [PassportModule],
  providers: [SupabaseJwtStrategy],
  exports: [PassportModule],
})
export class AuthModule {}
