import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

const DEFAULT_AZURE_VOICE = 'id-ID-Gadis:DragonHDLatestNeural';
const DEFAULT_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const DEFAULT_CONTENT_TYPE = 'audio/mpeg';

export interface SynthesizedVoice {
  audio: Buffer;
  contentType: string;
  outputFormat: string;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async synthesizeSpeech(
    text: string,
    voice?: string,
  ): Promise<SynthesizedVoice> {
    const normalizedText = text?.trim();
    const selectedVoice = voice?.trim() || DEFAULT_AZURE_VOICE;

    if (!normalizedText) {
      throw new BadRequestException('Text is required');
    }

    const { endpoint, key } = this.configService.get('azureSpeech', {
      infer: true,
    });

    if (!endpoint || !key) {
      throw new ServiceUnavailableException(
        'Azure Speech is not configured. Set AZURE_SPEECH_ENDPOINT and AZURE_SPEECH_KEY.',
      );
    }

    const synthesisUrl = this.buildSynthesisUrl(endpoint);
    const ssml = this.buildSsml(normalizedText, selectedVoice);

    const response = await fetch(synthesisUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': DEFAULT_OUTPUT_FORMAT,
        'User-Agent': 'StepiAI',
        Accept: 'audio/mpeg',
      },
      body: ssml,
      signal: AbortSignal.timeout(30_000),
    });

    const responseBuffer = Buffer.from(await response.arrayBuffer());

    const contentType =
      response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase() ?? '';

    this.logger.debug({
      synthesisUrl,
      status: response.status,
      statusText: response.statusText,
      contentType,
      responseBytes: responseBuffer.length,
      voice: selectedVoice,
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Azure Speech synthesis failed with status ${response.status}: ` +
          responseBuffer.toString('utf8'),
      );
    }

    if (responseBuffer.length === 0) {
      throw new ServiceUnavailableException(
        `Azure Speech returned an empty response. ` +
          `Status=${response.status}, Content-Type=${contentType || 'missing'}`,
      );
    }

    if (!contentType.startsWith('audio/')) {
      throw new ServiceUnavailableException(
        `Azure Speech returned a non-audio response. ` +
          `Status=${response.status}, ` +
          `Content-Type=${contentType || 'missing'}, ` +
          `Body=${responseBuffer.toString('utf8')}`,
      );
    }

    return {
      audio: responseBuffer,
      contentType: contentType || DEFAULT_CONTENT_TYPE,
      outputFormat: DEFAULT_OUTPUT_FORMAT,
    };
  }

  private buildSynthesisUrl(endpoint: string): string {
    const parsed = new URL(endpoint);

    return new URL('/cognitiveservices/v1', parsed.origin).toString();
  }

  private buildSsml(text: string, voice: string): string {
    const escapedText = this.escapeXml(text);
    const escapedVoice = this.escapeXml(voice);

    return [
      '<speak',
      ' version="1.0"',
      ' xmlns="http://www.w3.org/2001/10/synthesis"',
      ' xml:lang="id-ID"',
      '>',
      `<voice name="${escapedVoice}">`,
      escapedText,
      '</voice>',
      '</speak>',
    ].join('');
  }

  private toReadableBody(buffer: Buffer, contentType: string): string {
    if (buffer.length === 0) {
      return '(empty response body)';
    }

    if (
      contentType.includes('json') ||
      contentType.startsWith('text/') ||
      contentType.includes('xml')
    ) {
      return buffer.toString('utf8').slice(0, 2_000);
    }

    return `Binary response containing ${buffer.length} bytes`;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

