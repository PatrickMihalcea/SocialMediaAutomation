import type { NodeType } from '@/lib/workflows/definitions';

export interface WorkflowFieldHelp {
  label: string;
  description: string;
  optionLabels?: Record<string, string>;
  presets?: Array<{ label: string; value: string | number }>;
  /** Long-form prose. Renders as a text area rather than a one-line input. */
  multiline?: boolean;
}

export const TEXT_OVERLAY_STRUCTURES = [
  {
    id: 'numbered',
    label: 'Numbered',
    description: 'Every cut is just its number.',
    example: '1, 2, 3',
  },
  {
    id: 'opening-only',
    label: 'Opening text only',
    description: 'Opening text on the first cut, then nothing.',
    example: 'Which would you choose?',
  },
  {
    id: 'opening-always',
    label: 'Opening text always',
    description: 'The same opening text on every cut.',
    example: 'Which would you choose? on each cut',
  },
  {
    id: 'titles',
    label: 'Titles',
    description: 'Each cut shows its image title, without a file extension.',
    example: 'Canopy house',
  },
  {
    id: 'opening-numbered',
    label: 'Opening text, numbered',
    description: 'Opening text on the first cut, then a number on each one after.',
    example: 'Which would you choose? then 1, 2, 3',
  },
  {
    id: 'numbered-title',
    label: 'Numbered: Title',
    description: 'Every cut is the number, a colon, and the title.',
    example: '1: Canopy house',
  },
  {
    id: 'opening-numbered-title',
    label: 'Opening text, numbered: Title',
    description: 'Opening text on the first cut, then “1: Title” on each one after.',
    example: 'Which would you choose? then 1: Canopy house',
  },
] as const;

export const TEXT_OVERLAY_TOKENS = [
  {
    token: '{index}',
    label: 'Number',
    description: 'The cut number, starting at 1. An opening card is not counted, so the first numbered cut after one is 1.',
  },
  {
    token: '{title}',
    label: 'Title',
    description: 'The short title from an Idea generator or Media library, when Titles ports are connected.',
  },
] as const;

/**
 * Settings both publish steps share. Hashtags and the first comment have
 * matching input ports and say so; mentions and links are typed here only.
 */
const POST_TEXT_HELP: Record<string, WorkflowFieldHelp> = {
  title: {
    label: 'Post title',
    description: 'The title of the post itself, not the name of this step — Name above is only your label for it on the canvas. Connecting the Post title input overrides this. Left empty, the post is listed by its opening copy.',
  },
  hashtags: {
    label: 'Hashtags',
    description: 'Separated by spaces or commas; the # is optional. Connecting the Hashtags input overrides this.',
  },
  firstComment: {
    label: 'First comment',
    description: 'Posted as the first comment on channels that support it, which is where tags usually go. Connecting the First comment input overrides this.',
    multiline: true,
  },
  mentions: {
    label: 'Mentions',
    description: 'Accounts to tag, separated by spaces or commas. Set here rather than generated, since each has to match a real account.',
  },
  link: {
    label: 'Link',
    description: 'A URL to attach where the channel supports one. The same link goes out on every run.',
  },
};

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
      label: 'Ideas for',
      description: 'A prompt for an image reads nothing like a prompt for video or a written post, so this decides how each one is written. Match it to the step you connect Prompts to.',
      // Deliberately not COMMON_OPTIONS: "Image prompts / Content ideas /
      // Video prompts" described three different things in three different
      // grammars, when the only choice being made is what gets made.
      optionLabels: {
        image: 'Images',
        video: 'Video clips',
        text: 'Written posts',
      },
    },
    themeMode: {
      label: 'Where the theme comes from',
      description: 'One fixed subject every run, or one drawn at random from a pool. A connected Theme input overrides both.',
      optionLabels: {
        fixed: 'One fixed theme',
        random: 'Random from a pool',
      },
    },
    theme: {
      label: 'Theme',
      description: 'The subject every idea varies. Connecting the Theme input overrides whatever is typed here.',
      multiline: true,
    },
    themePool: {
      label: 'Theme pool',
      description: 'Themes separated by commas. Each run draws one at random from the whole list, so the same theme can come up twice — the ideas will still differ, because the step is told what it already covered. Each theme can also carry a layout sketch: connect the Layout reference output to an Image generator and the run uses the sketch belonging to the theme it drew. Rewording a theme drops its sketch.',
      multiline: true,
    },
    count: {
      label: 'How many ideas',
      description: 'Each idea becomes one prompt and one title, and each prompt costs a generation in the step you feed.',
    },
    promptGuidance: {
      label: 'How to write the prompts',
      description: 'Direction for the prompts this step writes — what to include, how long, what to avoid, a shot type to favour. The rendering style is not set here; that belongs on the Image generator, which applies it to every image. Leave empty to let the model decide from the theme.',
      multiline: true,
      presets: [
        { label: 'Name the light and the angle', value: 'Every prompt names where the light comes from and the camera angle or point of view.' },
        { label: 'Concrete nouns only', value: 'Describe only what is physically in the frame. No symbolism, no mood words, no adjectives that carry no visual information.' },
        { label: 'Wide establishing shots', value: 'Favour wide establishing shots that show the subject in its surroundings rather than close details.' },
      ],
    },
    titleGuidance: {
      label: 'How to write the post title',
      description: 'Direction for the Post title output — length, tone, a formula to follow. Leave empty to let the model decide from the theme.',
      multiline: true,
      presets: [
        { label: 'Short and plain', value: 'Under 60 characters, plain language, no hype words.' },
        { label: 'Ask a question', value: 'Phrase it as a question the viewer would want answered.' },
      ],
    },
    captionGuidance: {
      label: 'How to write the caption',
      description: 'Direction for the Caption output — length, tone, whether to end on a question or a call to action. Leave empty to let the model decide.',
      multiline: true,
      presets: [
        { label: 'Two sentences, no emoji', value: 'Two sentences at most. No emoji and no hashtags in the caption itself.' },
        { label: 'End on a question', value: 'Two or three sentences, ending on a question that invites replies.' },
        { label: 'Call to action', value: 'Three sentences, ending on a clear call to action.' },
      ],
    },
    hashtagsGuidance: {
      label: 'How to pick hashtags',
      description: 'Direction for the Hashtags output — how many, how broad, tags to always include or avoid. Leave empty for 3 to 8 tags chosen from the theme.',
      multiline: true,
      presets: [
        { label: 'Few and specific', value: 'Three tags at most, specific to the subject rather than broad reach tags.' },
        { label: 'Mix broad and niche', value: 'Six to eight tags, mixing broad reach tags with niche ones.' },
      ],
    },
    additionalOutputs: {
      label: 'Extra outputs',
      description: 'Any other copy you want written from the same brief — a hook, a call to action, a first comment. Each one becomes a connection point on this step. The title, caption and hashtags are already outputs, so they do not need adding here.',
    },
  },
  IMAGE_GENERATOR: {
    style: {
      label: 'Image style',
      description: 'The look every image is rendered in — pixel art, anime, 1960s film photography, a technical illustration. It is appended to every prompt word for word and overrides anything in the prompt that conflicts with it, so a run cannot come back half in one style and half in another. Worth being specific; it can run to several paragraphs.',
      multiline: true,
    },
    size: {
      label: 'Image shape',
      description: 'The OpenAI API offers 2:3, 3:2 and 1:1 only, so a vertical frame has to be cropped out of 2:3. Codex adds a true 9:16 that needs no crop at all — it appears here once this step is set to generate with Codex.',
    },
    maxImages: {
      label: 'Maximum images',
      description: 'A cost guard. Extra incoming prompts are ignored after this number.',
    },
    provider: {
      label: 'Generate with',
      description: 'Codex uses your ChatGPT subscription — no per-image bill, a minute or so, and the only one that renders a true 9:16. API bills your OpenAI key per image and returns in seconds. Mock costs nothing and returns instantly, for testing the workflow.',
      optionLabels: {
        'image-use': 'Codex — ChatGPT subscription',
        openai: 'API — billed per image',
        mock: 'Mock — free placeholder',
      },
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
    useMockGeneration: {
      label: 'Use mock generation',
      description: 'Creates deterministic local test clips instead of calling a video model. The rest of the workflow runs normally.',
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
    structure: {
      label: 'Overlay structure',
      description: 'What appears on each cut. Opening text is the field below, or a connection into Opening text.',
      optionLabels: Object.fromEntries(
        [
          ['numbered', 'Numbered'],
          ['opening-only', 'Opening text only'],
          ['opening-always', 'Opening text always'],
          ['titles', 'Titles'],
          ['opening-numbered', 'Opening text, numbered'],
          ['numbered-title', 'Numbered: Title'],
          ['opening-numbered-title', 'Opening text, numbered: Title'],
        ],
      ),
    },
    firstTemplate: {
      label: 'Opening text',
      description: 'Used when Overlay structure includes opening text. Connecting the Opening text input overrides this, so an Idea generator can write it per run.',
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
    caption: {
      label: 'Caption',
      description: 'Starting caption for every selected channel. Connecting the Caption input overrides it, so an Idea generator can write it instead.',
      multiline: true,
    },
    ...POST_TEXT_HELP,
    campaignId: {
      label: 'Campaign',
      description: 'Optional campaign for the new draft.',
    },
  },
  PUBLISH: {
    caption: {
      label: 'Caption',
      description: 'Caption sent to every selected channel. Connecting the Caption input overrides it, so an Idea generator can write it instead.',
      multiline: true,
    },
    ...POST_TEXT_HELP,
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
    name: 'Rotating subject reel',
    outcome: 'A pool of subjects → one drawn per run → beat-cut vertical video → reviewable draft',
    steps: ['Idea generator on Random from a pool', 'Image generator', 'Media library', 'Select a track', 'Beat slideshow', 'Text overlay', 'Create draft'],
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
