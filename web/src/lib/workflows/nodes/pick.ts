import 'server-only';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  index: number;
}

/**
 * Takes one item out of a list.
 *
 * Exists because port typing is strict: a list output cannot be dropped onto a
 * single-value input. Making that conversion an explicit step keeps the graph
 * honest about its own arity instead of silently taking the first item.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const items = Array.isArray(ctx.inputs.items) ? ctx.inputs.items : [];
  if (items.length === 0) throw new PermanentJobError('Nothing reached this step to pick from.');

  // A negative index counts back from the end, so -1 is the last item.
  const index = config.index < 0 ? items.length + config.index : config.index;
  if (index < 0 || index >= items.length) {
    throw new PermanentJobError(
      `This step is set to item ${config.index}, but only ${items.length} arrived.`,
    );
  }
  return { item: items[index] };
}
