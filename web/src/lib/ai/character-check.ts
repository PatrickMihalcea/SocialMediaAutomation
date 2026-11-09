import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '@/lib/env';

export interface CharacterCheck {
  /** The specific characters the prompt names. */
  named: string[];
  /** Named characters not recognisably drawn. */
  missing: string[];
  /** At least half of the named characters are there, or none were named. */
  allPresent: boolean;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['named', 'missing', 'allPresent'],
  properties: {
    named: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    allPresent: { type: 'boolean' },
  },
};

/**
 * Whether a generated picture shows the characters its prompt names.
 *
 * Image models sometimes swap a well-known character for a generic look-alike
 * rather than draw it, and nothing in the result says so. This asks Codex,
 * looking at the picture, on the same ChatGPT subscription the images are made
 * on, so it costs nothing per check. Null when the check could not run: a
 * picture is never held back because the checker was unavailable.
 */
export async function checkCharacters(image: Buffer, prompt: string): Promise<CharacterCheck | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-characters-'));
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
      instruction(prompt),
    ]);
    if (code !== 0) return null;
    const parsed = JSON.parse(await readFile(answer, 'utf8')) as CharacterCheck;
    return Array.isArray(parsed.named) && Array.isArray(parsed.missing) && typeof parsed.allPresent === 'boolean'
      ? parsed
      : null;
  } catch (error) {
    console.warn('[characters] the check could not run; keeping the picture', error);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function instruction(prompt: string): string {
  return [
    'This picture was generated from the prompt below.',
    'First list the specific named characters the prompt asks for: characters from a franchise, show, game or film, called by name. Ignore generic descriptions such as "a child" or "a cat".',
    'Then look only at the picture and decide which of those named characters are clearly and recognisably drawn. A generic figure or a look-alike that is not clearly that character does not count.',
    'Set allPresent to true when at least half of the named characters are recognisable, or when the prompt names none.',
    '',
    'Prompt:',
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
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) console.warn('[characters] codex exited', code, stderr.slice(-400));
      resolve(code);
    });
  });
}
