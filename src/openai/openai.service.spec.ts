import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { OpenAiService } from './openai.service';

describe('OpenAiService', () => {
  it('creates and reuses a client when an API key is configured', () => {
    const configService = {
      get: jest.fn().mockReturnValue({ openAiApiKey: 'test-api-key' }),
    } as unknown as ConfigService<AppConfig, true>;
    const service = new OpenAiService(configService);

    const firstClient = service.getClient();
    const secondClient = service.getClient();

    expect(firstClient).toBe(secondClient);
    expect(configService.get).toHaveBeenCalledTimes(1);
  });

  it('fails only when OpenAI is used without an API key', () => {
    const configService = {
      get: jest.fn().mockReturnValue({ openAiApiKey: '' }),
    } as unknown as ConfigService<AppConfig, true>;
    const service = new OpenAiService(configService);

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
  });
});
