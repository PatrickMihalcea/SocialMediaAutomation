import 'server-only';
import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '@/lib/env';
import { AiError, type AiImageResult, type AiObjectResult, type AiProvider, type AiTextResult, type AiMessage } from '@/lib/ai/types';
import type { ImageSize } from '@/lib/ai/image-sizes';

/**
 * Generous because reasoning models are slow: gpt-5-mini answers a workflow
 * question in around 55 seconds, which sat right on the old 60s ceiling and
 * would have timed out intermittently — and completeObject can spend two calls
 * on one request when its first reply misses the schema.
 */
const TIMEOUT_MS = 180_000;

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly textModel = env.OPENAI_TEXT_MODEL;
  readonly imageModel = env.OPENAI_IMAGE_MODEL;
  private client: OpenAI | null = null;
  /**
   * Models that reject any temperature but their default. Newer OpenAI models
   * accept only 1, and answer anything else with a hard 400 — which surfaced
   * as "the AI service rejected that request" for every single call, making
   * the model look unavailable rather than merely opinionated.
   *
   * Learned at runtime rather than hardcoded: the list of such models changes
   * faster than this file does, and a stale allowlist fails the same way.
   */
  private rejectsTemperature = new Set<string>();

  /**
   * One chat call, retried without temperature if this model turns out not to
   * accept it. The workspace's AI creativity setting still applies wherever it
   * can; on a model that refuses, the request goes through at the model's own
   * default instead of failing outright.
   */
  private async createChat(
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    const { temperature, ...rest } = params;
    if (this.rejectsTemperature.has(params.model)) {
      return this.sdk().chat.completions.create(rest);
    }
    try {
      return await this.sdk().chat.completions.create(params);
    } catch (error) {
      const message = error instanceof OpenAI.APIError ? String(error.message) : '';
      if (temperature !== undefined && /temperature/i.test(message) && /unsupported|does not support/i.test(message)) {
        this.rejectsTemperature.add(params.model);
        console.warn(`[openai] ${params.model} ignores the AI creativity setting; it only accepts its default temperature`);
        return this.sdk().chat.completions.create(rest);
      }
      throw error;
    }
  }

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
      const res = await this.createChat({
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
      // json_object only guarantees syntactically valid JSON, not JSON
      // matching our schema — a model that drifts (echoing a workflow object
      // shape it saw earlier in the prompt, say, instead of the {reply,
      // action} envelope actually asked for) still passes this response_format
      // and previously had no way back. One self-repair turn, showing the
      // model its own bad output and the exact validation errors, recovers
      // the large majority of these; a stricter json_schema mode would
      // guarantee this by construction, but every Zod schema across the AI
      // module would need converting to a fully strict-compatible JSON Schema
      // first, which is a larger, riskier change than this one.
      const messages = [
        ...input.messages,
        {
          role: 'system' as const,
          content:
            'Reply with a single JSON object and nothing else. No prose, no markdown fence, no explanation.',
        },
      ];
      const create = (msgs: AiMessage[]) =>
        this.createChat({
          model: this.textModel,
          messages: msgs,
          temperature: input.temperature ?? 0.7,
          response_format: { type: 'json_object' },
        });

      let res = await create(messages);
      let raw = res.choices[0]?.message?.content ?? '{}';
      let parsed = safeParseJson(input.schema, raw);

      if (!parsed.success) {
        const retry = await create([
          ...messages,
          { role: 'assistant', content: raw },
          {
            role: 'system',
            content:
              `That reply did not satisfy the required "${input.schemaName}" schema:\n${parsed.error}\n\n` +
              'Reply again with a single corrected JSON object satisfying every field. No prose, no markdown fence.',
          },
        ]);
        raw = retry.choices[0]?.message?.content ?? '{}';
        parsed = safeParseJson(input.schema, raw);
        res = retry;
      }

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

/**
 * Parses and validates in one step, folding an unparseable response into the
 * same failure shape as a schema mismatch — both are "the model needs to see
 * this and try again", and the caller's retry does not need to know which one
 * it is.
 */
function safeParseJson<T>(
  schema: z.ZodType<T>,
  raw: string,
): { success: true; data: T } | { success: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stripFence(raw));
  } catch {
    return { success: false, error: 'The reply was not valid JSON.' };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { success: false, error: JSON.stringify(parsed.error.issues, null, 2) };
  }
  return { success: true, data: parsed.data };
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
