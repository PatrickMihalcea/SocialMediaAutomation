import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// A stand-in for the Codex CLI: copies whatever answer the test sets to the
// file named after -o, or fails when told to.
vi.mock('@/lib/env', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const p = await import('node:path');
  const dir = p.join(os.tmpdir(), `fake-codex-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const bin = p.join(dir, 'codex');
  fs.writeFileSync(bin, `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; out="$1"; fi
  shift
done
if [ -f "${dir}/fail" ]; then exit 3; fi
cp "${dir}/answer.json" "$out"
`);
  fs.chmodSync(bin, 0o755);
  return { env: { CODEX_BIN: bin, CHARACTER_CHECK_MODEL: 'test-model' } };
});

import { checkPicture } from '@/lib/ai/picture-check';

const dir = path.join(tmpdir(), `fake-codex-${process.pid}`);
const answer = (value: unknown) => writeFileSync(path.join(dir, 'answer.json'), JSON.stringify(value));

describe('asking a question about a picture', () => {
  beforeEach(() => {
    mkdirSync(dir, { recursive: true });
    rmSync(path.join(dir, 'fail'), { force: true });
  });

  it('returns the answer and its reason', async () => {
    answer({ pass: false, reason: 'The children are generic, not cartoon characters.', score: 2 });
    expect(await checkPicture(Buffer.from('png'), 'SpongeBob on a train', 'Are the characters real cartoons?'))
      .toEqual({ pass: false, reason: 'The children are generic, not cartoon characters.', score: 2 });
  });

  it('lets the picture through when the checker cannot run', async () => {
    writeFileSync(path.join(dir, 'fail'), '');
    expect(await checkPicture(Buffer.from('png'), 'SpongeBob', 'Real cartoons?')).toBeNull();
  });
});
