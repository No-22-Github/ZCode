import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { logger } from "@/logger.js";

export const STATS_POSITION_KEY = "zcode:server-stats-ball";
const margin = 12;
const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), Math.max(min, max));
function readPosition() {
  try {
    const value = JSON.parse(localStorage.getItem(STATS_POSITION_KEY) ?? "{}");
    return {
      side: value.side === "left" ? ("left" as const) : ("right" as const),
      top: Number.isFinite(value.top) ? (value.top as number) : 80,
    };
  } catch {
    return { side: "right" as "left" | "right", top: 80 };
  }
}
function viewport() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.appendChild(probe);
  const css = getComputedStyle(probe);
  const area = {
    top: parseFloat(css.paddingTop) || 0,
    right: parseFloat(css.paddingRight) || 0,
    bottom: parseFloat(css.paddingBottom) || 0,
    left: parseFloat(css.paddingLeft) || 0,
  };
  probe.remove();
  const visual = window.visualViewport;
  return {
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
    x: visual?.offsetLeft ?? 0,
    y: visual?.offsetTop ?? 0,
    ...area,
  };
}
export function useStatsPosition(width: number, height: number, collapse: () => void) {
  const [position, setPosition] = useState(readPosition);
  const [view, setView] = useState(viewport);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const resize = () => setView(viewport());
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, []);
  const x =
    position.side === "left"
      ? view.x + view.left + margin
      : view.x + view.width - view.right - margin - width;
  const top = clamp(
    position.top,
    view.y + view.top + margin,
    view.y + view.height - view.bottom - height - margin,
  );
  const pointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
    };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 6) return;
    g.moved = true;
    suppressClick.current = true;
    collapse();
    setDrag({
      x: clamp(
        event.clientX - g.dx,
        view.x + view.left + margin,
        view.x + view.width - view.right - width - margin,
      ),
      y: clamp(
        event.clientY - g.dy,
        view.y + view.top + margin,
        view.y + view.height - view.bottom - height - margin,
      ),
    });
  };
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (g.moved && drag) {
      const next = {
        side: drag.x + width / 2 < view.x + view.width / 2 ? ("left" as const) : ("right" as const),
        top: drag.y,
      };
      setPosition(next);
      try {
        localStorage.setItem(STATS_POSITION_KEY, JSON.stringify(next));
      } catch (error) {
        logger.debug("[serverStats] position storage unavailable", error);
      }
    }
    setDrag(null);
  };
  const pointerCancel = () => {
    gesture.current = null;
    setDrag(null);
    suppressClick.current = true;
  };
  return {
    view,
    position,
    dragging: !!drag,
    style: { left: drag?.x ?? x, top: drag?.y ?? top, width, height },
    suppressClick,
    events: {
      onPointerDown: pointerDown,
      onPointerMove: pointerMove,
      onPointerUp: pointerUp,
      onPointerCancel: pointerCancel,
      onLostPointerCapture: () => {
        if (gesture.current) pointerCancel();
      },
    },
  };
}
