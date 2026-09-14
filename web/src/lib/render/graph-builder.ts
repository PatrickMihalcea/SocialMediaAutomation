import type { RenderPlan, ResolvedRenderPlan, ResolvedTextOverlay } from '@/lib/render/types';

/**
 * Builds the ffmpeg filter graph for a plan.
 *
 * Pure string construction, so the whole thing is snapshot-testable on a machine
 * with no ffmpeg — which catches every escaping and expression regression for
 * free, and those are the bugs that otherwise surface as a corrupt video.
 *
 * One graph, one encode. Chaining passes would re-encode intermediates, and each
 * extra H.264 pass is both a quality loss and a fresh source of nondeterminism,
 * because x264's rate control depends on thread scheduling.
 */
export function buildFilterGraph(plan: ResolvedRenderPlan): string {
  const { width, height, fps, supersample } = plan;
  const superW = width * supersample;
  const superH = height * supersample;
  const lines: string[] = [];

  plan.segments.forEach((segment, index) => {
    const frames = segment.endFrame - segment.startFrame;
    lines.push(
      `[${index}:v]${zoompan(segment.motion, frames, superW, superH, fps)},` +
        `scale=${width}:${height}:flags=lanczos,setsar=1,format=rgb24[c${index}]`,
    );
  });

  const inputs = plan.segments.map((_, i) => `[c${i}]`).join('');
  lines.push(`${inputs}concat=n=${plan.segments.length}:v=1:a=0[seq]`);

  // Overlays stay on rgb24 and convert to yuv420p only at the very end: drawing
  // antialiased text with a border straight onto chroma-subsampled planes
  // visibly degrades the edges.
  const draws = plan.segments.flatMap((segment) =>
    segment.overlays.map((overlay) => drawtext(overlay, segment.startFrame, segment.endFrame)),
  );
  const videoChain = [...draws, `setpts=N/${fps}/TB`, 'format=yuv420p'].join(',');
  lines.push(`[seq]${videoChain}[v]`);

  if (plan.audio) {
    lines.push(audioChain(plan, plan.segments.length));
  }

  return lines.join(';\n');
}

/**
 * Ken Burns.
 *
 * Three zoompan traps are handled here, each of which silently produces wrong
 * output rather than an error:
 *  - `s=` defaults to hd720, not to the input size, so an unset value squashes
 *    the supersampled canvas to 1280x720.
 *  - `fps=` defaults to 25; leaving it mismatched duplicates or drops frames
 *    downstream, which lands the cuts on the wrong frames.
 *  - The widely copied recursive form `z='zoom+0.001'` is an accumulator seeded
 *    from the previous output, so it pops at clip starts. The closed form over
 *    `on` (the output frame index) is stable and bounded.
 *
 * zoompan truncates its crop origin to whole pixels, which is the notorious
 * jitter. Running it on a supersampled canvas and scaling down afterwards turns
 * that whole-pixel step into a sub-pixel one.
 */
function zoompan(
  motion: ResolvedRenderPlan['segments'][number]['motion'],
  frames: number,
  width: number,
  height: number,
  fps: number,
): string {
  const last = Math.max(1, frames - 1);
  const delta = motion ? motion.toZoom - motion.fromZoom : 0;
  const sign = delta < 0 ? '-' : '+';
  const z = motion
    ? `${motion.fromZoom.toFixed(4)}${sign}${Math.abs(delta).toFixed(4)}*on/${last}`
    : '1';
  return (
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
    `:d=${frames}:s=${width}x${height}:fps=${fps}`
  );
}

/**
 * `enable` uses the integer frame index rather than a time range on purpose:
 * `between()` is inclusive at both ends, so consecutive overlays expressed in
 * seconds both draw on the shared boundary frame and stack on top of each other.
 */
function drawtext(overlay: ResolvedTextOverlay, startFrame: number, endFrame: number): string {
  const parts = [
    `fontfile=${escapeValue(overlay.fontFile)}`,
    `textfile=${escapeValue(overlay.textFile)}`,
    `fontsize=${overlay.fontSize}`,
    `fontcolor=${overlay.colour}`,
    `borderw=${overlay.strokeWidth}`,
    `bordercolor=${overlay.strokeColour}`,
    `line_spacing=${overlay.lineSpacing}`,
    // Plain advances rather than harfbuzz shaping: it matches how the width was
    // measured and removes a harfbuzz-version variable from the output.
    'text_shaping=0',
    'reload=0',
    `x=${overlay.x}`,
    `y=${overlay.y}`,
    `enable='between(n,${startFrame},${endFrame - 1})'`,
  ];
  return `drawtext=${parts.join(':')}`;
}

/**
 * `atrim` rather than an input-level `-ss`: seeking an mp3 before the decoder
 * depends on how the build handles encoder-delay side data, which varies between
 * ffmpeg versions. Trimming decoded samples is stable.
 */
function audioChain(plan: ResolvedRenderPlan, inputIndex: number): string {
  const audio = plan.audio!;
  const total = plan.totalFrames / plan.fps;
  const fadeOutStart = Math.max(0, total - audio.fadeOutSeconds);
  return (
    `[${inputIndex}:a]atrim=start=${audio.startSeconds.toFixed(6)},asetpts=PTS-STARTPTS,` +
    // The short fade-in is not decoration: cutting mid-waveform clicks.
    `afade=t=in:st=0:d=${audio.fadeInSeconds.toFixed(3)},` +
    `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${audio.fadeOutSeconds.toFixed(3)},` +
    `aresample=48000:first_pts=0,` +
    // Guarantees audio never outruns video, so -shortest is not needed.
    `atrim=0:${total.toFixed(6)},asetpts=PTS-STARTPTS[a]`
  );
}

/** Colons and backslashes are filtergraph separators and must be escaped. */
function escapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** The encoder arguments, split out so the driver and the tests agree on them. */
export function buildEncoderArgs(plan: Pick<RenderPlan, 'fps' | 'audio' | 'deterministic'>): string[] {
  return [
    '-map', '[v]',
    ...(plan.audio ? ['-map', '[a]'] : []),
    '-r', String(plan.fps),
    '-c:v', 'libx264',
    '-preset', plan.deterministic ? 'slow' : 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-level', '4.0',
    '-g', String(plan.fps * 2),
    '-keyint_min', String(plan.fps * 2),
    '-sc_threshold', '0',
    // Multi-threaded x264 is not bit-reproducible: frame-level parallelism
    // changes rate-control decisions. threads=1 is the only thread-count
    // independent setting, at roughly 5x the cost.
    '-x264-params', plan.deterministic ? 'threads=1:sliced-threads=0' : 'threads=4:deterministic=1',
    ...(plan.audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []),
    '-movflags', '+faststart',
    // Without these ffmpeg stamps its version and a creation time into the
    // stream, so every upgrade would change the output bytes.
    '-fflags', '+bitexact',
    '-flags', '+bitexact',
    '-map_metadata', '-1',
    '-video_track_timescale', String(plan.fps * 1000),
  ];
}

/**
 * Overlay graph for an already-assembled video.
 *
 * Uses `overlay` with pre-rendered PNGs rather than `drawtext`, because
 * `drawtext` needs an ffmpeg built with libfreetype and plenty of builds — the
 * current Homebrew formula among them — omit it. `overlay` is core, so this path
 * works on every build and produces the same result everywhere.
 */
export function buildOverlayGraph(input: {
  fps: number;
  segments: { startFrame: number; endFrame: number }[];
}): string {
  let stream = '[0:v]';
  const lines: string[] = [];

  input.segments.forEach((segment, index) => {
    const label = index === input.segments.length - 1 ? '[v]' : `[o${index}]`;
    lines.push(
      `${stream}[${index + 1}:v]overlay=0:0:enable='between(n,${segment.startFrame},${segment.endFrame - 1})'${label}`,
    );
    stream = `[o${index}]`;
  });

  return lines.join(';\n');
}
