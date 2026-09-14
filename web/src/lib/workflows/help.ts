import type { NodeType } from '@/lib/workflows/definitions';

export interface WorkflowFieldHelp {
  label: string;
  description: string;
  optionLabels?: Record<string, string>;
  presets?: Array<{ label: string; value: string | number }>;
}

export const TEXT_OVERLAY_PRESETS = [
  { label: 'Number', value: '{index}', example: '1' },
  { label: 'Choice number after opening', value: '{choice}', example: '1' },
  { label: 'Title', value: '{title}', example: 'Coastal minimal' },
  { label: 'Number and title', value: '{index}. {title}', example: '1. Coastal minimal' },
  { label: 'No changing text', value: '', example: 'No overlay text' },
] as const;

export const TEXT_OVERLAY_TOKENS = [
  { token: '{index}', label: 'Number', description: 'The cut number, starting at 1.' },
  {
    token: '{choice}',
    label: 'Choice number',
    description: 'Starts at 1 on the second cut, for videos with an opening card.',
  },
  {
    token: '{title}',
    label: 'Title',
    description: 'The short title from an Idea generator or Media library, when Titles ports are connected.',
  },
] as const;

const COMMON_OPTIONS: Record<string, string> = {
  image: 'Image prompts',
  text: 'Content ideas',
  video: 'Video prompts',
  random: 'Choose automatically',
  specific: 'Choose one track',
  cover: 'Fill frame (crop edges)',
  'blur-pad': 'Show full image (blurred background)',
  top: 'Top',
  centre: 'Centre',
  bottom: 'Bottom',
  now: 'Publish immediately',
  queue: 'Use the next queue slot',
  'Archivo-Bold': 'Archivo bold',
  'Archivo-SemiBold': 'Archivo semibold',
  'BebasNeue-Regular': 'Bebas Neue',
};

export const WORKFLOW_FIELD_HELP: Partial<
  Record<NodeType, Record<string, WorkflowFieldHelp>>
> = {
  IDEA_GENERATOR: {
    mode: {
      label: 'What to create',
      description: 'Changes how Bridge88 writes each prompt. Choose the output your next step expects.',
      optionLabels: COMMON_OPTIONS,
    },
    theme: {
      label: 'Theme',
      description: 'The subject shared by every generated idea. A connected Theme input overrides this.',
    },
    count: {
      label: 'Number of ideas',
      description: 'How many prompt-and-title pairs to produce. More items use more downstream generation.',
    },
    styleSuffix: {
      label: 'Instructions for every prompt',
      description: 'Optional shared direction such as palette, lens, setting, or exclusions.',
    },
  },
  IMAGE_GENERATOR: {
    size: {
      label: 'Image shape',
      description: 'The model only offers 2:3, 3:2, and 1:1, so none of them is exactly 9:16. Pick the shape closest to your video format; Beat slideshow then crops to fill or shows the whole image over a blurred backdrop.',
    },
    maxImages: {
      label: 'Maximum images',
      description: 'A cost guard. Extra incoming prompts are ignored after this number.',
    },
  },
  ANIMATE_IMAGE: {
    prompt: {
      label: 'Camera movement',
      description: 'One continuous shot. Custom text is passed to the model as written.',
      presets: [
        { label: 'Slow push in', value: 'Slow cinematic push in, subject stays centred.' },
        { label: 'Gentle orbit', value: 'Gentle camera orbit with natural parallax, subject stays stable.' },
        { label: 'Hold still', value: 'Locked camera, subtle environmental motion only.' },
      ],
    },
    maxClips: {
      label: 'Maximum clips',
      description: 'A cost guard. Extra incoming images are ignored after this number.',
    },
  },
  MEDIA_LIBRARY: {
    folderId: {
      label: 'Source',
      description: 'Choose the whole library, one folder, or one specific image, video, or audio item.',
    },
    includeSubfolders: {
      label: 'Include subfolders',
      description: 'Also load media inside folders nested below the selected folder.',
    },
  },
  MUSIC_SELECTOR: {
    mode: {
      label: 'Track selection',
      description: 'Choose automatically from the library or use one specific track.',
      optionLabels: COMMON_OPTIONS,
    },
    folderId: {
      label: 'Music folder',
      description: 'Optional folder used when Bridge88 chooses automatically.',
    },
    mediaAssetId: {
      label: 'Track',
      description: 'The selected library track. This should be chosen by name, not entered manually.',
    },
    requireBeatGrid: {
      label: 'Require detected beats',
      description: 'Fail instead of estimating beats when the selected track has not been analysed.',
    },
  },
  AUDIO_TRIMMER: {
    mode: {
      label: 'Trim mode',
      description: 'Use a time range for audio or video, or cut audio to musical bars.',
      optionLabels: {
        range: 'Time range',
        bars: 'Musical bars',
      },
    },
    startSeconds: {
      label: 'Start time',
      description: 'Seconds from the beginning. In bars mode, leave empty to use the first detected downbeat.',
    },
    endSeconds: {
      label: 'End time',
      description: 'Seconds from the beginning. Leave empty to use the rest of the asset.',
    },
    bars: {
      label: 'Length in bars',
      description: 'How much music to keep. A bar is four beats in most music.',
      presets: [
        { label: 'Short — 4 bars', value: 4 },
        { label: 'Standard — 8 bars', value: 8 },
        { label: 'Long — 16 bars', value: 16 },
      ],
    },
    snapToDownbeat: {
      label: 'Start on a downbeat',
      description: 'Align the cut to the first beat of a musical bar.',
    },
  },
  BEAT_SLIDESHOW: {
    beatsPerClip: {
      label: 'Pace',
      description: 'How long each image or video clip remains on screen, measured in musical beats.',
      presets: [
        { label: 'Fast — 4 beats per clip', value: 4 },
        { label: 'Balanced — 8 beats per clip', value: 8 },
        { label: 'Slow — 16 beats per clip', value: 16 },
      ],
    },
    size: {
      label: 'Video format',
      description: 'The delivery format of the rendered video.',
    },
    fps: {
      label: 'Frames per second',
      description: '30 works for most social video. Change this only for a specific delivery requirement.',
    },
    fit: {
      label: 'Media fit',
      description: 'Fill frame crops edges. Show full media keeps it intact over a blurred background.',
      optionLabels: COMMON_OPTIONS,
    },
    kenBurns: {
      label: 'Add slow camera movement',
      description: 'Applies alternating zoom movement to still images.',
    },
    visualLeadMs: {
      label: 'Visual timing offset',
      description: 'Moves cuts slightly before the beat to compensate for perceived visual delay.',
    },
    fadeOutSeconds: {
      label: 'Audio fade out',
      description: 'Seconds used to fade the track at the end.',
    },
  },
  COMBINE_MEDIA: {
    sourceOrder: {
      label: 'Source order',
      description: 'Drag the connected media sources into the order they should appear.',
    },
  },
  TEXT_OVERLAY: {
    template: {
      label: 'Text on each cut',
      description: 'Choose a preset or combine fixed words with Number and Title.',
    },
    firstTemplate: {
      label: 'Opening text',
      description: 'Optional text shown only on the first cut. Later cuts use Text on each cut.',
    },
    font: {
      label: 'Typeface',
      description: 'Typeface used for every label.',
      optionLabels: COMMON_OPTIONS,
    },
    position: {
      label: 'Position',
      description: 'Keep important text inside the safe area for app controls.',
      optionLabels: COMMON_OPTIONS,
    },
    fontSize: {
      label: 'Font size',
      // 0 is the renderer's sentinel for "measure it yourself". Presented as a
      // named choice because a size field reading 0 looks like text that will
      // not render at all.
      description: 'Automatic picks the largest size at which the longest label still fits the frame.',
      presets: [
        { label: 'Automatic', value: 0 },
        { label: 'Small — 64 px', value: 64 },
        { label: 'Medium — 96 px', value: 96 },
        { label: 'Large — 128 px', value: 128 },
      ],
    },
  },
  PICK: {
    mode: {
      label: 'Selection',
      description: 'Random choices are stable for the run, including retries.',
      optionLabels: {
        random: 'Random',
        first: 'First items',
        last: 'Last items',
        index: 'Starting at a position',
      },
    },
    count: {
      label: 'Number of items',
      description: 'How many items to send through the Selection output.',
    },
    index: {
      label: 'Starting position',
      description: '0 is the first item. Use -1 for the last item.',
    },
  },
  CREATE_DRAFT: {
    title: { label: 'Draft title', description: 'Internal name used in Bridge88.' },
    caption: { label: 'Caption', description: 'Starting caption for every selected channel.' },
    campaignId: {
      label: 'Campaign',
      description: 'Optional campaign for the new draft.',
    },
  },
  PUBLISH: {
    caption: { label: 'Caption', description: 'Caption sent to every selected channel.' },
    mode: {
      label: 'When approved',
      description: 'Publish immediately or use the next available queue slot.',
      optionLabels: COMMON_OPTIONS,
    },
    requireApproval: {
      label: 'Require approval',
      description: 'Creates a review item instead of publishing without a person checking it.',
    },
  },
};

export const WORKFLOW_RECIPES = [
  {
    name: 'Weekly reel',
    outcome: 'Theme → generated scenes → beat-cut vertical video → reviewable draft',
    steps: ['Idea generator', 'Image generator', 'Media library', 'Select a track', 'Beat slideshow', 'Text overlay', 'Create draft'],
  },
  {
    name: 'Numbered image countdown',
    outcome: 'A ranked list where each cut displays its number and title',
    steps: ['Idea generator', 'Image generator', 'Media library', 'Select a track', 'Beat slideshow', 'Text overlay'],
  },
  {
    name: 'Library image slideshow',
    outcome: 'Existing folder images → repeatable random selection → beat-cut video → reviewable draft',
    steps: ['Media library', 'Select three images', 'Select a track', 'Beat slideshow', 'Create draft'],
  },
  {
    name: 'Mixed-media montage',
    outcome: 'Ordered image and video sources → beat-cut montage with aligned titles',
    steps: ['Media library', 'Select items', 'Combine media', 'Beat slideshow', 'Text overlay'],
  },
  {
    name: 'Approved scheduled publish',
    outcome: 'A rendered video enters review before using the next queue slot',
    steps: ['Generation steps', 'Publish with Require approval on'],
  },
] as const;
