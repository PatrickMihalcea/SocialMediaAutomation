/**
 * The render contract.
 *
 * A RenderPlan is a pure value: no ids, no database, no storage. Everything
 * interesting — beat arithmetic, frame quantisation, text wrapping, Ken Burns
 * direction — is decided while building one, which means all of it is testable
 * on a machine with no ffmpeg installed. The driver only encodes.
 */

export interface RenderImage {
  /** Already cover-cropped and supersampled by the layout step. */
  bytes: Buffer;
  mimeType: string;
}

export interface KenBurns {
  fromZoom: number;
  toZoom: number;
}

export interface TextOverlay {
  /** Already wrapped — newlines are literal. The driver does no layout. */
  text: string;
  fontFile: string;
  fontSize: number;
  colour: string;
  strokeWidth: number;
  strokeColour: string;
  lineSpacing: number;
  /** ffmpeg expressions, so the driver can centre without glyph metrics. */
  x: string;
  y: string;
}

export interface RenderSegment {
  imageIndex: number;
  startFrame: number;
  /** Exclusive. Segments tile [0, totalFrames) with no gap and no overlap. */
  endFrame: number;
  overlays: TextOverlay[];
  motion: KenBurns | null;
}

/**
 * An overlay whose text has been written to a file.
 *
 * drawtext escapes its text twice — once at filtergraph level, once inside the
 * filter — and `: ' \ , [ ] % ;` all bite. A user-supplied room name will
 * eventually contain one of them, so the text goes to a file and the escaping
 * surface shrinks to a path we control.
 */
export interface ResolvedTextOverlay extends TextOverlay {
  textFile: string;
}

export type ResolvedSegment = Omit<RenderSegment, 'overlays'> & {
  overlays: ResolvedTextOverlay[];
};

/** A plan whose overlay text has been materialised to disk by the driver. */
export type ResolvedRenderPlan = Omit<RenderPlan, 'segments'> & {
  segments: ResolvedSegment[];
};

export interface RenderAudio {
  bytes: Buffer;
  mimeType: string;
  /** Seconds into the source file, in the beat grid's own time base. */
  startSeconds: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  /** 2 keeps zoompan's integer crop origin from visibly jerking. */
  supersample: number;
  images: RenderImage[];
  segments: RenderSegment[];
  audio: RenderAudio | null;
  /** Trades throughput for byte-reproducible output. */
  deterministic: boolean;
}

export interface RenderResult {
  data: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  durationSeconds: number;
  /** e.g. `ffmpeg-n7.1/x264/threads-4`. Scopes a golden-file hash. */
  renderer: string;
}

export interface VideoRenderer {
  readonly name: 'ffmpeg' | 'none';
  /** Checked, not assumed: a static ffmpeg without libfreetype has no drawtext. */
  isAvailable(): Promise<boolean>;
  render(plan: RenderPlan): Promise<RenderResult>;
}

/** What a BEAT_SLIDESHOW step hands its downstream overlay node. */
export interface BeatSegment {
  index: number;
  imageAssetId: string;
  startFrame: number;
  endFrame: number;
  startSeconds: number;
  endSeconds: number;
  /** Carried from the idea step, so an overlay can label by name. */
  title: string | null;
}
