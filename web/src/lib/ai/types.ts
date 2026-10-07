import { z } from 'zod';
import type { ImageSize } from '@/lib/ai/image-sizes';

/**
 * Provider-agnostic AI surface. Everything the product asks of a model goes
 * through these three methods, so swapping OpenAI for another vendor — or for
 * the deterministic mock — is a one-line change in src/lib/ai/index.ts.
 */

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiTextResult {
  text: string;
  model: string;
  usage: AiUsage;
}

export interface AiObjectResult<T> {
  object: T;
  model: string;
  usage: AiUsage;
}

export interface AiImageResult {
  /** Raw image bytes; the caller decides whether to store them. */
  data: Buffer;
  mimeType: string;
  model: string;
  usage: AiUsage;
}

export interface AiMediaResult {
  data: Buffer;
  mimeType: string;
  extension: string;
  model: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface ImageEditingProvider {
  readonly name: string;
  readonly model: string;
  isConfigured(): boolean;
  editImage(input: { prompt: string; image: Buffer; mimeType: string }): Promise<AiMediaResult>;
  createVariation(input: { image: Buffer; mimeType: string; prompt?: string }): Promise<AiMediaResult>;
}

export interface VideoGenerationProvider {
  readonly name: string;
  readonly model: string;
  isConfigured(): boolean;
  generateVideo(input: { prompt: string; image?: Buffer }): Promise<AiMediaResult>;
  animateImage(input: { prompt: string; image: Buffer }): Promise<AiMediaResult>;
}

export interface AudioProvider {
  readonly name: string;
  readonly model: string;
  isConfigured(): boolean;
  textToSpeech(input: { text: string; voice?: string }): Promise<AiMediaResult>;
  transcribe(input: { audio: Buffer; mimeType: string }): Promise<{ text: string; model: string }>;
  translate(input: { audio: Buffer; mimeType: string }): Promise<{ text: string; model: string }>;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProvider {
  readonly name: string;
  readonly textModel: string;
  readonly imageModel: string;
  isConfigured(): boolean;

  complete(input: { messages: AiMessage[]; temperature?: number; maxTokens?: number }): Promise<AiTextResult>;

  /**
   * Structured output. The brief is explicit that an AI response the application
   * acts on must not be free prose — so every tool that produces posts, ideas or
   * a schedule goes through here with a Zod schema, and a response that does not
   * satisfy it is an error rather than something to parse hopefully.
   */
  /**
   * `images` are shown to the model alongside the messages, for a call that has
   * to look at something — a layout to follow, a picture to describe. Providers
   * that cannot see simply ignore them.
   */
  completeObject<T>(input: {
    images?: Array<{ data: Buffer; mimeType: string }>;
    messages: AiMessage[];
    /**
     * Output type and input type are separate on purpose: a schema may repair
     * what it is handed before validating it, so what the model sends is not
     * the shape the caller gets back.
     */
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    schemaName: string;
    temperature?: number;
  }): Promise<AiObjectResult<T>>;

  /**
   * `onStage` is called as the provider reports what it is doing — queued,
   * generating, saving. Optional, and providers that know nothing of their own
   * progress simply never call it.
   */
  generateImage(input: {
    onStage?: (stage: string) => void;
    prompt: string;
    size?: ImageSize;
    /**
     * Pictures the generator should look at, each saying what it is for.
     *
     * A list with roles rather than one image, because the three roles answer
     * different questions and a run can want more than one answered at once:
     * this arrangement, that cast, in this art style. Role matters as much as
     * the bytes — the same photograph means "keep these faces" as a subject and
     * "match this palette and finish" as a style.
     *
     * Advisory: only a provider with a reference mechanism can act on these,
     * and the others generate from the prompt alone rather than failing.
     */
    references?: AiImageReference[];
  }): Promise<AiImageResult>;
}

/** What a reference picture is for. Named as the image CLI names them. */
export type AiImageRole = 'subject' | 'style' | 'composition';

export interface AiImageReference {
  data: Buffer;
  mimeType: string;
  role: AiImageRole;
}

export class AiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AiError';
    this.retryable = options.retryable ?? false;
  }
}

/**
 * The provider's credential needs a person to renew it.
 *
 * Distinct from an ordinary failure because the response is different in kind:
 * retrying cannot help, and silently generating on a different provider would
 * turn an expired subscription token into an unasked-for API bill. Callers
 * surface this and stop.
 */
export class AiCredentialError extends AiError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { retryable: false, cause: options.cause });
    this.name = 'AiCredentialError';
  }
}
