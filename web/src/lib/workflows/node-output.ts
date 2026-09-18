/**
 * What is worth showing a person out of a step's recorded output.
 *
 * Node outputs are wiring: they carry the ids the next step consumes. A Save
 * draft step records `{ post: { id, status } }`, and an image step records the
 * ids of the pictures it made — both already on the run row as a link to the
 * post and as the pictures themselves. Offering to "see the output" and then
 * printing a uuid is worse than offering nothing, because it costs a click to
 * find that out.
 *
 * So references are dropped and everything else is kept: the titles an image
 * step wrote, the tempo a music step detected, the reason a slideshow came out
 * short. That rule is about the shape of a value, not a list of node types, so
 * a node added later is handled without touching this.
 *
 * Client-safe: the run view uses it to render, the run's own loader uses it to
 * decide whether the control is worth showing at all.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isReference(value: unknown): boolean {
  if (typeof value === 'string') return UUID.test(value);
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => isReference(item));
  // An object carrying an id is a pointer to a row shown elsewhere on the page.
  if (typeof value === 'object' && value !== null) return 'id' in value;
  return false;
}

/** The output with its references removed, or null when nothing else remains. */
export function reviewableOutput(output: unknown): Record<string, unknown> | null {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return null;

  const kept = Object.entries(output as Record<string, unknown>).filter(
    ([, value]) =>
      !isReference(value)
      && value !== null
      && value !== undefined
      && value !== ''
      && !(Array.isArray(value) && value.length === 0),
  );
  return kept.length ? Object.fromEntries(kept) : null;
}

/** Whether a step recorded anything a person would want to read. */
export function hasReviewableOutput(output: unknown): boolean {
  return reviewableOutput(output) !== null;
}
