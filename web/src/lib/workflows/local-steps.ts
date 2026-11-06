import { parseConfig } from '@/lib/workflows/definitions';

/**
 * Whether a step can only run on the local worker.
 *
 * Decided per step, from its saved config, because the same step type runs in
 * the cloud with Codex and on the operator's Mac with ComfyUI. Mock wins over
 * the provider in both, matching how each step resolves it when it runs — a
 * step that would render a placeholder has no reason to wait for a laptop.
 */
export function stepRunsLocally(type: string, rawConfig: unknown): boolean {
  if (type !== 'IMAGE_GENERATOR' && type !== 'ANIMATE_IMAGE') return false;
  let config: Record<string, unknown>;
  try {
    config = parseConfig(type, rawConfig) as Record<string, unknown>;
  } catch {
    // A config that no longer parses fails on whichever worker takes it, and
    // the cloud one is the one that is reliably there to say so.
    return false;
  }
  return config.useMockGeneration !== true && config.provider === 'comfyui';
}
