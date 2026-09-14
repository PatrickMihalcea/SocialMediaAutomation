import { MediaType } from '@prisma/client';
import { z } from 'zod';
import { json, media, post, text, type PortDefinition } from '@/lib/workflows/ports';

/**
 * The node catalogue.
 *
 * Deliberately free of server imports: the canvas needs port shapes and config
 * schemas to validate a connection before the user lets go of the mouse, and to
 * render the config panel. The executors live in ./executors.ts and are loaded
 * lazily on the server only — rendering a canvas must not pull ffmpeg, sharp and
 * the OpenAI SDK into the request.
 *
 * Port shapes are static per node type, never derived from config. If they
 * varied, an edge's validity would change whenever someone edited a setting.
 */

export type NodeCategory = 'generate' | 'media' | 'assemble' | 'publish' | 'utility';

export interface NodeDefinition {
  type: string;
  label: string;
  /** One sentence, shown in the palette and under the node title. */
  description: string;
  category: NodeCategory;
  /** Lucide glyph — the kit ships no brand marks. */
  icon: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  configSchema: z.ZodTypeAny;
  /** Long-running nodes get a wider retry budget and a heartbeat. */
  longRunning?: boolean;
}

const IMAGES = [MediaType.IMAGE] as const;
const VIDEOS = [MediaType.VIDEO] as const;
const AUDIO = [MediaType.AUDIO] as const;

export const NODE_DEFINITIONS = {
  IDEA_GENERATOR: {
    type: 'IDEA_GENERATOR',
    label: 'Idea generator',
    description: 'Turns a theme into detailed prompts, one per item you want made.',
    category: 'generate',
    icon: 'lightbulb',
    inputs: [
      { id: 'theme', label: 'Theme', type: text(), description: 'Overrides the theme set below.' },
    ],
    outputs: [{ id: 'prompts', label: 'Prompts', type: text(true) }],
    configSchema: z.object({
      /** What the prompts are written to produce — the wording differs a lot. */
      mode: z.enum(['image', 'text', 'video']).default('image'),
      theme: z.string().max(2000).default(''),
      count: z.number().int().min(1).max(20).default(8),
      /** Appended to every prompt; the old pipeline hardcoded a 4k-realism suffix. */
      styleSuffix: z.string().max(500).default(''),
    }),
  },

  IMAGE_GENERATOR: {
    type: 'IMAGE_GENERATOR',
    label: 'Image generator',
    description: 'Generates one image per prompt and saves them to the media library.',
    category: 'generate',
    icon: 'image',
    inputs: [{ id: 'prompts', label: 'Prompts', type: text(true), required: true }],
    outputs: [{ id: 'images', label: 'Images', type: media([...IMAGES], true) }],
    configSchema: z.object({
      size: z.enum(['1024x1024', '1024x1536', '1536x1024']).default('1024x1536'),
      /** Stops a runaway prompt list from spending the whole month's quota. */
      maxImages: z.number().int().min(1).max(20).default(8),
    }),
    longRunning: true,
  },

  ANIMATE_IMAGE: {
    type: 'ANIMATE_IMAGE',
    label: 'Animate image',
    description: 'Turns each still into a short clip with real depth motion.',
    category: 'generate',
    icon: 'wand-sparkles',
    inputs: [{ id: 'images', label: 'Images', type: media([...IMAGES], true), required: true }],
    outputs: [{ id: 'clips', label: 'Clips', type: media([...VIDEOS], true) }],
    configSchema: z.object({
      prompt: z.string().max(1000).default('Slow cinematic push in, subject stays centred.'),
      maxClips: z.number().int().min(1).max(12).default(8),
    }),
    longRunning: true,
  },

  MUSIC_SELECTOR: {
    type: 'MUSIC_SELECTOR',
    label: 'Music',
    description: 'Picks a track from the library. Its beat grid comes with it.',
    category: 'media',
    icon: 'music',
    inputs: [],
    outputs: [{ id: 'audio', label: 'Audio', type: media([...AUDIO]) }],
    configSchema: z
      .object({
        mode: z.enum(['random', 'specific']).default('random'),
        /** Random picks from this folder; empty means the whole library. */
        folderId: z.string().uuid().nullable().default(null),
        mediaAssetId: z.string().uuid().nullable().default(null),
        /** Refuse tracks with no detected grid, rather than cutting to a guess. */
        requireBeatGrid: z.boolean().default(false),
      })
      .refine((c) => c.mode !== 'specific' || Boolean(c.mediaAssetId), {
        message: 'Choose a track, or switch this node back to picking at random.',
        path: ['mediaAssetId'],
      }),
  },

  AUDIO_TRIMMER: {
    type: 'AUDIO_TRIMMER',
    label: 'Audio trimmer',
    description: 'Cuts the track to a bar count, snapped to a downbeat.',
    category: 'media',
    icon: 'scissors',
    inputs: [{ id: 'audio', label: 'Audio', type: media([...AUDIO]), required: true }],
    outputs: [{ id: 'audio', label: 'Audio', type: media([...AUDIO]) }],
    configSchema: z.object({
      /** Null means "find the drop" from per-beat onset strength. */
      startSeconds: z.number().min(0).nullable().default(null),
      bars: z.number().int().min(1).max(64).default(8),
      snapToDownbeat: z.boolean().default(true),
    }),
  },

  BEAT_SLIDESHOW: {
    type: 'BEAT_SLIDESHOW',
    label: 'Beat slideshow',
    description: 'Cuts the images to the beat of the track and renders one video.',
    category: 'assemble',
    icon: 'clapperboard',
    inputs: [
      { id: 'images', label: 'Images', type: media([...IMAGES], true), required: true },
      { id: 'audio', label: 'Audio', type: media([...AUDIO]), required: true },
    ],
    outputs: [
      { id: 'video', label: 'Video', type: media([...VIDEOS]) },
      {
        id: 'segments',
        label: 'Segments',
        type: json('beat-segments'),
        description: 'Cut boundaries, so an overlay can change text on the beat.',
      },
    ],
    configSchema: z.object({
      /** 4 = one bar, punchy. 8 = two bars, the usual for this genre. */
      beatsPerClip: z.number().int().min(1).max(32).default(8),
      width: z.number().int().default(1080),
      height: z.number().int().default(1920),
      fps: z.number().int().min(24).max(60).default(30),
      /**
       * cover crops to fill, which loses the sides of a 2:3 image on a 9:16
       * canvas. blur-pad keeps the whole composition over a blurred backdrop.
       */
      fit: z.enum(['cover', 'blur-pad']).default('cover'),
      kenBurns: z.boolean().default(true),
      /** Visual lead in ms: a cut exactly on the transient can read a hair late. */
      visualLeadMs: z.number().int().min(0).max(200).default(0),
      fadeOutSeconds: z.number().min(0).max(5).default(1.2),
    }),
    longRunning: true,
  },

  TEXT_OVERLAY: {
    type: 'TEXT_OVERLAY',
    label: 'Text overlay',
    description: 'Burns a label onto each cut — a number, a name, or both.',
    category: 'assemble',
    icon: 'type',
    inputs: [
      { id: 'video', label: 'Video', type: media([...VIDEOS]), required: true },
      { id: 'segments', label: 'Segments', type: json('beat-segments'), required: true },
    ],
    outputs: [{ id: 'video', label: 'Video', type: media([...VIDEOS]) }],
    configSchema: z.object({
      /** {index} is the 1-based cut number; {title} is the prompt's own title. */
      template: z.string().max(200).default('{index}'),
      font: z.enum(['Archivo-Bold', 'Archivo-SemiBold', 'BebasNeue-Regular']).default('Archivo-Bold'),
      position: z.enum(['top', 'centre', 'bottom']).default('top'),
      /** 0 lets the renderer fit the longest label to the safe width. */
      fontSize: z.number().int().min(0).max(240).default(0),
    }),
    longRunning: true,
  },

  PICK: {
    type: 'PICK',
    label: 'Pick one',
    description: 'Takes a single item out of a list.',
    category: 'utility',
    icon: 'crosshair',
    inputs: [{ id: 'items', label: 'Items', type: media([...IMAGES, ...VIDEOS, ...AUDIO], true), required: true }],
    outputs: [{ id: 'item', label: 'Item', type: media([...IMAGES, ...VIDEOS, ...AUDIO]) }],
    configSchema: z.object({
      /** Negative counts from the end, so -1 is the last item. */
      index: z.number().int().min(-20).max(20).default(0),
    }),
  },

  CREATE_DRAFT: {
    type: 'CREATE_DRAFT',
    label: 'Create draft',
    description: 'Puts the finished video into a draft post you can review.',
    category: 'publish',
    icon: 'file-pen-line',
    inputs: [{ id: 'video', label: 'Video', type: media([...VIDEOS]), required: true }],
    outputs: [{ id: 'post', label: 'Post', type: post() }],
    configSchema: z.object({
      title: z.string().max(200).default(''),
      caption: z.string().max(5000).default(''),
      campaignId: z.string().uuid().nullable().default(null),
      socialAccountIds: z.array(z.string().uuid()).default([]),
    }),
  },

  PUBLISH: {
    type: 'PUBLISH',
    label: 'Publish',
    description: 'Sends the finished video to the channels you choose.',
    category: 'publish',
    icon: 'send',
    inputs: [{ id: 'video', label: 'Video', type: media([...VIDEOS]), required: true }],
    outputs: [{ id: 'post', label: 'Post', type: post() }],
    configSchema: z.object({
      socialAccountIds: z.array(z.string().uuid()).min(1),
      caption: z.string().max(5000).default(''),
      /** queue takes the next open slot from the workspace's posting times. */
      mode: z.enum(['now', 'queue']).default('queue'),
      /** An unattended run publishing straight to a real account is opt-in. */
      requireApproval: z.boolean().default(true),
    }),
  },
} as const satisfies Record<string, NodeDefinition>;

export type NodeType = keyof typeof NODE_DEFINITIONS;

export const NODE_TYPES = Object.keys(NODE_DEFINITIONS) as NodeType[];

export function getDefinition(type: string): NodeDefinition | null {
  return (NODE_DEFINITIONS as Record<string, NodeDefinition>)[type] ?? null;
}

export function isNodeType(type: string): type is NodeType {
  return type in NODE_DEFINITIONS;
}

export function findPort(
  type: string,
  portId: string,
  direction: 'inputs' | 'outputs',
): PortDefinition | null {
  return getDefinition(type)?.[direction].find((p) => p.id === portId) ?? null;
}

/** Config parsed through the node's schema, with defaults filled in. */
export function parseConfig(type: string, raw: unknown) {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`Unknown node type "${type}"`);
  return definition.configSchema.parse(raw ?? {});
}

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  generate: 'Generate',
  media: 'Media',
  assemble: 'Assemble',
  publish: 'Publish',
  utility: 'Utility',
};
