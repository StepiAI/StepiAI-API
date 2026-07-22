import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { VoiceService } from './voice.service';

describe('VoiceService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(config: Partial<AppConfig['azureSpeech']>) {
    return new VoiceService({
      get: jest.fn().mockReturnValue({
        endpoint: '',
        key: '',
        resourceId: '',
        ...config,
      }),
    } as unknown as ConfigService<AppConfig, true>);
  }

  it('synthesizes speech through Azure REST TTS', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );
    global.fetch = fetchMock;
    const service = createService({
      endpoint: 'https://example-resource.cognitiveservices.azure.com/',
      key: 'test-key',
    });

    await expect(
      service.synthesizeSpeech('Halo & selamat datang', 'id-ID-GadisNeural'),
    ).resolves.toMatchObject({
      audio: Buffer.from([1, 2, 3]),
      contentType: 'audio/mpeg',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example-resource.cognitiveservices.azure.com/cognitiveservices/v1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Ocp-Apim-Subscription-Key': 'test-key',
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        }),
        body: expect.stringContaining('Halo &amp; selamat datang'),
      }),
    );
  });

  it('fails when Azure Speech is not configured', async () => {
    const service = createService({});

    await expect(service.synthesizeSpeech('Halo')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects empty text', async () => {
    const service = createService({
      endpoint: 'https://example-resource.cognitiveservices.azure.com/',
      key: 'test-key',
    });

    await expect(service.synthesizeSpeech('   ')).rejects.toThrow(
      BadRequestException,
    );
  });
});
