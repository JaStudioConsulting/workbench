import { useState, useCallback, useRef, useEffect } from "react";

const COLS = 12;
const ROW_H = 160;
const GAP = 16;

const DEFAULT_LAYOUT = [
  { id: "needs-action", x: 0, y: 0, w: 6, h: 2, visible: true },
  { id: "today", x: 6, y: 0, w: 6, h: 2, visible: true },
  { id: "priority-jobs", x: 0, y: 2, w: 4, h: 2, visible: true },
  { id: "hiring-now", x: 4, y: 2, w: 4, h: 1, visible: true },
  { id: "neo4j", x: 8, y: 2, w: 4, h: 2, visible: true },
];

function collides(items, targetId, x, y, w, h) {
  return items.some((o) => {
    if (o.id === targetId || !o.visible) return false;
    return !(x + w <= o.x || x >= o.x + o.w || y + h <= o.y || y >= o.y + o.h);
  });
}

export function useArrangeLayout(pageId) {
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const layoutRef = useRef(null);

  const [layout, setLayout] = useState(() => {
    try {
      const saved = localStorage.getItem(`wb-layout-${pageId}`);
      return saved ? JSON.parse(saved) : structuredClone(DEFAULT_LAYOUT);
    } catch {
      return structuredClone(DEFAULT_LAYOUT);
    }
  });

  layoutRef.current = layout;

  useEffect(() => {
    localStorage.setItem(`wb-layout-${pageId}`, JSON.stringify(layout));
  }, [layout, pageId]);

  const getWidgetStyle = useCallback((item) => ({
    gridColumn: `${item.x + 1} / span ${item.w}`,
    gridRow: `${item.y + 1} / span ${item.h}`,
  }), []);

  const startDrag = useCallback((widgetId, e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const colW = rect.width / COLS;
    const widget = layoutRef.current.find((w) => w.id === widgetId);
    if (!widget) return;

    dragRef.current = {
      type: "drag",
      id: widgetId,
      startX: e.clientX,
      startY: e.clientY,
      origX: widget.x,
      origY: widget.y,
      colW,
    };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d || d.type !== "drag") return;
      const cur = layoutRef.current.find((w) => w.id === d.id);
      if (!cur) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      let nx = d.origX + Math.round(dx / d.colW);
      let ny = d.origY + Math.round(dy / (ROW_H + GAP));
      nx = Math.max(0, Math.min(COLS - cur.w, nx));
      ny = Math.max(0, ny);
      if (!collides(layoutRef.current, d.id, nx, ny, cur.w, cur.h)) {
        setLayout((prev) => prev.map((it) => (it.id === d.id ? { ...it, x: nx, y: ny } : it)));
      }
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const startResize = useCallback((widgetId, e) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const colW = rect.width / COLS;
    const widget = layoutRef.current.find((w) => w.id === widgetId);
    if (!widget) return;

    dragRef.current = {
      type: "resize",
      id: widgetId,
      startX: e.clientX,
      startY: e.clientY,
      origW: widget.w,
      origH: widget.h,
      colW,
    };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d || d.type !== "resize") return;
      const cur = layoutRef.current.find((w) => w.id === d.id);
      if (!cur) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      let nw = d.origW + Math.round(dx / d.colW);
      let nh = d.origH + Math.round(dy / (ROW_H + GAP));
      nw = Math.max(3, Math.min(COLS - cur.x, nw));
      nh = Math.max(1, Math.min(4, nh));
      if (!collides(layoutRef.current, d.id, cur.x, cur.y, nw, nh)) {
        setLayout((prev) => prev.map((it) => (it.id === d.id ? { ...it, w: nw, h: nh } : it)));
      }
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const hideWidget = useCallback((id) => {
    setLayout((prev) => prev.map((w) => (w.id === id ? { ...w, visible: false } : w)));
  }, []);

  const restoreWidget = useCallback((id) => {
    const defaults = DEFAULT_LAYOUT.find((d) => d.id === id);
    if (!defaults) return;
    setLayout((prev) => prev.map((w) => (w.id === id ? { ...w, visible: true, x: defaults.x, y: defaults.y, w: defaults.w, h: defaults.h } : w)));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(structuredClone(DEFAULT_LAYOUT));
  }, []);

  const hiddenWidgets = layout.filter((w) => !w.visible).map((w) => w.id);

  return { layout, containerRef, getWidgetStyle, startDrag, startResize, hideWidget, restoreWidget, resetLayout, hiddenWidgets };
}
