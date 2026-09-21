import 'server-only';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

type SourceId = 'media1' | 'media2' | 'media3' | 'media4';

interface Config {
  sourceOrder: SourceId[];
}

export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const media: string[] = [];
  const titles: string[] = [];
  let anyTitles = false;

  for (const source of config.sourceOrder) {
    const items = ids(ctx.inputs[source]);
    if (items.length === 0) continue;

    const titlePort = source.replace('media', 'titles');
    const sourceTitles = strings(ctx.inputs[titlePort]);
    if (sourceTitles.length && sourceTitles.length !== items.length) {
      throw new PermanentJobError(
        `${source.replace('media', 'Media ')} received ${items.length} items but ${sourceTitles.length} titles.`,
      );
    }

    media.push(...items);
    if (sourceTitles.length) anyTitles = true;
    titles.push(...(sourceTitles.length ? sourceTitles : items.map(() => '')));
  }

  if (media.length === 0) {
    throw new PermanentJobError('No images or videos reached this step.');
  }
  return { media, titles: anyTitles ? titles : [] };
}

/**
 * The ids in a slot.
 *
 * A bare string is one item, not nothing: these slots accept a single media as
 * well as a list, so "First selected" can be appended without a step in between
 * whose only job is to make a list of one.
 */
const ids = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const strings = (value: unknown): string[] => ids(value);
