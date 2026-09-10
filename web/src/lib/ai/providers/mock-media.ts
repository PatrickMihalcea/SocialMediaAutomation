import 'server-only';
import sharp from 'sharp';
import type {
  AiMediaResult,
  AudioProvider,
  ImageEditingProvider,
  VideoGenerationProvider,
} from '@/lib/ai/types';

/**
 * The label is drawn as SVG then rasterised: platforms reject SVG uploads, so a
 * mock asset that stayed vectorial would fail validation the moment a post used
 * it. A sharp build without SVG text support still returns the flat ground.
 */
async function placeholderPng(label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#c5b0f4"/><text x="512" y="500" text-anchor="middle" font-family="monospace" font-size="28">${escapeXml(label).slice(0, 64)}</text><text x="512" y="550" text-anchor="middle" font-family="monospace" font-size="18">BRIDGE88 MOCK MEDIA</text></svg>`;
  try {
    return await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
  } catch {
    return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#c5b0f4' } }).png().toBuffer();
  }
}

export class MockImageEditingProvider implements ImageEditingProvider {
  readonly name = 'mock';
  readonly model = 'mock-image-edit-1';
  isConfigured() { return true; }
  async editImage(input: { prompt: string; image: Buffer; mimeType: string }): Promise<AiMediaResult> {
    return { data: await placeholderPng(`EDIT · ${input.prompt}`), mimeType: 'image/png', extension: 'png', model: this.model, width: 1024, height: 1024 };
  }
  async createVariation(input: { image: Buffer; mimeType: string; prompt?: string }): Promise<AiMediaResult> {
    return { data: await placeholderPng(`VARIATION · ${input.prompt ?? 'SOURCE IMAGE'}`), mimeType: 'image/png', extension: 'png', model: this.model, width: 1024, height: 1024 };
  }
}

export class MockVideoGenerationProvider implements VideoGenerationProvider {
  readonly name = 'mock';
  readonly model = 'mock-video-1';
  isConfigured() { return true; }
  async generateVideo(input: { prompt: string; image?: Buffer }): Promise<AiMediaResult> {
    return videoResult(input.prompt);
  }
  async animateImage(input: { prompt: string; image: Buffer }): Promise<AiMediaResult> {
    return videoResult(`Animated: ${input.prompt}`);
  }
}

export class MockAudioProvider implements AudioProvider {
  readonly name = 'mock';
  readonly model = 'mock-audio-1';
  isConfigured() { return true; }
  async textToSpeech(input: { text: string }): Promise<AiMediaResult> {
    // A small deterministic WAV containing silence. Its RIFF label carries a
    // stable prompt hash so repeated test inputs produce identical bytes.
    const hash = [...input.text].reduce((sum, char) => (sum + char.charCodeAt(0)) % 65536, 0);
    const pcmBytes = 8_000;
    const out = Buffer.alloc(44 + pcmBytes);
    out.write('RIFF', 0); out.writeUInt32LE(36 + pcmBytes, 4); out.write('WAVEfmt ', 8);
    out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
    out.writeUInt32LE(8_000, 24); out.writeUInt32LE(8_000, 28); out.writeUInt16LE(1, 32);
    out.writeUInt16LE(8, 34); out.write('data', 36); out.writeUInt32LE(pcmBytes, 40);
    out.fill(128, 44); out.writeUInt16LE(hash, 44);
    return { data: out, mimeType: 'audio/wav', extension: 'wav', model: this.model, durationSeconds: 1 };
  }
  async transcribe(): Promise<{ text: string; model: string }> {
    return { text: 'Deterministic mock transcription.', model: this.model };
  }
  async translate(): Promise<{ text: string; model: string }> {
    return { text: 'Deterministic mock English translation.', model: this.model };
  }
}

function videoResult(prompt: string): AiMediaResult {
  // This is intentionally a labelled fixture, not a claimed playable MP4.
  const data = Buffer.from(`BRIDGE88 MOCK VIDEO\n${prompt}\n`);
  return { data, mimeType: 'video/webm', extension: 'webm', model: 'mock-video-1', durationSeconds: 1, width: 1280, height: 720 };
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, '');
}
