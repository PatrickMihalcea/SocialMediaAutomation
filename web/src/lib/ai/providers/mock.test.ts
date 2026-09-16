import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { z } from 'zod';
import { MockAiProvider } from '@/lib/ai/providers/mock';
import { assistantReplySchema, imagePromptsSchema } from '@/lib/ai/schemas';

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

  it('generates deterministic local PNGs at the requested dimensions', async () => {
    const provider = new MockAiProvider();
    const input = { prompt: 'A glass treehouse in a pine forest', size: '1024x1536' };
    const first = await provider.generateImage(input);
    const second = await provider.generateImage(input);
    const metadata = await sharp(first.data).metadata();

    expect(first.mimeType).toBe('image/png');
    expect(first.model).toBe('mock-image-1');
    expect(first.data.equals(second.data)).toBe(true);
    expect(metadata).toMatchObject({ width: 1024, height: 1536, format: 'png' });
  });

  // The Idea generator runs this sample in demo mode, and the provider throws
  // rather than degrading when a sample misses a required field — so an
  // incomplete sample takes the whole step down.
  it('returns an idea sample complete enough to satisfy the real schema', async () => {
    const provider = new MockAiProvider();
    const { object } = await provider.completeObject({
      messages: [{ role: 'user' as const, content: 'Write 4 image prompts about: coastal rooms' }],
      schema: imagePromptsSchema,
      schemaName: 'image_prompts',
    });
    const idea = imagePromptsSchema.parse(object);

    expect(idea.prompts).toHaveLength(4);
    expect(idea.postTitle.length).toBeGreaterThan(0);
    expect(idea.caption.length).toBeGreaterThan(0);
    expect(idea.hashtags.length).toBeGreaterThan(0);
    // Bare tags, matching what the step asks the model for.
    expect(idea.hashtags.every((tag) => !tag.startsWith('#'))).toBe(true);
  });

  it.each([
    ['Create 3 drafts about durable queues', 'create_drafts', 3],
    ['Schedule Launch Notes on Friday at 10:30', 'schedule_posts', 1],
    ['Assign Launch Notes to Spring Launch campaign', 'assign_campaign', 1],
    ['Attach launch.png media to Launch Notes', 'attach_media', 1],
    ['Shorten Launch Notes', 'update_post_content', 1],
    ['Repurpose Launch Notes for a fresh audience', 'repurpose_content', 1],
    ['Create a weekly reel workflow about coastal rooms', 'create_workflow', 1],
    ['Run Launch workflow', 'run_workflow', 1],
  ])('returns a faithful simulated %s proposal', async (prompt, kind, expectedItems) => {
    const provider = new MockAiProvider();
    const context = {
      posts: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Launch Notes', status: 'DRAFT' }],
      campaigns: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Spring Launch' }],
      media: [{ id: '33333333-3333-4333-8333-333333333333', filename: 'launch.png', type: 'IMAGE' }],
      workflows: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Launch workflow' }],
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

  it('refines a previous generated draft without mutating an existing post', async () => {
    const provider = new MockAiProvider();
    const prior = {
      kind: 'create_drafts',
      summary: 'Create one draft',
      posts: [{ title: 'Queues', text: 'Original generated copy', hashtags: [] }],
    };
    const result = await provider.completeObject({
      schema: assistantReplySchema,
      schemaName: 'assistant_reply',
      messages: [
        { role: 'system', content: 'WORKSPACE_CONTEXT_BEGIN{"posts":[],"campaigns":[],"media":[]}WORKSPACE_CONTEXT_END' },
        { role: 'assistant', content: `I prepared a draft.\n<prior_proposal>${JSON.stringify(prior)}</prior_proposal>` },
        { role: 'user', content: 'Make this more technical' },
      ],
    });
    expect(result.object.action?.kind).toBe('create_drafts');
    if (result.object.action?.kind === 'create_drafts') {
      expect(result.object.action.posts[0].text).not.toBe('Original generated copy');
    }
  });
});
