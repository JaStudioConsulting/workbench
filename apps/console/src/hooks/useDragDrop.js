import { useState, useCallback, useRef } from 'react';

/**
 * Lightweight HTML5 drag-drop hook for case → action dock.
 * No external library. Keyboard alternative provided via ActionDock buttons.
 */
export function useDragDrop() {
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);
  const dragRef = useRef(null);

  const onDragStart = useCallback((e, item) => {
    dragRef.current = item;
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    e.currentTarget.classList.add('dragging');
  }, []);

  const onDragEnd = useCallback((e) => {
    e.currentTarget.classList.remove('dragging');
    setDraggedItem(null);
    setDragOverTarget(null);
    dragRef.current = null;
  }, []);

  const onDragOver = useCallback((e, targetId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetId);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOverTarget(null);
  }, []);

  const onDrop = useCallback((e, targetId, onAction) => {
    e.preventDefault();
    setDragOverTarget(null);
    const item = dragRef.current;
    if (item && onAction) {
      onAction(item, targetId);
    }
    dragRef.current = null;
    setDraggedItem(null);
  }, []);

  return { draggedItem, dragOverTarget, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop };
}
