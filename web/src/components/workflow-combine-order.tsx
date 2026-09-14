'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

export type CombineSourceId = 'media1' | 'media2' | 'media3' | 'media4';

const SOURCE_LABEL: Record<CombineSourceId, string> = {
  media1: 'Media 1',
  media2: 'Media 2',
  media3: 'Media 3',
  media4: 'Media 4',
};

export function WorkflowCombineOrder({
  value,
  disabled,
  onChange,
}: {
  value: CombineSourceId[];
  disabled: boolean;
  onChange: (value: CombineSourceId[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = value.indexOf(event.active.id as CombineSourceId);
    const to = value.indexOf(event.over.id as CombineSourceId);
    if (from >= 0 && to >= 0) onChange(arrayMove(value, from, to));
  }

  return (
    <div>
      <p className="b88-label">Source order</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={value} strategy={verticalListSortingStrategy}>
          <ol className="mt-2 list-none space-y-2 p-0">
            {value.map((id, index) => (
              <SortableSource key={id} id={id} index={index} disabled={disabled} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableSource({
  id,
  index,
  disabled,
}: {
  id: CombineSourceId;
  index: number;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      className="flex min-h-11 items-center gap-3 rounded-md border border-hairline bg-canvas px-3"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.7 : 1,
      }}
    >
      <span className="b88-caption w-4">{index + 1}</span>
      <button
        type="button"
        className="flex min-h-10 flex-1 cursor-grab items-center gap-2 text-left text-sm active:cursor-grabbing disabled:cursor-default"
        disabled={disabled}
        aria-label={`Move ${SOURCE_LABEL[id]}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
        {SOURCE_LABEL[id]}
      </button>
    </li>
  );
}
