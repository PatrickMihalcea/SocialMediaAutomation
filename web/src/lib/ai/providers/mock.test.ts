import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockAiProvider } from '@/lib/ai/providers/mock';
import { assistantReplySchema } from '@/lib/ai/schemas';

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

  it.each([
    ['Create 3 drafts about durable queues', 'create_drafts', 3],
    ['Schedule Launch Notes on Friday at 10:30', 'schedule_posts', 1],
    ['Assign Launch Notes to Spring Launch campaign', 'assign_campaign', 1],
    ['Attach launch.png media to Launch Notes', 'attach_media', 1],
    ['Shorten Launch Notes', 'update_post_content', 1],
    ['Repurpose Launch Notes for a fresh audience', 'repurpose_content', 1],
  ])('returns a faithful simulated %s proposal', async (prompt, kind, expectedItems) => {
    const provider = new MockAiProvider();
    const context = {
      posts: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Launch Notes', status: 'DRAFT' }],
      campaigns: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Spring Launch' }],
      media: [{ id: '33333333-3333-4333-8333-333333333333', filename: 'launch.png', type: 'IMAGE' }],
    };
    const result = await provider.completeObject({
      schema: assistantReplySchema,
      schemaName: 'assistant_reply',
      messages: [
        { role: 'system', content: `WORKSPACE_CONTEXT_BEGIN${JSON.stringify(context)}WORKSPACE_CONTEXT_END` },
        { role: 'user', content: prompt },
      ],
    });
    expect(result.object.action?.kind).toBe(kind);
    expect(result.object.reply).toContain('simulated output');
    if (result.object.action?.kind === 'create_drafts') {
      expect(result.object.action.posts).toHaveLength(expectedItems);
      expect(new Set(result.object.action.posts.map((post) => post.text)).size).toBe(expectedItems);
    }
  });
});
