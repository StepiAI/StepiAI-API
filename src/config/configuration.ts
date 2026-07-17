export interface AppConfig {
  port: number;
  databaseUrl: string;
  supabase: {
    url: string;
    serviceRoleKey: string;
    jwtSecret: string;
  };
  ai: {
    openAiApiKey: string;
  };
  maps: {
    googleMapsApiKey: string;
  };
  weather: {
    apiKey: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  },
  ai: {
    openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  },
  maps: {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
  },
  weather: {
    apiKey: process.env.WEATHER_API_KEY ?? '',
  },
});
