import 'server-only';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';
import { selectIndices, type SelectionMode } from '@/lib/workflows/select-items';

interface Config {
  mode: SelectionMode;
  count: number;
  index: number;
}

/**
 * Selects one or more items from a list.
 *
 * Both output shapes are explicit: `selection` remains a list while `item`
 * exposes its first value to a downstream step that accepts only one.
 *
 * `labels` is an optional parallel list that is reordered by the same positions
 * as the items. Media ids and the names that belong to them travel as two
 * lists, so a random selection applied to one and not the other would put every
 * label on the wrong clip — and nothing would say so until someone watched the
 * finished video.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const items = Array.isArray(ctx.inputs.items) ? ctx.inputs.items : [];
  // Either name: they ride in as `titles` with the items, and an edge saved
  // from the old Titles port still delivers them as `labels`.
  const incoming = ctx.inputs.titles ?? ctx.inputs.labels;
  // Labels are optional, so an empty list means the same as none at all. Read
  // as "zero labels supplied" it fails the count check below against any items
  // — which is what a track picker fed by the Media library hit, since that
  // step names its images and a track selection has none.
  const provided = Array.isArray(incoming) && incoming.length > 0 ? incoming : null;
  const labels = provided ? provided.map(String) : null;
  if (items.length === 0) throw new PermanentJobError('Nothing reached this step to select from.');

  // A mismatched label list is a wiring mistake. Trimming or padding to fit
  // would shift every label by one and still produce a video, so it is refused.
  if (labels && labels.length !== items.length) {
    throw new PermanentJobError(
      `This step received ${items.length} items but ${labels.length} labels. Both lists must come from the same source in the same order.`,
    );
  }

  try {
    const positions = selectIndices(items.length, {
      mode: config.mode,
      count: config.count,
      index: config.index,
      // Two selection steps in one run should not accidentally choose the same
      // sample, while retries of either step must reproduce their own sample.
      seed: `${ctx.runId}:${ctx.nodeRunId}`,
    });
    const selection = positions.map((position) => items[position]);
    const chosenTitles = labels ? positions.map((position) => labels[position]) : [];
    return {
      item: selection[0],
      selection,
      // The one title belonging to `item`, kept apart from the list above.
      // Sending "First selected" into a step that labels what it is given used
      // to hand one picture the names of all eight, and the step refused —
      // rightly, since a shifted label is worse than a missing one.
      itemTitle: chosenTitles.length ? [chosenTitles[0]] : [],
      // Reordered with the selection so each title stays on its own item.
      // Emitted under both names: `titles` is what every other step calls them
      // and what the ride-along looks for, `labels` keeps an edge saved from
      // the old port resolving.
      titles: chosenTitles,
      labels: chosenTitles,
    };
  } catch (error) {
    throw new PermanentJobError(
      error instanceof Error ? error.message : 'These items could not be selected.',
    );
  }
}
