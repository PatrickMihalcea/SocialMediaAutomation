import 'server-only';
import type { BrandSettings, Workspace } from '@prisma/client';
import { db } from '@/lib/db';
import { CAPABILITIES } from '@/lib/social/capabilities';
import type { Platform } from '@prisma/client';

/**
 * Brand voice is not an optional extra bolted onto one screen — every generation
 * request is composed through here, so a workspace's rules apply whether the copy
 * came from the composer button, the assistant or a bulk calendar.
 */
export async function buildSystemPrompt(input: {
  workspaceId: string;
  platform?: Platform;
  extra?: string;
}): Promise<string> {
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    include: { brandSettings: true, preferences: true },
  });
  if (!workspace) return BASE_PROMPT;

  const parts = [BASE_PROMPT, describeWorkspace(workspace)];

  if (workspace.brandSettings && workspace.preferences?.aiUseBrandVoice !== false) {
    parts.push(describeVoice(workspace.brandSettings));
  }
  if (input.platform) parts.push(describePlatform(input.platform));
  if (input.extra) parts.push(input.extra);

  return parts.filter(Boolean).join('\n\n');
}

const BASE_PROMPT = `You write social media copy for a specific brand.
Write the post itself — no preamble, no "here's your post", no options unless asked.
Never invent facts, statistics, customer names or product features that were not given to you.
If you do not have a concrete detail, write around it rather than making one up.`;

function describeWorkspace(workspace: Workspace & { brandSettings: BrandSettings | null }): string {
  const lines = [`Brand: ${workspace.name}`];
  if (workspace.description) lines.push(`What it does: ${workspace.description}`);
  if (workspace.website) lines.push(`Website: ${workspace.website}`);
  if (workspace.industry) lines.push(`Industry: ${workspace.industry}`);
  if (workspace.targetAudience) lines.push(`Audience: ${workspace.targetAudience}`);
  lines.push(`Language: ${workspace.defaultLanguage}`);
  return lines.join('\n');
}

function describeVoice(voice: BrandSettings): string {
  const lines = ['Brand voice — follow this exactly:'];
  if (voice.tone) lines.push(`Tone: ${voice.tone}`);
  if (voice.personality) lines.push(`Personality: ${voice.personality}`);
  if (voice.targetAudience) lines.push(`Speaking to: ${voice.targetAudience}`);
  if (voice.writingStyle) lines.push(`Style: ${voice.writingStyle}`);
  if (voice.wordsToUse.length) lines.push(`Prefer these words: ${voice.wordsToUse.join(', ')}`);
  if (voice.wordsToAvoid.length) lines.push(`Never use these words: ${voice.wordsToAvoid.join(', ')}`);
  lines.push(`Emoji: ${EMOJI[voice.emojiPolicy] ?? voice.emojiPolicy}`);
  lines.push(`Hashtags: ${HASHTAGS[voice.hashtagPolicy] ?? voice.hashtagPolicy}`);
  if (voice.ctaStyle) lines.push(`Calls to action: ${voice.ctaStyle}`);
  if (voice.additionalInstructions) lines.push(`Also: ${voice.additionalInstructions}`);
  return lines.join('\n');
}

const EMOJI: Record<string, string> = {
  NONE: 'never use emoji.',
  SPARING: 'at most one, and only when it carries meaning.',
  FREELY: 'use them where they help.',
};

const HASHTAGS: Record<string, string> = {
  NONE: 'no hashtags.',
  MINIMAL: 'one or two, highly specific.',
  MODERATE: 'three to five, relevant rather than broad.',
  HEAVY: 'up to fifteen, mixing broad and niche.',
};

function describePlatform(platform: Platform): string {
  const caps = CAPABILITIES[platform];
  const notes: Record<Platform, string> = {
    LINKEDIN: 'Professional register. Lead with the insight, not the setup. Line breaks between short paragraphs.',
    X: 'One idea, tight. No hashtag stuffing. It must stand alone without a link.',
    INSTAGRAM: 'The first line is the hook — the rest is truncated in feed. Links are not clickable, so never say "link below".',
    TIKTOK: 'Spoken-word rhythm, present tense, front-load the hook in the first three words.',
    FACEBOOK: 'Conversational, a little more room to explain. A question at the end earns replies.',
    YOUTUBE: 'First two lines are the description preview. Put the value there, keywords after.',
    MOCK: 'Neutral register.',
  };
  return `Writing for ${platform}. Hard limit ${caps.maxTextLength} characters — stay under it.\n${notes[platform]}`;
}
