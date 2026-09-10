import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockAiProvider } from '@/lib/ai/providers/mock';

describe('mock AI structured output', () => {
  it('returns schema-validated deterministic content', async () => {
    const provider = new MockAiProvider();
    const schema = z.object({ hashtags: z.array(z.string()).min(1) });
    const input = {
      messages: [{ role: 'user' as const, content: 'Hashtags about durable queues.' }],
      schema,
      schemaName: 'hashtags',
    };
    const first = await provider.completeObject(input);
    const second = await provider.completeObject(input);
    expect(first.object).toEqual(second.object);
    expect(schema.safeParse(first.object).success).toBe(true);
  });
});
