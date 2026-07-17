import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AppConfig } from '../config/configuration';

@Injectable()
export class SupabaseService {
  private readonly client: ReturnType<typeof createClient>;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    const { url, serviceRoleKey } = this.configService.get('supabase', {
      infer: true,
    });
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  getClient() {
    return this.client;
  }
}
