import { MediaType } from '@prisma/client';

/**
 * Port typing.
 *
 * Strict by design: no implicit coercion in either direction. A `text` source
 * dropped onto a `text[]` target is a collect, and `text[]` onto `text` is a
 * map — both get explicit nodes. Letting them connect silently would make the
 * run graph lie about its own arity, and the resulting bug surfaces three nodes
 * downstream as "why is my slideshow one image".
 */

export type PortScalar = 'text' | 'number' | 'json' | 'media' | 'post';

export interface PortType {
  scalar: PortScalar;
  list: boolean;
  /** media only — which asset kinds this port accepts or emits. */
  mediaKinds?: MediaType[];
  /** json only — a registry-declared shape id, so `segments` is not a free-for-all. */
  schemaId?: string;
  /**
   * List inputs only. Lets a single value connect, treated as a list of one.
   *
   * Opt-in rather than general, because the strictness above earns its keep
   * nearly everywhere: one image dropped onto a slideshow is a one-frame video
   * and the person finds out three steps later. A Combine media slot is the
   * case where it says nothing ambiguous — the step exists to append lists, and
   * appending one item is what "First selected" plainly means.
   */
  acceptsSingle?: boolean;
}

export interface PortDefinition {
  id: string;
  label: string;
  type: PortType;
  /** Input ports only. An unconnected required port blocks the run from starting. */
  required?: boolean;
  description?: string;
  /**
   * Output ports only. Marks the port generic: its concrete type is whatever
   * reaches the named input, re-arity'd to this port's own `list`. `type` stays
   * the widest set the port could ever carry, and is what the palette shows.
   *
   * This is why Pick one is a single node rather than one per media kind. The
   * type still comes from the graph, never from config, so editing a setting
   * cannot invalidate an edge — only rewiring can.
   */
  followsInput?: string;
}

export const text = (list = false): PortType => ({ scalar: 'text', list });
export const json = (schemaId?: string): PortType => ({ scalar: 'json', list: false, schemaId });
export const post = (): PortType => ({ scalar: 'post', list: false });
export const media = (
  kinds: MediaType[],
  list = false,
  options: { acceptsSingle?: boolean } = {},
): PortType => ({
  scalar: 'media',
  list,
  mediaKinds: kinds,
  ...(options.acceptsSingle ? { acceptsSingle: true } : {}),
});

export interface Incompatibility {
  reason: string;
}

/**
 * Can `source`'s output feed `target`'s input? Returns null when compatible, or
 * a sentence the composer can show verbatim.
 */
export function checkCompatible(source: PortType, target: PortType): Incompatibility | null {
  if (source.scalar !== target.scalar) {
    return { reason: `A ${describe(source)} output cannot connect to a ${describe(target)} input.` };
  }
  if (source.list !== target.list) {
    // A single into a list is allowed only where the input says so; the kinds
    // are still checked below, so one audio track cannot reach an image slot.
    const singleIntoAcceptingList = !source.list && target.list && target.acceptsSingle;
    if (!singleIntoAcceptingList) {
      return source.list
        ? { reason: `That output is a list and this input takes a single ${source.scalar}. Add a Pick one step between them.` }
        : { reason: `That output is a single ${source.scalar} and this input takes a list of them.` };
    }
  }
  if (source.scalar === 'media') {
    const accepted = target.mediaKinds ?? [];
    const offered = source.mediaKinds ?? [];
    const unsupported = offered.filter((kind) => !accepted.includes(kind));
    if (unsupported.length > 0) {
      return {
        reason: `This input takes ${listKinds(accepted)}, and that output can produce ${listKinds(unsupported)}.`,
      };
    }
  }
  if (source.scalar === 'json' && target.schemaId && source.schemaId !== target.schemaId) {
    return { reason: `This input expects ${target.schemaId} data, and that output produces ${source.schemaId ?? 'untyped'} data.` };
  }
  return null;
}

export const isCompatible = (source: PortType, target: PortType): boolean =>
  checkCompatible(source, target) === null;

/** e.g. "video list", "image, video or audio", "text". */
export function describePortType(type: PortType): string {
  const base = type.scalar === 'media' ? listKinds(type.mediaKinds ?? []) : type.scalar;
  return type.list ? `${base} list` : base;
}

const describe = describePortType;

const KIND_LABEL: Record<MediaType, string> = {
  IMAGE: 'image',
  VIDEO: 'video',
  GIF: 'GIF',
  AUDIO: 'audio',
};

function listKinds(kinds: MediaType[]): string {
  if (kinds.length === 0) return 'media';
  const labels = kinds.map((k) => KIND_LABEL[k]);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}
