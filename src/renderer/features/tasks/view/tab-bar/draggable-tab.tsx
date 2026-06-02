import { useDraggable, useDroppable } from '@dnd-kit/core';

export function DraggableTab({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      style={{
        display: 'flex',
        height: '100%',
        alignItems: 'center',
        position: 'relative',
        // VS Code / Cursor behavior: tabs grow to share the bar's width but cap
        // at a sensible max so a single tab doesn't span the whole bar. With
        // many tabs they shrink (min-width: 0 allows it) and the bar's
        // overflow-x-auto scrolls.
        flex: '1 1 0',
        minWidth: 0,
        maxWidth: '280px',
      }}
      {...attributes}
      {...listeners}
    >
      {isOver && <DropIndicator />}
      {children}
    </div>
  );
}

function DropIndicator() {
  return <div className="pointer-events-none absolute inset-y-1 left-0 z-10 w-0.5 bg-foreground" />;
}

export function PaneDropZone({ groupId }: { groupId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `pane-drop-${groupId}` });
  return (
    <div ref={setNodeRef} className="relative h-full flex-1">
      {isOver && <DropIndicator />}
    </div>
  );
}
