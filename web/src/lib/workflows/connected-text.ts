/**
 * Reads a text value arriving on an input port.
 *
 * Blank counts as absent throughout, so an unconnected port and one fed an
 * empty string behave alike: the step falls back to what was typed into it.
 * That keeps a typed value a genuine default rather than something an upstream
 * step can silently wipe when it has nothing to say.
 */
export function connectedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
