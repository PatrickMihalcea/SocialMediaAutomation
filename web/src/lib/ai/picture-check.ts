import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '@/lib/env';

export interface PictureCheck {
  pass: boolean;
  /** One sentence on why, from the AI that looked. */
  reason: string;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'reason'],
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
};

/**
 * Asks a question about a generated picture and gets a yes or no.
 *
 * The question is the step's own, written by whoever set the step up, so the
 * check is whatever they need it to be: real characters rather than invented
 * ones, nothing written in the picture, the right number of people. Codex
 * answers it looking at the picture, on the same ChatGPT login the pictures are
 * made on, so it costs nothing per check. Null when the check could not run: a
 * picture is never held back because the checker was unavailable.
 */
export async function checkPicture(image: Buffer, prompt: string, question: string): Promise<PictureCheck | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-check-'));
  try {
    const picture = path.join(dir, 'picture.png');
    const schema = path.join(dir, 'schema.json');
    const answer = path.join(dir, 'answer.json');
    await writeFile(picture, image);
    await writeFile(schema, JSON.stringify(SCHEMA));
    const code = await run(env.CODEX_BIN, [
      'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only',
      '-m', env.CHARACTER_CHECK_MODEL,
      '--image', picture,
      '--output-schema', schema,
      '-o', answer,
      instruction(prompt, question),
    ]);
    if (code !== 0) return null;
    const parsed = JSON.parse(await readFile(answer, 'utf8')) as PictureCheck;
    return typeof parsed.pass === 'boolean' && typeof parsed.reason === 'string' ? parsed : null;
  } catch (error) {
    console.warn('[check] the check could not run; keeping the picture', error);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function instruction(prompt: string, question: string): string {
  return [
    'Look carefully at the attached picture and answer this question about it:',
    question.trim(),
    '',
    'Set pass to true only if the answer is clearly yes. Give the reason in one short sentence, naming what you saw.',
    'For context, the picture was generated from this prompt (judge the picture, not the prompt):',
    prompt,
  ].join('\n');
}

/** Runs the CLI with no stdin: it waits on an open one for input that never comes. */
function run(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      console.warn('[check] could not start the Codex CLI; the check is skipped', error.message);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) console.warn('[check] codex exited', code, stderr.slice(-400));
      resolve(code);
    });
  });
}
