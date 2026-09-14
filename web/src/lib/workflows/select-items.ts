export type SelectionMode = 'random' | 'first' | 'last' | 'index';

export interface SelectionOptions {
  mode: SelectionMode;
  count: number;
  index: number;
  seed: string;
}

/**
 * Which positions were selected, in the order they were selected.
 *
 * Positions rather than values, because a selection frequently has to be
 * applied to more than one list. Media ids and the labels that belong to them
 * arrive as two parallel lists, and shuffling one without the other relabels
 * every clip in the finished video — silently, and only visibly wrong once
 * somebody watches it.
 */
export function selectIndices(length: number, options: SelectionOptions): number[] {
  if (options.count > length) {
    throw new Error(`This step needs ${options.count} items, but only ${length} arrived.`);
  }

  const positions = Array.from({ length }, (_, index) => index);

  if (options.mode === 'random') {
    const random = seededRandom(options.seed);
    for (let index = positions.length - 1; index > 0; index--) {
      const swapWith = Math.floor(random() * (index + 1));
      [positions[index], positions[swapWith]] = [positions[swapWith], positions[index]];
    }
    return positions.slice(0, options.count);
  }

  if (options.mode === 'first') return positions.slice(0, options.count);
  if (options.mode === 'last') return positions.slice(length - options.count);

  const start = options.index < 0 ? length + options.index : options.index;
  if (start < 0 || start + options.count > length) {
    throw new Error(
      `This step starts at item ${options.index}, but ${options.count} items cannot be selected from the ${length} that arrived.`,
    );
  }
  return positions.slice(start, start + options.count);
}

/** Selects without replacement. The seed makes random choices repeatable on retry. */
export function selectItems<T>(items: T[], options: SelectionOptions): T[] {
  return selectIndices(items.length, options).map((index) => items[index]);
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
