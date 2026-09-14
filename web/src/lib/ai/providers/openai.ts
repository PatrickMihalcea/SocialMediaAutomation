import 'server-only';
import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '@/lib/env';
import { AiError, type AiImageResult, type AiObjectResult, type AiProvider, type AiTextResult, type AiMessage } from '@/lib/ai/types';
import type { ImageSize } from '@/lib/ai/image-sizes';

const TIMEOUT_MS = 60_000;

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly textModel = env.OPENAI_TEXT_MODEL;
  readonly imageModel = env.OPENAI_IMAGE_MODEL;
  private client: OpenAI | null = null;

  isConfigured(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  }

  private sdk(): OpenAI {
    if (!this.isConfigured()) throw new AiError('The AI tools are not configured on this deployment.');
    if (!this.client) {
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 2 });
    }
    return this.client;
  }

  async complete(input: { messages: AiMessage[]; temperature?: number; maxTokens?: number }): Promise<AiTextResult> {
    try {
      const res = await this.sdk().chat.completions.create({
        model: this.textModel,
        messages: input.messages,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens ?? 1500,
      });
      return {
        text: res.choices[0]?.message?.content ?? '',
        model: res.model,
        usage: {
          promptTokens: res.usage?.prompt_tokens,
          completionTokens: res.usage?.completion_tokens,
          totalTokens: res.usage?.total_tokens,
        },
      };
    } catch (error) {
      throw wrap(error);
    }
  }

  async completeObject<T>(input: {
    messages: AiMessage[];
    schema: z.ZodType<T>;
    schemaName: string;
    temperature?: number;
  }): Promise<AiObjectResult<T>> {
    try {
      const res = await this.sdk().chat.completions.create({
        model: this.textModel,
        messages: [
          ...input.messages,
          {
            role: 'system',
            content:
              'Reply with a single JSON object and nothing else. No prose, no markdown fence, no explanation.',
          },
        ],
        temperature: input.temperature ?? 0.7,
        response_format: { type: 'json_object' },
      });

      const raw = res.choices[0]?.message?.content ?? '{}';
      const parsed = input.schema.safeParse(JSON.parse(stripFence(raw)));
      if (!parsed.success) {
        throw new AiError(
          'The AI returned something Bridge88 could not use. Try again, or rephrase the request.',
          { retryable: true, cause: parsed.error },
        );
      }
      return {
        object: parsed.data,
        model: res.model,
        usage: {
          promptTokens: res.usage?.prompt_tokens,
          completionTokens: res.usage?.completion_tokens,
          totalTokens: res.usage?.total_tokens,
        },
      };
    } catch (error) {
      throw wrap(error);
    }
  }

  async generateImage(input: { prompt: string; size?: ImageSize }): Promise<AiImageResult> {
    try {
      const res = await this.sdk().images.generate({
        model: this.imageModel,
        prompt: input.prompt,
        size: input.size ?? '1024x1024',
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new AiError('The image provider returned no image.', { retryable: true });
      return {
        data: Buffer.from(b64, 'base64'),
        mimeType: 'image/png',
        model: this.imageModel,
        usage: {},
      };
    } catch (error) {
      throw wrap(error);
    }
  }
}

function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

function wrap(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof OpenAI.APIError) {
    const retryable = error.status === 429 || (error.status ?? 0) >= 500;
    return new AiError(
      retryable
        ? 'The AI service is busy right now. Try again in a moment.'
        : 'The AI service rejected that request.',
      { retryable, cause: error },
    );
  }
  return new AiError('The AI service could not be reached.', { retryable: true, cause: error });
}
