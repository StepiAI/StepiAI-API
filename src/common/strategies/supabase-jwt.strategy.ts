import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../config/configuration';
import { AuthenticatedUser } from '../interfaces/request-with-user.interface';

interface SupabaseJwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(
  Strategy,
  'supabase-jwt',
) {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('supabase', { infer: true }).jwtSecret,
    });
  }

  validate(payload: SupabaseJwtPayload): AuthenticatedUser {
    return { id: payload.sub, email: payload.email };
  }
}
