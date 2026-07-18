import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile, type Uploadable } from 'openai';
import { AppConfig } from '../../config/configuration';

const DEFAULT_TEXT_MODEL = 'gpt-4.1-mini';
const DEFAULT_SPEECH_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1.5';
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
const DEFAULT_REALTIME_VOICE = 'marin';
const REALTIME_CLIENT_SECRET_TTL_SECONDS = 60;
const DEFAULT_REALTIME_INSTRUCTIONS =
  'You are a helpful voice assistant. Respond conversationally and concisely.';

const speechContentTypes = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/L16',
} as const;

export type SpeechFormat = keyof typeof speechContentTypes;

export interface GenerateTextOptions {
  model?: string;
  instructions?: string;
  maxOutputTokens?: number;
}

export interface SynthesizeSpeechOptions {
  model?: string;
  voice?: string;
  instructions?: string;
  format?: SpeechFormat;
  speed?: number;
}

export interface TranscribeAudioOptions {
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
}

export interface CreateRealtimeClientSecretOptions {
  model?: string;
  instructions?: string;
  voice?: string;
  language?: string;
  safetyIdentifier?: string;
}

export interface GeneratedSpeech {
  audio: Buffer;
  contentType: string;
  format: SpeechFormat;
}

@Injectable()
export class OpenAiService {
  private client?: OpenAI;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const { openAiApiKey } = this.configService.get('ai', { infer: true });

    if (!openAiApiKey) {
      throw new ServiceUnavailableException(
        'OpenAI is not configured. Set OPENAI_API_KEY before making an AI request.',
      );
    }

    this.client = new OpenAI({ apiKey: openAiApiKey });
    return this.client;
  }

  createResponse(request: OpenAI.Responses.ResponseCreateParamsNonStreaming) {
    return this.getClient().responses.create(request);
  }

  async generateText(input: string, options: GenerateTextOptions = {}) {
    const response = await this.createResponse({
      model: options.model ?? DEFAULT_TEXT_MODEL,
      input,
      instructions: options.instructions,
      max_output_tokens: options.maxOutputTokens,
    });

    return response.output_text;
  }

  async synthesizeSpeech(
    input: string,
    options: SynthesizeSpeechOptions = {},
  ): Promise<GeneratedSpeech> {
    const format = options.format ?? 'mp3';
    const response = await this.getClient().audio.speech.create({
      model: options.model ?? DEFAULT_SPEECH_MODEL,
      voice: options.voice ?? 'alloy',
      input,
      instructions: options.instructions,
      response_format: format,
      speed: options.speed,
    });

    return {
      audio: Buffer.from(await response.arrayBuffer()),
      contentType: speechContentTypes[format],
      format,
    };
  }

  async transcribeAudio(
    file: Uploadable,
    options: TranscribeAudioOptions = {},
  ): Promise<string> {
    const transcription = await this.getClient().audio.transcriptions.create({
      file,
      model: options.model ?? DEFAULT_TRANSCRIPTION_MODEL,
      language: options.language,
      prompt: options.prompt,
      temperature: options.temperature,
    });

    return transcription.text;
  }

  async transcribeBuffer(
    audio: Buffer,
    filename: string,
    mimeType?: string,
    options: TranscribeAudioOptions = {},
  ): Promise<string> {
    const file = await toFile(audio, filename, { type: mimeType });
    return this.transcribeAudio(file, options);
  }

  createRealtimeClientSecret(options: CreateRealtimeClientSecretOptions = {}) {
    const requestOptions = options.safetyIdentifier
      ? {
          headers: {
            'OpenAI-Safety-Identifier': options.safetyIdentifier,
          },
        }
      : undefined;

    return this.getClient().realtime.clientSecrets.create(
      {
        expires_after: {
          anchor: 'created_at',
          seconds: REALTIME_CLIENT_SECRET_TTL_SECONDS,
        },
        session: {
          type: 'realtime',
          model: options.model ?? DEFAULT_REALTIME_MODEL,
          instructions: options.instructions ?? DEFAULT_REALTIME_INSTRUCTIONS,
          output_modalities: ['audio'],
          audio: {
            input: {
              noise_reduction: { type: 'near_field' },
              transcription: {
                model: DEFAULT_TRANSCRIPTION_MODEL,
                language: options.language,
              },
              turn_detection: {
                type: 'server_vad',
                create_response: true,
                interrupt_response: true,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
            output: { voice: options.voice ?? DEFAULT_REALTIME_VOICE },
          },
        },
      },
      requestOptions,
    );
  }

  generateImage(prompt: string) {
    return this.getClient().images.generate({
      model: DEFAULT_IMAGE_MODEL,
      prompt,
    });
  }
}
