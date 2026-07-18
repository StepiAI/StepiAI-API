import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AppConfig } from '../config/configuration';
import { OpenAiService } from './openai.service';

describe('OpenAiService', () => {
  it('creates and reuses a client when an API key is configured', () => {
    const get = jest.fn().mockReturnValue({ openAiApiKey: 'test-api-key' });
    const configService = {
      get,
    } as unknown as ConfigService<AppConfig, true>;
    const service = new OpenAiService(configService);

    const firstClient = service.getClient();
    const secondClient = service.getClient();

    expect(firstClient).toBe(secondClient);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fails only when OpenAI is used without an API key', () => {
    const configService = {
      get: jest.fn().mockReturnValue({ openAiApiKey: '' }),
    } as unknown as ConfigService<AppConfig, true>;
    const service = new OpenAiService(configService);

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
  });

  it('creates a short-lived voice session with live transcription and VAD', async () => {
    const configService = {
      get: jest.fn(),
    } as unknown as ConfigService<AppConfig, true>;
    const service = new OpenAiService(configService);
    const clientSecret = {
      value: 'ephemeral-key',
      expires_at: 123,
      session: { id: 'session-id' },
    };
    const create = jest.fn().mockResolvedValue(clientSecret);

    jest.spyOn(service, 'getClient').mockReturnValue({
      realtime: { clientSecrets: { create } },
    } as unknown as OpenAI);

    await expect(
      service.createRealtimeClientSecret({
        language: 'en',
        voice: 'coral',
        safetyIdentifier: 'hashed-user-id',
      }),
    ).resolves.toBe(clientSecret);

    expect(create).toHaveBeenCalledWith(
      {
        expires_after: { anchor: 'created_at', seconds: 60 },
        session: {
          type: 'realtime',
          model: 'gpt-realtime-2.1',
          instructions:
            'You are a helpful voice assistant. Respond conversationally and concisely.',
          output_modalities: ['audio'],
          audio: {
            input: {
              noise_reduction: { type: 'near_field' },
              transcription: {
                model: 'gpt-4o-mini-transcribe',
                language: 'en',
              },
              turn_detection: {
                type: 'server_vad',
                create_response: true,
                interrupt_response: true,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
            output: { voice: 'coral' },
          },
        },
      },
      {
        headers: {
          'OpenAI-Safety-Identifier': 'hashed-user-id',
        },
      },
    );
  });
});
