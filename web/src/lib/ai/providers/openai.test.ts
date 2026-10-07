import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { OPENAI_API_KEY: 'test-key', OPENAI_TEXT_MODEL: 'gpt-4o-mini', OPENAI_IMAGE_MODEL: 'gpt-image-1' },
}));
vi.mock('openai', () => {
  class FakeApiError extends Error {}
  return {
    default: class {
      chat = { completions: { create: createMock } };
      static APIError = FakeApiError;
    },
  };
});

import { OpenAiProvider } from '@/lib/ai/providers/openai';
import { AiError } from '@/lib/ai/types';

const schema = z.object({ reply: z.string() });
const response = (content: string) => ({ choices: [{ message: { content } }], model: 'gpt-4o-mini', usage: {} });

describe('OpenAiProvider.completeObject', () => {
  beforeEach(() => createMock.mockReset());

  it('returns the parsed object on the first try without a retry call', async () => {
    createMock.mockResolvedValueOnce(response('{"reply":"hello"}'));

    const provider = new OpenAiProvider();
    const result = await provider.completeObject({
      messages: [{ role: 'user', content: 'hi' }],
      schema,
      schemaName: 'reply',
    });

    expect(result.object).toEqual({ reply: 'hello' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The bug this covers: json_object mode only guarantees valid JSON, not our
   * schema. A model that drifts into a differently-shaped object — echoing a
   * workflow record instead of the {reply} envelope, say — used to fail with
   * no way back. One corrective turn, shown its own bad output and the exact
   * validation errors, should recover it.
   */
  it('recovers from a schema mismatch with one self-repair turn', async () => {
    createMock
      .mockResolvedValueOnce(response('{"id":"wf-1","name":"Bedroom picker"}'))
      .mockResolvedValueOnce(response('{"reply":"Here is your workflow."}'));

    const provider = new OpenAiProvider();
    const result = await provider.completeObject({
      messages: [{ role: 'user', content: 'Explain my workflow' }],
      schema,
      schemaName: 'assistant_reply',
    });

    expect(result.object).toEqual({ reply: 'Here is your workflow.' });
    expect(createMock).toHaveBeenCalledTimes(2);
    const retryMessages = createMock.mock.calls[1][0].messages as { role: string; content: string }[];
    // The retry must show the model what it actually said and why that was
    // wrong — a retry that just repeats the original prompt reproduces the
    // same drift instead of correcting it.
    expect(retryMessages.some((m) => m.role === 'assistant' && m.content.includes('wf-1'))).toBe(true);
    expect(retryMessages.some((m) => m.role === 'system' && m.content.includes('assistant_reply'))).toBe(true);
  });

  it('recovers from unparseable JSON the same way as a schema mismatch', async () => {
    createMock
      .mockResolvedValueOnce(response('Sure, here you go: {"reply": "oops"'))
      .mockResolvedValueOnce(response('{"reply":"fixed"}'));

    const provider = new OpenAiProvider();
    const result = await provider.completeObject({
      messages: [{ role: 'user', content: 'hi' }],
      schema,
      schemaName: 'reply',
    });

    expect(result.object).toEqual({ reply: 'fixed' });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('throws after the retry also fails, rather than looping indefinitely', async () => {
    createMock
      .mockResolvedValueOnce(response('{"nope":true}'))
      .mockResolvedValueOnce(response('{"still":"wrong"}'));

    const provider = new OpenAiProvider();
    await expect(
      provider.completeObject({ messages: [{ role: 'user', content: 'hi' }], schema, schemaName: 'reply' }),
    ).rejects.toBeInstanceOf(AiError);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * A reference picture is the whole point of the layout feature: a step that
 * silently sent the words alone would still produce a plausible answer, which
 * is exactly why this needs a test rather than a look at the output.
 */
describe('OpenAiProvider.completeObject with a reference image', () => {
  beforeEach(() => createMock.mockReset());

  const image = { data: Buffer.from('fake-png'), mimeType: 'image/png' };

  it('attaches the picture to what the person asked, not to a message of its own', async () => {
    createMock.mockResolvedValueOnce(response('{"reply":"ok"}'));

    const provider = new OpenAiProvider();
    await provider.completeObject({
      messages: [
        { role: 'system', content: 'You write prompts.' },
        { role: 'user', content: 'Write 4 prompts about rain' },
        { role: 'system', content: 'Reply as JSON.' },
      ],
      images: [image],
      schema,
      schemaName: 'reply',
    });

    const sent = createMock.mock.calls[0][0].messages;
    const user = sent.find((m: { role: string }) => m.role === 'user');
    expect(user.content[0]).toEqual({ type: 'text', text: 'Write 4 prompts about rain' });
    expect(user.content[1].image_url.url).toBe(
      `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`,
    );
    expect(sent.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
  });

  it('sends the words alone when no picture is attached', async () => {
    createMock.mockResolvedValueOnce(response('{"reply":"ok"}'));

    const provider = new OpenAiProvider();
    await provider.completeObject({
      messages: [{ role: 'user', content: 'Write 4 prompts about rain' }],
      schema,
      schemaName: 'reply',
    });

    const user = createMock.mock.calls[0][0].messages.find((m: { role: string }) => m.role === 'user');
    expect(user.content).toBe('Write 4 prompts about rain');
  });

  /** The repair turn re-sends the conversation, and must re-send the picture with it. */
  it('keeps the picture attached on the self-repair turn', async () => {
    createMock
      .mockResolvedValueOnce(response('{"wrong":"shape"}'))
      .mockResolvedValueOnce(response('{"reply":"ok"}'));

    const provider = new OpenAiProvider();
    await provider.completeObject({
      messages: [{ role: 'user', content: 'Write 4 prompts about rain' }],
      images: [image],
      schema,
      schemaName: 'reply',
    });

    const retry = createMock.mock.calls[1][0].messages;
    const user = retry.find((m: { role: string }) => m.role === 'user');
    expect(Array.isArray(user.content)).toBe(true);
    expect(user.content[1].type).toBe('image_url');
  });
});
