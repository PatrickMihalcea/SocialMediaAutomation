import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from '@/lib/env';
import { AudioAnalysisError, MAX_CACHED_BEATS, type AudioAnalyzer, type BeatGrid } from '@/lib/audio/types';

const run = promisify(execFile);

interface ScriptOutput {
  gridVersion: number;
  analyzer: string;
  durationSeconds: number;
  bpm: number;
  beatsPerBar: number;
  quantised: boolean;
  beats: number[];
  downbeats: number[];
  beatStrength: number[];
  downbeatConfidence: number;
}

/**
 * Shells out to scripts/analyze_audio.py.
 *
 * The environment overrides are not optional: the thread pinning must reach the
 * child process or numpy's BLAS reductions stop being bit-reproducible, and the
 * default 1 MB stdout buffer is smaller than a long track's beat array.
 */
export class LibrosaAnalyzer implements AudioAnalyzer {
  readonly name = 'librosa' as const;
  private available: boolean | null = null;

  private scriptPath(): string {
    return env.AUDIO_ANALYZER_SCRIPT || path.join(process.cwd(), 'scripts', 'analyze_audio.py');
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await access(this.scriptPath());
      // Importing librosa is the real test — the interpreter existing is not.
      await run(env.PYTHON_BIN, ['-c', 'import librosa, soundfile, numpy'], { timeout: 60_000 });
      this.available = true;
    } catch {
      console.warn(
        `[audio] ${env.PYTHON_BIN} cannot import librosa — beat grids will fall back to a constant tempo`,
      );
      this.available = false;
    }
    return this.available;
  }

  async analyze(input: { audio: Buffer; filename: string; hintBpm?: number }): Promise<BeatGrid> {
    const dir = await mkdtemp(path.join(tmpdir(), 'b88-audio-'));
    const file = path.join(dir, input.filename.replace(/[^\w.-]/g, '_') || 'track.mp3');
    try {
      await writeFile(file, input.audio);

      const args = [this.scriptPath(), '--input', file, '--max-beats', String(MAX_CACHED_BEATS)];
      if (input.hintBpm && input.hintBpm > 0) args.push('--hint-bpm', String(input.hintBpm));

      const { stdout } = await run(env.PYTHON_BIN, args, {
        env: {
          ...process.env,
          OMP_NUM_THREADS: '1',
          OPENBLAS_NUM_THREADS: '1',
          MKL_NUM_THREADS: '1',
          NUMEXPR_NUM_THREADS: '1',
          VECLIB_MAXIMUM_THREADS: '1',
          PYTHONHASHSEED: '0',
          NUMBA_CACHE_DIR: dir,
        },
        timeout: 120_000,
        killSignal: 'SIGKILL',
        // Node defaults to 1 MB; a long track's grid exceeds it and the error
        // you get is ENOBUFS rather than anything about the audio.
        maxBuffer: 8 * 1024 * 1024,
      });

      const parsed = JSON.parse(stdout) as ScriptOutput;
      return {
        beats: parsed.beats,
        downbeats: parsed.downbeats,
        beatStrength: parsed.beatStrength,
        bpm: parsed.bpm,
        beatsPerBar: parsed.beatsPerBar,
        durationSeconds: parsed.durationSeconds,
        confidence: parsed.downbeatConfidence,
        analyzer: parsed.analyzer,
        version: parsed.gridVersion,
      };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error('[audio] librosa analysis failed', detail);
      throw new AudioAnalysisError('Bridge88 could not work out the beat of that track.', {
        // A timeout or a killed process is worth one more go; a decode failure
        // will fail identically every time.
        retryable: /timed out|SIGKILL|ETIMEDOUT/i.test(detail),
        cause,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
