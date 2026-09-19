import { MediaType } from '@prisma/client';
import { z } from 'zod';
import { media, post, text, type PortDefinition } from '@/lib/workflows/ports';
// Leaf module with no server imports, so the canvas can still be rendered.
import { DEFAULT_IMAGE_SIZE, IMAGE_SIZE_VALUES } from '@/lib/ai/image-sizes';
import {
  VIDEO_OUTPUT_SIZE_VALUES,
  resolveVideoOutputDimensions,
  type VideoOutputSize,
} from '@/lib/workflows/video-output-presets';
import { inferOverlayStructure } from '@/lib/workflows/text-overlay-template';

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
 * A generic output (`followsInput`) takes its type from the graph instead, so
 * only rewiring can change it — see ./port-resolution.ts.
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
  /** Kept executable for saved graphs, but hidden from new-workflow surfaces. */
  legacy?: boolean;
}

const IMAGES = [MediaType.IMAGE] as const;
const VIDEOS = [MediaType.VIDEO] as const;
const AUDIO = [MediaType.AUDIO] as const;

/**
 * The written parts of a post that are worth generating, as ports.
 *
 * Copy is what a brief is best placed to write, so each of these can come from
 * upstream or be typed into the step. Mentions and links are deliberately not
 * here: both have to name a specific real account or URL, which a generated
 * brief cannot be trusted to invent, so they stay typed-only settings.
 */
const POST_TEXT_INPUTS: PortDefinition[] = [
  { id: 'title', label: 'Post title', type: text(), description: 'Overrides the title set below.' },
  { id: 'caption', label: 'Caption', type: text(), description: 'Overrides the caption set below.' },
  { id: 'hashtags', label: 'Hashtags', type: text(), description: 'Separate with spaces or commas. Overrides the tags set below.' },
  { id: 'firstComment', label: 'First comment', type: text(), description: 'Posted as the first comment where the channel supports it.' },
];

const POST_TEXT_CONFIG = {
  /**
   * The post's own title, which is not the step's name. The step name is the
   * user's label for a box on the canvas; letting it stand in for the title
   * meant published posts were called things like "Publish to YouTube".
   */
  title: z.string().max(200).default(''),
  caption: z.string().max(5000).default(''),
  hashtags: z.string().max(500).default(''),
  mentions: z.string().max(500).default(''),
  firstComment: z.string().max(5000).default(''),
  link: z.string().max(2000).default(''),
};

const trimmerConfigSchema = z.preprocess(
  (value) => {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if ('mode' in raw) return raw;
    // Every old Audio trimmer config persisted `bars`; an empty config is a
    // newly-added general Trimmer and therefore opens in range mode.
    return { ...raw, mode: 'bars' in raw ? 'bars' : 'range' };
  },
  z.object({
    mode: z.enum(['range', 'bars']).default('range'),
    startSeconds: z.number().min(0).nullable().default(null),
    endSeconds: z.number().min(0).nullable().default(null),
    bars: z.number().int().min(1).max(64).default(8),
    snapToDownbeat: z.boolean().default(true),
  }).superRefine((config, ctx) => {
    if (
      config.mode === 'range'
      && config.endSeconds != null
      && config.endSeconds <= (config.startSeconds ?? 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The end time must be after the start time.',
        path: ['endSeconds'],
      });
    }
  }),
);

const beatSlideshowConfigSchema = z
  .object({
    /** 4 = one bar, punchy. 8 = two bars, the usual for this genre. */
    beatsPerClip: z.number().int().min(1).max(32).default(8),
    size: z.enum(VIDEO_OUTPUT_SIZE_VALUES).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
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
  })
  .superRefine((config, ctx) => {
    if ((config.width == null) !== (config.height == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Video width and height must both be set.',
        path: [config.width == null ? 'width' : 'height'],
      });
    }
  })
  .transform(normalizeBeatSlideshowConfig);

/** Normalises preset size and legacy width/height into one stored shape. */
function normalizeBeatSlideshowConfig(
  config: Record<string, unknown> & {
    beatsPerClip: number;
    size?: VideoOutputSize;
    fps: number;
    fit: 'cover' | 'blur-pad';
    kenBurns: boolean;
    visualLeadMs: number;
    fadeOutSeconds: number;
    width?: number;
    height?: number;
  },
) {
  const { width, height, size, ...rest } = config;
  const resolved = resolveVideoOutputDimensions({ size, width, height });

  if (resolved.size) {
    return { ...rest, size: resolved.size };
  }

  // Non-preset legacy dimensions stay explicit until the user picks a preset.
  return { ...rest, width: resolved.width, height: resolved.height };
}

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
    outputs: [
      { id: 'prompts', label: 'Prompts', type: text(true) },
      {
        id: 'titles',
        label: 'Titles',
        type: text(true),
        description: 'Short titles that can be shown by a text overlay.',
      },
      {
        id: 'postTitle',
        label: 'Post title',
        type: text(),
        description: 'One overall title for the finished post.',
      },
      {
        id: 'caption',
        label: 'Caption',
        type: text(),
        description: 'Caption for the finished post. Connect it to a Publish or Save draft step.',
      },
      {
        id: 'hashtags',
        label: 'Hashtags',
        type: text(),
        description: 'Tags for the finished post, written from the same theme.',
      },
      {
        id: 'theme',
        label: 'Theme used',
        type: text(),
        description: 'The theme this run actually worked from, which is worth connecting when the theme is drawn at random.',
      },
      {
        id: 'reference',
        label: 'Layout reference',
        type: media([...IMAGES]),
        description: 'The sketch paired with the theme this run drew, when it has one. Connect it to an Image generator.',
      },
    ],
    configSchema: z.object({
      /** What the prompts are written to produce — the wording differs a lot. */
      mode: z.enum(['image', 'text', 'video']).default('image'),
      /**
       * Where the theme comes from. Random draws one line out of the pool below
       * at the start of every run, so a page whose subject should keep moving
       * does not need a new workflow per topic. A connected Theme input still
       * wins over both, because a wired value is always the more specific one.
       */
      themeMode: z.enum(['fixed', 'random']).default('fixed'),
      theme: z.string().max(2000).default(''),
      /**
       * Candidate themes for random mode, comma-separated in the panel. Each
       * run draws one uniformly from the whole pool — repeats included, because
       * that is what drawing at random means. Repetition of *ideas* is handled
       * separately, by naming recent titles in the instruction.
       */
      /**
       * Layout sketch per theme, keyed by the theme's own text.
       *
       * Keyed by text rather than by position, so reordering or re-pasting the
       * pool keeps every pairing. The cost is that rewording a theme drops its
       * sketch — visible immediately, because the thumbnail leaves that row
       * with it.
       */
      themeImages: z.record(z.string(), z.string().uuid()).default({}),
      themePool: z.array(z.string().trim().min(1).max(300))
        // 60 was set when the pool was typed one per line, which made a long
        // list tedious enough that nobody built one. A comma-separated box is
        // pasted, not typed, and a real content calendar runs to a few hundred
        // subjects — the cap is here to stop an accidental paste of a document,
        // not to ration themes.
        .max(500, 'A theme pool can hold up to 500 themes.')
        .default([]),
      count: z.number().int().min(1).max(20).default(8),
      /**
       * Per-field direction for the copy this step writes. Empty means the
       * model decides, which is why these are separate from `theme`: the theme
       * says what the post is about, these say how each piece should read.
       */
      // 2000, not 500: these hold pasted prompts, and 500 rejected an ordinary
      // one. Each carries its own message because the generic schema error is
      // no use when three fields on the panel have the same limit.
      /**
       * Direction for the prompts themselves, which had none — the other three
       * guidance fields steer the post copy, and the thing the step exists to
       * write was the one output nobody could say anything about.
       */
      promptGuidance: z.string().max(2_000, 'How to write the prompts must be 2,000 characters or fewer.').default(''),
      titleGuidance: z.string().max(2_000, 'How to write the title must be 2,000 characters or fewer.').default(''),
      captionGuidance: z.string().max(2_000, 'How to write the caption must be 2,000 characters or fewer.').default(''),
      hashtagsGuidance: z.string().max(2_000, 'How to pick hashtags must be 2,000 characters or fewer.').default(''),
      /** Extra, named text fields created as ports on this particular step. */
      additionalOutputs: z.array(z.object({
        id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'Use letters and numbers, starting with a letter.').max(40),
        label: z.string().trim().min(1).max(60),
      })).max(10).default([]),
    }),
  },

  IMAGE_GENERATOR: {
    type: 'IMAGE_GENERATOR',
    label: 'Image generator',
    description: 'Generates one image per prompt and saves them to the media library.',
    category: 'generate',
    icon: 'image',
    inputs: [
      { id: 'prompts', label: 'Prompts', type: text(true), required: true },
      { id: 'titles', label: 'Titles', type: text(true) },
      {
        id: 'reference',
        label: 'Layout reference',
        type: media([...IMAGES]),
        description: 'A rough sketch or frame whose framing and placement every image should follow. Used by Codex only; the API generates from the prompt alone.',
      },
    ],
    outputs: [
      { id: 'images', label: 'Images', type: media([...IMAGES], true) },
      { id: 'titles', label: 'Titles', type: text(true) },
    ],
    configSchema: z.object({
      size: z.enum(IMAGE_SIZE_VALUES).default(DEFAULT_IMAGE_SIZE),
      /**
       * The look every image in the run is rendered in.
       *
       * It lives here rather than on the step that writes the prompts because
       * this is the only place that can guarantee it. A style given to the
       * writer produces eight prompts that each interpret it; appended here it
       * is the same words on every call, so a set cannot come back half pixel
       * art and half photograph — which as a video is simply broken.
       *
       * Generous limit: "pixel art" and four paragraphs pinning down palette,
       * linework and shading are both legitimate uses of this field.
       */
      style: z.string().max(2_000, 'The image style can be up to 2,000 characters.').default(''),
      /** Stops a runaway prompt list from spending the whole month's quota. */
      maxImages: z.number().int().min(1).max(20).default(8),
      /**
       * Where the pixels come from, per step, and the same three everywhere
       * regardless of what the deployment is configured for: mock is free, the
       * API bills per image, and codex spends a ChatGPT subscription and is the
       * only one that renders a true 9:16. Codex is the default because it is
       * the one that costs nothing per image.
       */
      provider: z.enum(['mock', 'openai', 'image-use']).default('image-use'),
      /** Superseded by `provider`; kept so steps saved before it keep mocking. */
      useMockGeneration: z.boolean().default(false),
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
      /** Produces deterministic local clips instead of calling a video model. */
      useMockGeneration: z.boolean().default(false),
    }),
    longRunning: true,
  },

  MEDIA_LIBRARY: {
    type: 'MEDIA_LIBRARY',
    label: 'Media library',
    description: 'Loads one item, one folder, or the whole library and shows only its available media types.',
    category: 'media',
    icon: 'folder-open',
    inputs: [],
    outputs: [
      { id: 'images', label: 'Images', type: media([...IMAGES], true) },
      { id: 'videos', label: 'Videos', type: media([...VIDEOS], true) },
      { id: 'audio', label: 'Audio', type: media([...AUDIO], true) },
      {
        id: 'imageTitles',
        label: 'Titles',
        type: text(true),
        description:
          'The images\u2019 filenames, tidied up, in the same order. Feed a slideshow\u2019s titles to label each cut.',
      },
    ],
    configSchema: z.object({
      /** Empty means the whole workspace library. */
      folderId: z.string().uuid().nullable().default(null),
            /** When set, this one asset takes precedence over folderId. */
            assetId: z.string().uuid().nullable().default(null),
      /** Folder trees are user-facing; selecting a parent normally means its contents. */
      includeSubfolders: z.boolean().default(true),
    }),
  },

  MUSIC_SELECTOR: {
    type: 'MUSIC_SELECTOR',
    label: 'Music',
    description: 'Picks a track from the library. Its beat grid comes with it.',
    category: 'media',
    icon: 'music',
    legacy: true,
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
    label: 'Trimmer',
    description: 'Trims one audio track or video clip with a visual range editor.',
    category: 'utility',
    icon: 'scissors',
    inputs: [{ id: 'audio', label: 'Media', type: media([...AUDIO, ...VIDEOS]), required: true }],
    outputs: [{
      id: 'audio',
      label: 'Media',
      type: media([...AUDIO, ...VIDEOS]),
      followsInput: 'audio',
    }],
    configSchema: trimmerConfigSchema,
  },

  BEAT_SLIDESHOW: {
    type: 'BEAT_SLIDESHOW',
    label: 'Beat slideshow',
    description: 'Plays incoming images and video clips in order, cuts them to the beat, and renders one video.',
    category: 'assemble',
    icon: 'clapperboard',
    inputs: [
      { id: 'images', label: 'Media', type: media([...IMAGES, ...VIDEOS], true), required: true },
      { id: 'audio', label: 'Audio', type: media([...AUDIO]), required: true },
      {
        id: 'titles',
        label: 'Titles',
        type: text(true),
        description: 'Optional labels carried into each cut for a text overlay.',
      },
    ],
    // The cut points travel with the video rather than on a port of their own:
    // they describe this video, and a step given the video can read them back.
    outputs: [{ id: 'video', label: 'Video', type: media([...VIDEOS]) }],
    configSchema: beatSlideshowConfigSchema,
    longRunning: true,
  },

  COMBINE_MEDIA: {
    type: 'COMBINE_MEDIA',
    label: 'Combine media',
    description: 'Combines up to four ordered image or video lists into one sequence.',
    category: 'utility',
    icon: 'list-plus',
    inputs: [
      { id: 'media1', label: 'Media 1', type: media([...IMAGES, ...VIDEOS], true), required: true },
      { id: 'titles1', label: 'Titles 1', type: text(true) },
      { id: 'media2', label: 'Media 2', type: media([...IMAGES, ...VIDEOS], true) },
      { id: 'titles2', label: 'Titles 2', type: text(true) },
      { id: 'media3', label: 'Media 3', type: media([...IMAGES, ...VIDEOS], true) },
      { id: 'titles3', label: 'Titles 3', type: text(true) },
      { id: 'media4', label: 'Media 4', type: media([...IMAGES, ...VIDEOS], true) },
      { id: 'titles4', label: 'Titles 4', type: text(true) },
    ],
    outputs: [
      { id: 'media', label: 'Media', type: media([...IMAGES, ...VIDEOS], true) },
      { id: 'titles', label: 'Titles', type: text(true) },
    ],
    configSchema: z.object({
      sourceOrder: z
        .array(z.enum(['media1', 'media2', 'media3', 'media4']))
        .length(4)
        .default(['media1', 'media2', 'media3', 'media4'])
        .refine((order) => new Set(order).size === 4, 'Each media source must appear once.'),
    }),
  },

  TEXT_OVERLAY: {
    type: 'TEXT_OVERLAY',
    label: 'Text overlay',
    description: 'Burns a label onto each cut — a number, a title, opening text, or a combination.',
    category: 'assemble',
    icon: 'type',
    inputs: [
      { id: 'video', label: 'Video', type: media([...VIDEOS]), required: true },
      {
        id: 'firstTemplate',
        label: 'Opening text',
        type: text(),
        description: 'Overrides the opening text set below, so it can be written per run.',
      },
      {
        id: 'template',
        label: 'Overlay text',
        type: text(),
        description: 'Overrides the repeating overlay chosen under Overlay structure.',
      },
    ],
    outputs: [{ id: 'video', label: 'Video', type: media([...VIDEOS]) }],
    configSchema: z.object({
      structure: z.enum([
        'numbered',
        'opening-only',
        'opening-always',
        'titles',
        'opening-numbered',
        'numbered-title',
        'opening-numbered-title',
      ]).default('numbered'),
      /**
       * Kept so saved steps and a connected Overlay text input still round-trip.
       * Overlay structure is what the panel edits; this is filled in at run time
       * unless something is wired to the Overlay text port.
       */
      template: z.string().max(200).default('{index}'),
      /** Opening line. Used by structures that show opening text. */
      firstTemplate: z.string().max(200).nullable().default(null),
      font: z.enum(['Archivo-Bold', 'Archivo-SemiBold', 'BebasNeue-Regular']).default('Archivo-Bold'),
      position: z.enum(['top', 'centre', 'bottom']).default('top'),
      /** 0 lets the renderer fit the longest label to the safe width. */
      fontSize: z.number().int().min(0).max(240).default(0),
    }),
    longRunning: true,
  },

  PICK: {
    type: 'PICK',
    label: 'Select items',
    description: 'Selects one or more items from a media list, including a repeatable random selection.',
    category: 'utility',
    icon: 'crosshair',
    inputs: [
      {
        id: 'items',
        label: 'Items',
        type: media([...IMAGES, ...VIDEOS, ...AUDIO], true),
        required: true,
      },
      {
        id: 'labels',
        label: 'Titles',
        type: text(true),
        description:
          'Optional titles belonging to the items, one per item. They are reordered with the selection so each title stays on its own item.',
      },
    ],
    outputs: [
      {
        id: 'item',
        label: 'First selected',
        type: media([...IMAGES, ...VIDEOS, ...AUDIO]),
        // Generic: a list of clips picks down to a clip, which a publish step
        // accepts. Without this the wide declared type would be rejected by
        // every single-kind input, which is what a second video-only Pick node
        // was papering over.
        followsInput: 'items',
        description: 'The first selected item, for steps that take one item.',
      },
      {
        id: 'selection',
        label: 'Selection',
        type: media([...IMAGES, ...VIDEOS, ...AUDIO], true),
        followsInput: 'items',
        description: 'Every selected item, for steps that take a list.',
      },
      {
        id: 'labels',
        label: 'Titles',
        type: text(true),
        description: 'The incoming titles, cut down and reordered to match the selection.',
      },
    ],
    configSchema: z.object({
      mode: z.enum(['random', 'first', 'last', 'index']).default('index'),
      count: z.number().int().min(1).max(20).default(1),
      /** Negative positions count from the end, so -1 is the last item. */
      index: z.number().int().min(-20).max(20).default(0),
    }),
  },

  CREATE_DRAFT: {
    type: 'CREATE_DRAFT',
    label: 'Create draft',
    description: 'Puts the finished video into a draft post you can review.',
    category: 'publish',
    icon: 'file-pen-line',
    inputs: [
      { id: 'video', label: 'Video', type: media([...VIDEOS]), required: true },
      ...POST_TEXT_INPUTS,
    ],
    outputs: [{ id: 'post', label: 'Post', type: post() }],
    configSchema: z.object({
      ...POST_TEXT_CONFIG,
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
    inputs: [
      { id: 'video', label: 'Video', type: media([...VIDEOS]), required: true },
      ...POST_TEXT_INPUTS,
    ],
    outputs: [{ id: 'post', label: 'Post', type: post() }],
    configSchema: z.object({
      /** Validated on save and at run time — empty is allowed on a newly added step. */
      socialAccountIds: z.array(z.string().uuid()).default([]),
      ...POST_TEXT_CONFIG,
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

export function isCreatableNodeType(type: string): type is NodeType {
  return isNodeType(type) && !getDefinition(type)?.legacy;
}

export function findPort(
  type: string,
  portId: string,
  direction: 'inputs' | 'outputs',
): PortDefinition | null {
  return getNodePorts(type, undefined, direction).find((p) => p.id === portId) ?? null;
}

/**
 * Values a saved config may still hold from an earlier release.
 *
 * A schema is also a migration: every stored config was written by some past
 * version, and narrowing an enum orphans the rows that used the value you
 * removed. Those rows do not fail politely — parseConfig throws, so a workflow
 * that ran yesterday stops opening, stops saving, and stops running.
 *
 * IMAGE_GENERATOR briefly offered 'default', meaning "follow the deployment".
 * The replacement for a step that said that is the source it would have
 * resolved to.
 */
export function migrateLegacyConfig(type: string, raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const config = raw as Record<string, unknown>;
  if (type === 'IMAGE_GENERATOR' && config.provider === 'default') {
    return { ...config, provider: config.useMockGeneration === true ? 'mock' : 'image-use' };
  }
  if (type === 'TEXT_OVERLAY' && config.structure === undefined) {
    return { ...config, structure: inferOverlayStructure(config) };
  }
  return raw;
}

/** Config parsed through the node's schema, with defaults filled in. */
export function parseConfig(type: string, raw: unknown) {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`Unknown node type "${type}"`);
  return definition.configSchema.parse(migrateLegacyConfig(type, raw ?? {}));
}

/** Ports normally belong to a step type. Idea Generator additionally exposes
 * named text outputs saved in its own config, so a single coordinated brief can
 * feed several later steps without adding bespoke node types. */
export function getNodePorts(
  type: string,
  rawConfig: unknown,
  direction: 'inputs' | 'outputs',
): PortDefinition[] {
  const definition = getDefinition(type);
  if (!definition) return [];
  if (type !== 'IDEA_GENERATOR' || direction !== 'outputs') return definition[direction];
  const config = parseConfig(type, rawConfig) as { additionalOutputs: { id: string; label: string }[] };
  const existing = new Set(definition.outputs.map((port) => port.id));
  return [
    ...definition.outputs,
    ...config.additionalOutputs
      .filter((field) => !existing.has(field.id))
      .map((field) => ({ id: field.id, label: field.label, type: text(), description: 'Generated with the rest of the idea.' })),
  ];
}

/** Minimal channel row passed from the workflow page into the config panel. */
export type WorkflowChannelOption = {
  id: string;
  accountName: string;
  accountHandle: string | null;
  platform: string;
};

export type WorkflowAudioOption = {
  id: string;
  filename: string;
  folderId: string | null;
  bpm: number | null;
  hasBeatGrid: boolean;
};

export type WorkflowMediaFolderOption = {
  id: string;
  name: string;
  parentId: string | null;
  counts: WorkflowMediaCounts;
};

export type WorkflowMediaAssetOption = {
  id: string;
  filename: string;
  folderId: string | null;
  type: MediaType;
};

export type WorkflowMediaCounts = {
  images: number;
  videos: number;
  audio: number;
};

export const PUBLISH_CHANNEL_REQUIRED = 'Choose at least one channel.';

export const THEME_POOL_REQUIRED =
  'Add at least one theme to the pool, or set this step back to one fixed theme.';

export function nodeUsesChannelPicker(type: string): boolean {
  return type === 'PUBLISH' || type === 'CREATE_DRAFT';
}

export function publishRequiresChannels(type: string, config: { socialAccountIds?: string[] }): boolean {
  return type === 'PUBLISH' && (config.socialAccountIds?.length ?? 0) === 0;
}

/** User-safe validation message for a Zod parse failure. */
export function zodValidationMessage(error: z.ZodError, fallback = 'Those settings are not valid for this step.'): {
  message: string;
  fields: Record<string, string[]>;
} {
  const fields = Object.fromEntries(
    Object.entries(error.flatten().fieldErrors).filter(
      (entry): entry is [string, string[]] => Array.isArray(entry[1]),
    ),
  );
  return { message: error.issues[0]?.message ?? fallback, fields };
}

/** Checks whether a node's saved config is complete enough to run. */
export function nodeRunConfigIssue(type: string, nodeName: string, raw: unknown): string | null {
  try {
    const config = parseConfig(type, raw) as { socialAccountIds?: string[] };
    if (publishRequiresChannels(type, config)) {
      return `"${nodeName}" needs at least one channel selected.`;
    }
    return null;
  } catch {
    return `"${nodeName}" has settings that are incomplete.`;
  }
}

/** Checks whether a node's config may be persisted from the editor. */
export function nodeSaveConfigIssue(
  type: string,
  raw: unknown,
): { message: string; fields: Record<string, string[]> } | null {
  try {
    const config = parseConfig(type, raw) as {
      socialAccountIds?: string[];
      themeMode?: string;
      themePool?: string[];
    };
    if (publishRequiresChannels(type, config)) {
      return {
        message: PUBLISH_CHANNEL_REQUIRED,
        fields: { socialAccountIds: [PUBLISH_CHANNEL_REQUIRED] },
      };
    }
    // Caught here rather than at run time: a random theme with nothing to draw
    // from would fail the run an hour later, on a schedule, with nobody watching.
    if (type === 'IDEA_GENERATOR' && config.themeMode === 'random' && !config.themePool?.length) {
      return {
        message: THEME_POOL_REQUIRED,
        fields: { themePool: [THEME_POOL_REQUIRED] },
      };
    }
    return null;
  } catch (error) {
    if (error instanceof z.ZodError) return zodValidationMessage(error);
    return { message: 'Those settings are not valid for this step.', fields: {} };
  }
}

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  generate: 'Generate',
  media: 'Media',
  assemble: 'Assemble',
  publish: 'Publish',
  utility: 'Utility',
};
