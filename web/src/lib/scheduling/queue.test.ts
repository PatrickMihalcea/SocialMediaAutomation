import { describe, expect, it } from 'vitest';
import { isCompleteQueueOrder, markSlotOccupancy, queueSlotsForOrder, selectBulkSlots, type Slot } from './queue';

const at = (hour: number) => new Date(`2026-09-11T${String(hour).padStart(2, '0')}:00:00.000Z`);

describe('smart queue planning', () => {
  it('marks occupied slots with their post', () => {
    const slots = markSlotOccupancy([at(9), at(12)], new Map([[at(12).getTime(), 'post-2']]));
    expect(slots).toEqual([
      { at: at(9), taken: false, postId: undefined },
      { at: at(12), taken: true, postId: 'post-2' },
    ]);
  });

  it('reuses queued occupancy while preserving external occupancy', () => {
    const slots: Slot[] = [
      { at: at(9), taken: true, postId: 'queued-a' },
      { at: at(10), taken: true, postId: 'outside' },
      { at: at(11), taken: false },
    ];
    expect(queueSlotsForOrder(slots, ['queued-a'], 2)).toEqual([at(9), at(11)]);
  });

  it('accepts only a complete, unique reorder', () => {
    expect(isCompleteQueueOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isCompleteQueueOrder(['a', 'b', 'c'], ['a', 'a', 'b'])).toBe(false);
    expect(isCompleteQueueOrder(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
  });

  it('plans only free bulk slots at or after the starting point', () => {
    const slots: Slot[] = [
      { at: at(9), taken: false },
      { at: at(10), taken: true, postId: 'outside' },
      { at: at(11), taken: false },
      { at: at(12), taken: false },
    ];
    expect(selectBulkSlots(slots, 2, at(10))).toEqual([at(11), at(12)]);
  });
});
