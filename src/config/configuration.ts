export interface AppConfig {
  port: number;
  databaseUrl: string;
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  ai: {
    openAiApiKey: string;
  };
  azureSpeech: {
    endpoint: string;
    key: string;
    resourceId: string;
  };
  google: {
    clientId: string;
    clientSecret: string;
  };
  routing: {
    tomTomApiKey: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  ai: {
    openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  },
  azureSpeech: {
    endpoint: process.env.AZURE_SPEECH_ENDPOINT ?? '',
    key: process.env.AZURE_SPEECH_KEY ?? '',
    resourceId: process.env.AZURE_RESOURCE_ID ?? '',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
  routing: {
    tomTomApiKey: process.env.TOMTOM_API_KEY ?? '',
  },
});
