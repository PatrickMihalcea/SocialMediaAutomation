import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    IMAGE_USE_BIN: '',
    IMAGE_USE_PYTHON: '',
    IMAGE_USE_BACKEND: 'auto',
    IMAGE_USE_FORMAT: 'png',
    IMAGE_USE_STYLE: '',
    IMAGE_USE_TIMEOUT_MS: 30_000,
    IMAGE_USE_QUEUE_WAIT_MS: 5_000,
  },
}));

import { ImageUseProvider } from '@/lib/ai/providers/image-use';
import { AiCredentialError, AiError } from '@/lib/ai/types';
import { env } from '@/lib/env';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/**
 * A stand-in for the real CLI, run as a real child process.
 *
 * The contract being tested is entirely about that boundary — argument order,
 * the `--` that keeps a prompt out of the subcommand table, stdout carrying the
 * saved path, a non-zero exit — and a mocked `spawn` would assert the wrapper
 * against itself rather than against a process.
 */
const workspace = mkdtempSync(join(tmpdir(), 'image-use-test-'));
const cli = join(workspace, 'image-use');
const argvLog = join(workspace, 'argv.json');

writeFileSync(
  cli,
  `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
const mode = process.env.FAKE_MODE || 'ok';
if (mode === 'hang') { setTimeout(() => {}, 60000); return; }
if (mode === 'fail') {
  process.stderr.write('[  1.2s] submitting\\n' + process.env.FAKE_STDERR + '\\n');
  process.exit(1);
}
const out = process.argv[process.argv.indexOf('--out') + 1];
fs.writeFileSync(out, Buffer.from('${PNG.toString('hex')}', 'hex'));
process.stderr.write('[ 12.3s] \\u2713 saved \\u2192 ' + out + '  (8 bytes)  size=1024x1536  model=gpt-image-2-codex  tokens=1500 (in 1200 / out 300)\\n');
process.stdout.write(out + '\\n');
`,
  { mode: 0o755 },
);
chmodSync(cli, 0o755);

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function lastArgv(): string[] {
  return JSON.parse(readFileSync(argvLog, 'utf8'));
}

describe('ImageUseProvider', () => {
  beforeEach(() => {
    process.env.FAKE_ARGV_LOG = argvLog;
    process.env.FAKE_MODE = 'ok';
    delete process.env.FAKE_STDERR;
    env.IMAGE_USE_BIN = cli;
    env.IMAGE_USE_PYTHON = '';
    env.IMAGE_USE_BACKEND = 'auto';
    env.IMAGE_USE_FORMAT = 'png';
    env.IMAGE_USE_STYLE = '';
    env.IMAGE_USE_TIMEOUT_MS = 30_000;
    env.IMAGE_USE_QUEUE_WAIT_MS = 5_000;
  });

  it('reports itself unconfigured, and says which variable is missing', async () => {
    env.IMAGE_USE_BIN = '';

    expect(new ImageUseProvider().isConfigured()).toBe(false);
    await expect(new ImageUseProvider().generateImage({ prompt: 'a cat' })).rejects.toThrow(
      /IMAGE_USE_BIN/,
    );
  });

  it('runs the CLI and returns the bytes it saved', async () => {
    const result = await new ImageUseProvider().generateImage({ prompt: 'a cat', size: '1024x1536' });

    expect(result.data).toEqual(PNG);
    expect(result.mimeType).toBe('image/png');
    const argv = lastArgv();
    expect(argv).toContain('--quiet');
    expect(argv.slice(argv.indexOf('--size'), argv.indexOf('--size') + 2)).toEqual([
      '--size',
      '1024x1536',
    ]);
    expect(argv.slice(argv.indexOf('--backend'), argv.indexOf('--backend') + 2)).toEqual([
      '--backend',
      'auto',
    ]);
    // Seconds, not milliseconds — the CLI reads --timeout as seconds and 30000
    // of them is eight hours.
    expect(argv[argv.indexOf('--timeout') + 1]).toBe('30');
  });

  /**
   * The CLI dispatches on its first argument, so a brief opening with one of
   * its subcommand words has to arrive as a positional or it silently runs
   * something else — `image-use doctor` prints a diagnostic and no image.
   */
  it('keeps a prompt that starts with a subcommand word out of the subcommand table', async () => {
    await new ImageUseProvider().generateImage({ prompt: 'doctor examining a cat' });

    const argv = lastArgv();
    expect(argv[0]).toBe('--quiet');
    expect(argv.at(-2)).toBe('--');
    expect(argv.at(-1)).toBe('doctor examining a cat');
  });

  it('stacks every saved style named in the environment', async () => {
    env.IMAGE_USE_STYLE = 'mascot, watercolor ,';

    await new ImageUseProvider().generateImage({ prompt: 'a cat' });

    const argv = lastArgv();
    expect(argv.filter((_, index) => argv[index - 1] === '--style')).toEqual([
      'mascot',
      'watercolor',
    ]);
  });

  it('runs through an explicit interpreter when one is configured', async () => {
    env.IMAGE_USE_PYTHON = process.execPath;

    const result = await new ImageUseProvider().generateImage({ prompt: 'a cat' });

    expect(result.data).toEqual(PNG);
  });

  /** The codex backend is the only one that reports either; both end up in the cost column. */
  it('records the model and token count the CLI reported', async () => {
    const result = await new ImageUseProvider().generateImage({ prompt: 'a cat' });

    expect(result.model).toBe('gpt-image-2-codex');
    expect(result.usage).toEqual({ totalTokens: 1500, promptTokens: 1200, completionTokens: 300 });
  });

  it('surfaces a failed run as an AiError carrying the CLI complaint', async () => {
    process.env.FAKE_MODE = 'fail';
    process.env.FAKE_STDERR = 'error: no image returned. events seen: reasoning';

    await expect(new ImageUseProvider().generateImage({ prompt: 'a cat' })).rejects.toThrow(
      /no image returned/,
    );
  });

  /**
   * The failure mode this guards against is a bill, not a crash: if a stale
   * credential quietly fell through to the paid API, the first sign would be
   * an invoice. So it stops, says nothing was charged, and says how to fix it.
   */
  it('turns a credential failure into instructions rather than a retry', async () => {
    process.env.FAKE_MODE = 'fail';
    for (const stderr of [
      'refresh_token is no longer valid — run codex login again',
      'HTTP 401: {"detail":"unauthorized"}',
      'error: ~/.codex/auth.json not found',
      'error: no ChatGPT OAuth access_token in ~/.codex/auth.json',
    ]) {
      process.env.FAKE_STDERR = stderr;
      const failure = await new ImageUseProvider()
        .generateImage({ prompt: 'a cat' })
        .catch((error: AiCredentialError) => error);

      expect(failure).toBeInstanceOf(AiCredentialError);
      expect((failure as AiCredentialError).retryable).toBe(false);
      expect((failure as AiCredentialError).message).toMatch(/nothing was charged to the OpenAI API/);
      expect((failure as AiCredentialError).message).toMatch(/CODEX_AUTH_JSON/);
      expect((failure as AiCredentialError).message).toMatch(/codex login/);
    }
  });

  it('marks a rate-limited run retryable and a misconfigured one not', async () => {
    process.env.FAKE_MODE = 'fail';
    process.env.FAKE_STDERR = "chatgpt.com rate-limited this account ('Too many requests')";
    const limited = await new ImageUseProvider()
      .generateImage({ prompt: 'a cat' })
      .catch((error: AiError) => error);
    expect((limited as AiError).retryable).toBe(true);

    process.env.FAKE_STDERR = 'error: no image returned. events seen: reasoning';
    const broken = await new ImageUseProvider()
      .generateImage({ prompt: 'a cat' })
      .catch((error: AiError) => error);
    expect((broken as AiError).retryable).toBe(false);
  });

  /** A CLI that never exits would otherwise hold the job — and its Chrome — forever. */
  it('kills a run that outlives its budget and the queue wait', async () => {
    process.env.FAKE_MODE = 'hang';
    env.IMAGE_USE_TIMEOUT_MS = 300;
    env.IMAGE_USE_QUEUE_WAIT_MS = 200;

    await expect(new ImageUseProvider().generateImage({ prompt: 'a cat' })).rejects.toThrow(
      /was killed/,
    );
  });

  it('names a missing binary rather than an ENOENT', async () => {
    env.IMAGE_USE_BIN = join(workspace, 'not-installed');

    await expect(new ImageUseProvider().generateImage({ prompt: 'a cat' })).rejects.toThrow(
      /not found.*Check IMAGE_USE_BIN/s,
    );
  });

  it('keeps text generation off this provider', async () => {
    await expect(new ImageUseProvider().complete({ messages: [] })).rejects.toThrow(/images only/);
  });
});

/**
 * The one thing the fake CLI above cannot prove: that the real image-use
 * accepts the arguments this provider builds. Opt-in, because it spends
 * subscription quota and takes a minute.
 *
 *   IMAGE_USE_E2E=1 IMAGE_USE_PYTHON=/opt/homebrew/bin/python3.12 \
 *     IMAGE_USE_MODEL=gpt-5.5 npx vitest run src/lib/ai/providers/image-use.test.ts
 */
describe.runIf(process.env.IMAGE_USE_E2E === '1')('against the real CLI', () => {
  it('generates an image end to end', async () => {
    env.IMAGE_USE_BIN = join(process.cwd(), 'vendor/image-use/image-use');
    env.IMAGE_USE_PYTHON = process.env.IMAGE_USE_PYTHON || '';
    env.IMAGE_USE_BACKEND = 'codex';
    env.IMAGE_USE_TIMEOUT_MS = 240_000;
    env.IMAGE_USE_QUEUE_WAIT_MS = 60_000;

    const result = await new ImageUseProvider().generateImage({
      prompt: 'a plain grey circle centred on white, nothing else',
      size: '1024x1024',
    });

    // A PNG signature, not merely bytes: proof the file came back whole.
    expect(result.data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(result.mimeType).toBe('image/png');
    expect(result.model).not.toBe('image-use');
  }, 300_000);
});
