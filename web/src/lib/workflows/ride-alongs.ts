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
const RIDE_ALONGS: ReadonlyArray<{ port: string; with: string }> = [
  // Idea generator to Image generator.
  { port: 'reference', with: 'prompts' },
  { port: 'titles', with: 'prompts' },
  // Image generator to Beat slideshow, which labels each cut.
  { port: 'titles', with: 'images' },
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
    const value = output[rider.port];
    if (value != null) inputs[rider.port] = value;
  }
}