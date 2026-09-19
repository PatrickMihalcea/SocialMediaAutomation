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
const RIDE_ALONGS: ReadonlyArray<{ port: string; with: string; from?: string }> = [
  // Idea generator to Image generator.
  { port: 'reference', with: 'prompts' },
  { port: 'titles', with: 'prompts' },
  // Anything producing media to a step that labels or cuts it.
  { port: 'titles', with: 'images' },
  { port: 'titles', with: 'media' },
  // Select items, which reorders them with its selection.
  { port: 'titles', with: 'items' },
  // Combine media takes up to four lists, each with its own titles. `from`
  // because the port is numbered per slot while every producer emits `titles`.
  { port: 'titles1', with: 'media1', from: 'titles' },
  { port: 'titles2', with: 'media2', from: 'titles' },
  { port: 'titles3', with: 'media3', from: 'titles' },
  { port: 'titles4', with: 'media4', from: 'titles' },
];

export function applyRideAlongs(
  edges: ReadonlyArray<{ targetPort: string; sourceNodeId: string }>,
  byNode: Map<string, { output: unknown }>,
  inputs: Record<string, unknown>,
): void {
  for (const rider of RIDE_ALONGS) {
    // An explicit wire always wins, where one is possible: someone who
    // connected titles by hand means those, not whatever the prompts arrived
    // with. The Image generator has no port for a reference at all, so that one
    // only ever comes from here.
    if (inputs[rider.port] != null) continue;

    const carrier = edges.find((edge) => edge.targetPort === rider.with);
    if (!carrier) continue;

    const output = (byNode.get(carrier.sourceNodeId)?.output ?? {}) as Record<string, unknown>;
    const value = output[rider.from ?? rider.port];
    if (value != null) inputs[rider.port] = value;
  }
}