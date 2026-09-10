import 'server-only';
import type { AiMediaResult, AudioProvider, ImageEditingProvider, VideoGenerationProvider } from '@/lib/ai/types';
import { AiError } from '@/lib/ai/types';
import { env } from '@/lib/env';

/**
 * Explicit production stubs. They are selected only when AI_PROVIDER=openai,
 * use the existing OPENAI_API_KEY gate, and fail before any job is charged or
 * stored. Replace each method as the deployment enables the corresponding API.
 */
class ExternalStub {
  readonly name = 'openai';
  isConfigured() { return Boolean(env.OPENAI_API_KEY); }
  protected unavailable(capability: string): never {
    throw new AiError(`${capability} is not enabled on this deployment.`);
  }
}

export class OpenAiImageEditingProvider extends ExternalStub implements ImageEditingProvider {
  readonly model = env.OPENAI_IMAGE_MODEL;
  async editImage(_input: { prompt: string; image: Buffer; mimeType: string }): Promise<AiMediaResult> { return this.unavailable('Image editing'); }
  async createVariation(_input: { image: Buffer; mimeType: string; prompt?: string }): Promise<AiMediaResult> { return this.unavailable('Image variations'); }
}

export class OpenAiVideoGenerationProvider extends ExternalStub implements VideoGenerationProvider {
  readonly model = 'external-video';
  async generateVideo(_input: { prompt: string; image?: Buffer }): Promise<AiMediaResult> { return this.unavailable('Video generation'); }
  async animateImage(_input: { prompt: string; image: Buffer }): Promise<AiMediaResult> { return this.unavailable('Image animation'); }
}

export class OpenAiAudioProvider extends ExternalStub implements AudioProvider {
  readonly model = 'external-audio';
  async textToSpeech(_input: { text: string; voice?: string }): Promise<AiMediaResult> { return this.unavailable('Text to speech'); }
  async transcribe(_input: { audio: Buffer; mimeType: string }): Promise<{ text: string; model: string }> { return this.unavailable('Transcription'); }
  async translate(_input: { audio: Buffer; mimeType: string }): Promise<{ text: string; model: string }> { return this.unavailable('Audio translation'); }
}
