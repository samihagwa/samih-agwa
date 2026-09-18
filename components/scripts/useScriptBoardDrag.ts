"use client";

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

/** Pointer capture works with mouse, pen and touch. Only the touch handle blocks scrolling. */
export function useScriptBoardDrag<T extends { id: string; title: string }>(
  board: RefObject<HTMLDivElement | null>,
  canDrop: (item: T, stage: string) => boolean,
  onDrop: (item: T, stage: string) => void,
) {
  const session = useRef<{ item: T; pointer: number; x: number; y: number; active: boolean; element: HTMLElement } | null>(null);
  const position = useRef({ x: 0, y: 0 });
  const callbacks = useRef({ canDrop, onDrop });
  useEffect(() => { callbacks.current = { canDrop, onDrop }; }, [canDrop, onDrop]);
  const suppressClickUntil = useRef(0);
  const [drag, setDrag] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const targetRef = useRef<string | null>(null);
  function hitTest() {
    const current = session.current;
    const column = document.elementFromPoint(position.current.x, position.current.y)?.closest<HTMLElement>(".script-board-column[data-stage]");
    const stage = column && board.current?.contains(column) ? column.dataset.stage ?? null : null;
    targetRef.current = current && stage && callbacks.current.canDrop(current.item, stage) ? stage : null;
    setTarget(targetRef.current);
  }
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const scroll = () => {
      const element = board.current;
      if (element) {
        const bounds = element.getBoundingClientRect();
        const { x, y } = position.current;
        if (y >= bounds.top && y <= bounds.bottom) {
          const delta = x < bounds.left + 52 ? -10 : x > bounds.right - 52 ? 10 : 0;
          if (delta) { element.scrollLeft += delta; hitTest(); }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") finish(true); };
    const blur = () => finish(true);
    window.addEventListener("keydown", escape); window.addEventListener("blur", blur);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", escape); window.removeEventListener("blur", blur); };
    // Only restart the edge-scroll loop when a drag starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(drag), board]);
  function finish(cancelled: boolean) {
    const current = session.current;
    session.current = null;
    if (current?.active) {
      suppressClickUntil.current = Date.now() + 400;
      if (!cancelled && targetRef.current) callbacks.current.onDrop(current.item, targetRef.current);
    }
    targetRef.current = null;
    setDrag(null); setTarget(null);
  }
  return {
    drag, target,
    suppressClick: () => Date.now() < suppressClickUntil.current,
    start(event: PointerEvent<HTMLElement>, item: T) {
      if (!event.isPrimary || event.button !== 0) return;
      const source = event.target as HTMLElement;
      const handle = source.closest(".script-drag-handle");
      if (event.pointerType !== "mouse" && !handle) return;
      if (!handle && source.closest("button,select,input,textarea")) return;
      session.current = { item, pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false, element: event.currentTarget };
    },
    move(event: PointerEvent<HTMLElement>) {
      const current = session.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8) return;
      if (!current.active) { current.active = true; current.element.setPointerCapture(event.pointerId); }
      event.preventDefault();
      position.current = { x: event.clientX, y: event.clientY };
      setDrag({ id: current.item.id, title: current.item.title, ...position.current }); hitTest();
    },
    end(event: PointerEvent<HTMLElement>) { if (session.current?.pointer === event.pointerId) { hitTest(); finish(false); } },
    cancel() { finish(true); },
  };
}
