/**
 * Ports that travel with another rather than needing a wire of their own.
 *
 * Each pair is a list and something belonging to the same items: the sketch the
 * drawn theme carries, and the title written for each prompt or image. Wanting
 * one without the other is not a thing anybody means, so requiring a second
 * connection only produced graphs that looked complete and ran without them —
 * an image set that ignored a layout, or files named image-1 through image-8,
 * with nothing on the canvas showing what was missing.
 *
 * Deliberately a short list rather than "inherit any output whose id matches an
 * unwired input". That general rule would start moving values between steps in
 * graphs already built, on nothing more than a shared name.
 */
/**
 * Ports that travel with another rather than needing a wire of their own.
 *
 * Each pair is a list and something belonging to the same items: the sketch the
 * drawn theme carries, and the title written for each prompt or image. Wanting
 * one without the other is not a thing anybody means, so requiring a second
 * connection only produced graphs that looked complete and ran without them —
 * an image set that ignored a layout, or files named image-1 through image-8,
 * with nothing on the canvas showing what was missing.
 *
 * Deliberately a short list rather than "inherit any output whose id matches an
 * unwired input". That general rule would start moving values between steps in
 * graphs already built, on nothing more than a shared name.
 */
/** Outputs that titles describe. Audio and video lists have none of their own. */
const TITLED_LISTS = ['images', 'media', 'selection', 'prompts'] as const;

/**
 * Single-value outputs, which carry one title rather than the whole list.
 *
 * Pick one names its selection in `titles`, one per item — so sending "First
 * selected" into a Combine media slot handed one picture the names of all eight
 * and the step refused the count. A single item has a single title, and the
 * step that produced it is the only one that knows which.
 */
const TITLED_SINGLES = ['item'] as const;

/**
 * A port filled from the step that fed another port, rather than from a wire.
 *
 * `whenTargetPort` says which connection carries it and which slot it fills;
 * `whenSourcePortIn` says which outputs the value actually belongs to. Both are
 * needed. Keyed on the target alone, a Media library feeding its audio into a
 * track picker also handed over the titles of its images — a list describing
 * something else entirely, and long enough that the picker refused the count.
 */
const RIDE_ALONGS: ReadonlyArray<{
  whenTargetPort: string;
  whenSourcePortIn: readonly string[];
  fills: string;
  fromKey: string;
  /**
   * Where to look when `fromKey` is not there: take the first entry of this
   * list instead. Only for single-value carriers, and only because a step that
   * already succeeded keeps the output it recorded — so resuming a run started
   * before `itemTitle` existed would otherwise leave that frame unlabelled.
   * `item` is the first of `selection`, so the first title is its own.
   */
  orFirstOf?: string;
}> = [
  // Idea generator to Image generator: the title written for each prompt, and
  // the sketch the drawn theme carries.
  { whenTargetPort: 'prompts', whenSourcePortIn: ['prompts'], fills: 'titles', fromKey: 'titles' },
  { whenTargetPort: 'prompts', whenSourcePortIn: ['prompts'], fills: 'reference', fromKey: 'reference' },
  // Any titled list into a step that labels or cuts it.
  { whenTargetPort: 'images', whenSourcePortIn: TITLED_LISTS, fills: 'titles', fromKey: 'titles' },
  { whenTargetPort: 'items', whenSourcePortIn: TITLED_LISTS, fills: 'titles', fromKey: 'titles' },
  // Combine media's four slots, each from its own list — or from one item,
  // which brings the one title that belongs to it.
  ...[1, 2, 3, 4].flatMap((slot) => [
    {
      whenTargetPort: `media${slot}`,
      whenSourcePortIn: TITLED_LISTS,
      fills: `titles${slot}`,
      fromKey: 'titles',
    },
    {
      whenTargetPort: `media${slot}`,
      whenSourcePortIn: TITLED_SINGLES,
      fills: `titles${slot}`,
      fromKey: 'itemTitle',
      orFirstOf: 'titles',
    },
  ]),
];

export function applyRideAlongs(
  edges: ReadonlyArray<{ targetPort: string; sourcePort: string; sourceNodeId: string }>,
  byNode: Map<string, { output: unknown }>,
  inputs: Record<string, unknown>,
): void {
  for (const rider of RIDE_ALONGS) {
    // An explicit wire always wins, where one is possible: someone who
    // connected titles by hand means those.
    if (inputs[rider.fills] != null) continue;

    const carrier = edges.find(
      (edge) => edge.targetPort === rider.whenTargetPort
        && rider.whenSourcePortIn.includes(edge.sourcePort),
    );
    if (!carrier) continue;

    const output = (byNode.get(carrier.sourceNodeId)?.output ?? {}) as Record<string, unknown>;
    let value = output[rider.fromKey];
    if (rider.orFirstOf && (value == null || (Array.isArray(value) && value.length === 0))) {
      const list = output[rider.orFirstOf];
      value = Array.isArray(list) && list.length > 0 ? [list[0]] : null;
    }
    // An empty list is nothing to carry, and carrying it is not harmless: a
    // step reading "some titles, zero of them" refuses the count against any
    // items at all.
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    inputs[rider.fills] = value;
  }
}
