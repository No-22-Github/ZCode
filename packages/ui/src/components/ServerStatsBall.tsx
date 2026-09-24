/**
 * ServerStatsBall —— VPS 服务器状态悬浮球（仅 Web 端渲染）。
 *
 * 数据来自同源 GET /api/sys-stats（packages/server/src/sysStats.ts）：
 * 服务端每秒采样一次、保留最近 60 个点；这里每 2 秒轮询一次，
 * document.hidden 时停止轮询、切回时恢复；接口不可用（非 Linux、桌面端）
 * 时组件不渲染且停止轮询，等可见性变化后再重试。
 *
 * 交互：收起时只显示 CPU%/内存%（>80% 变 warning 色，>95% 变 destructive 色）；
 * 点开展开 SVG 折线小面板；拖动松手后吸附最近屏幕边缘，位置存 localStorage，
 * 位置计算计入 env(safe-area-inset-*)，避免在手机上挡住浏览器工具栏和底部输入框。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

interface ServerStatsPoint {
  t: number;
  cpuPercent: number | null;
  memTotalBytes: number;
  memUsedBytes: number;
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
}

interface SysStatsSnapshot {
  available: boolean;
  points: ServerStatsPoint[];
}

const POLL_INTERVAL_MS = 2000;
const BALL_SIZE = 44;
const EDGE_MARGIN = 12;
const PANEL_WIDTH = 260;
const PANEL_GAP = 8;
const DRAG_CLICK_THRESHOLD_PX = 6;
const STORAGE_KEY = "zcode:server-stats-ball";

type BallSide = "left" | "right";

interface BallPosition {
  side: BallSide;
  /** 相对视口顶部的偏移（渲染时会叠加 safe-area-inset-top） */
  top: number;
}

interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readStoredPosition(): BallPosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { side: "right", top: 16 };
    const parsed = JSON.parse(raw) as Partial<BallPosition>;
    const side = parsed.side === "left" ? "left" : "right";
    const top = typeof parsed.top === "number" && Number.isFinite(parsed.top) ? parsed.top : 16;
    return { side, top };
  } catch {
    return { side: "right", top: 16 };
  }
}

function storePosition(position: BallPosition): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch (error) {
    logger.debug("[serverStatsBall] localStorage 不可用", error);
  }
}

/** 用探针元素把 env(safe-area-inset-*) 换算成像素，JS 端的夹取计算才能用。 */
function measureSafeAreaInsets(): SafeAreaInsets {
  const fallback: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  probe.style.paddingLeft = "env(safe-area-inset-left, 0px)";
  probe.style.paddingRight = "env(safe-area-inset-right, 0px)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets: SafeAreaInsets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
  };
  probe.remove();
  return insets;
}

function memPercentOf(point: ServerStatsPoint | undefined): number | null {
  if (!point || point.memTotalBytes <= 0) return null;
  return (point.memUsedBytes / point.memTotalBytes) * 100;
}

function cpuPercentOf(point: ServerStatsPoint | undefined): number | null {
  return point?.cpuPercent ?? null;
}

function usageTone(percent: number | null): string {
  if (percent == null) return "text-foreground";
  if (percent > 95) return "text-destructive";
  if (percent > 80) return "text-warning";
  return "text-foreground";
}

/** 极简 SVG 折线：不需要图表库，空数据/null 直接不画。 */
function MiniChart({ values, strokeClass }: { values: (number | null)[]; strokeClass: string }) {
  const height = 28;
  const finiteValues = values.filter((value): value is number => value != null);
  if (finiteValues.length < 2) {
    return <div className="h-7 rounded-sm bg-background-alt" aria-hidden="true" />;
  }
  const max = Math.max(...finiteValues);
  const min = Math.min(...finiteValues, 0);
  const span = max - min || 1;
  const step = 100 / (finiteValues.length - 1);
  const points = finiteValues
    .map(
      (value, index) =>
        `${(index * step).toFixed(2)},${(height - ((value - min) / span) * height).toFixed(2)}`,
    )
    .join(" ");
  return (
    <svg
      className={`h-7 w-full rounded-sm bg-background-alt ${strokeClass}`}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec)) return "--";
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

export function ServerStatsBall() {
  const { intl } = useZCodeIntl();
  const platform = useOptionalPlatform();
  const isWeb = platform?.canSelectFilePath === false;
  const [unavailable, setUnavailable] = useState(false);
  const [points, setPoints] = useState<ServerStatsPoint[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<BallPosition>(() => readStoredPosition());
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const unavailableRef = useRef(unavailable);
  unavailableRef.current = unavailable;
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const insetsRef = useRef<SafeAreaInsets>({ top: 0, bottom: 0, left: 0, right: 0 });

  // 每 2 秒轮询；document.hidden 时停止，切回时恢复。失败即隐藏并停表，
  // 等下一次可见性变化再试，避免桌面端或非统计服务端反复打失败请求。
  useEffect(() => {
    if (!isWeb) return;
    let timer: number | null = null;
    let disposed = false;
    const stopTimer = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const poll = async () => {
      try {
        const response = await fetch("/api/sys-stats");
        if (!response.ok) throw new Error(`sys-stats HTTP ${response.status}`);
        const snapshot = (await response.json()) as SysStatsSnapshot;
        if (!snapshot.available) throw new Error("sys-stats unavailable");
        if (disposed) return;
        setPoints(snapshot.points);
      } catch (error) {
        if (disposed) return;
        logger.debug("[serverStatsBall] sys-stats 不可用，暂停轮询", error);
        stopTimer();
        setUnavailable(true);
      }
    };
    const start = () => {
      if (timer == null && !unavailableRef.current && !document.hidden) {
        void poll();
        timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stopTimer();
        return;
      }
      if (unavailableRef.current) {
        unavailableRef.current = false;
        setUnavailable(false);
      }
      start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      disposed = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isWeb]);

  const clampTop = useCallback((top: number, insets: SafeAreaInsets): number => {
    return clamp(
      top,
      insets.top + EDGE_MARGIN,
      Math.max(
        insets.top + EDGE_MARGIN,
        window.innerHeight - insets.bottom - BALL_SIZE - EDGE_MARGIN,
      ),
    );
  }, []);

  const onBallPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    insetsRef.current = measureSafeAreaInsets();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }, []);

  const onBallPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (
      !dragState.moved &&
      Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) <
        DRAG_CLICK_THRESHOLD_PX
    ) {
      return;
    }
    dragState.moved = true;
    setExpanded(false);
    setDragPos({
      x: clamp(event.clientX - BALL_SIZE / 2, 0, window.innerWidth - BALL_SIZE),
      y: clamp(event.clientY - BALL_SIZE / 2, 0, window.innerHeight - BALL_SIZE),
    });
  }, []);

  const onBallPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const dragState = dragStateRef.current;
      dragStateRef.current = null;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      if (!dragState.moved) {
        setDragPos(null);
        setExpanded((current) => !current);
        return;
      }
      setDragPos((current) => {
        if (current) {
          const insets = insetsRef.current;
          const side: BallSide =
            current.x + BALL_SIZE / 2 <= window.innerWidth / 2 ? "left" : "right";
          const next = { side, top: clampTop(current.y, insets) };
          setPosition(next);
          storePosition(next);
        }
        return null;
      });
    },
    [clampTop],
  );

  const onBallPointerCancel = useCallback(() => {
    // 拖动被来电/手势等系统中断时不落位，直接回到已保存的位置
    dragStateRef.current = null;
    setDragPos(null);
  }, []);

  if (!isWeb || unavailable) {
    return null;
  }

  const latest = points[points.length - 1];
  const cpuPercent = cpuPercentOf(latest);
  const memPercent = memPercentOf(latest);
  const cpuSeries = points.map((point) => point.cpuPercent);
  const memSeries = points.map((point) =>
    point.memTotalBytes > 0 ? (point.memUsedBytes / point.memTotalBytes) * 100 : null,
  );
  const rxSeries = points.map((point) => point.rxBytesPerSec);
  const txSeries = points.map((point) => point.txBytesPerSec);

  // 面板贴着悬浮球所在侧展开，并整体夹取在安全区内
  const panelStyle: React.CSSProperties =
    position.side === "right"
      ? {
          right: insetsRef.current.right + EDGE_MARGIN + BALL_SIZE + PANEL_GAP,
          top: clampTop(position.top, insetsRef.current),
        }
      : {
          left: insetsRef.current.left + EDGE_MARGIN + BALL_SIZE + PANEL_GAP,
          top: clampTop(position.top, insetsRef.current),
        };

  const ballStyle: React.CSSProperties = dragPos
    ? { top: dragPos.y, left: dragPos.x }
    : position.side === "left"
      ? {
          top: clampTop(position.top, insetsRef.current),
          left: insetsRef.current.left + EDGE_MARGIN,
        }
      : {
          top: clampTop(position.top, insetsRef.current),
          right: insetsRef.current.right + EDGE_MARGIN,
        };

  return (
    <>
      {expanded ? (
        <div
          className="fixed z-[80] rounded-2xl border border-popover-border bg-popover p-3 shadow-lg"
          style={{
            ...panelStyle,
            maxWidth: `min(${PANEL_WIDTH}px, calc(100vw - 2 * ${EDGE_MARGIN}px))`,
          }}
        >
          <div className="flex flex-col gap-2 text-ui-caption text-foreground">
            <div className="flex items-center justify-between">
              <span>{intl.formatMessage({ id: "serverStats.cpu" })}</span>
              <span className={usageTone(cpuPercent)}>
                {cpuPercent == null ? "--" : `${Math.round(cpuPercent)}%`}
              </span>
            </div>
            <MiniChart values={cpuSeries} strokeClass="text-primary" />
            <div className="flex items-center justify-between">
              <span>{intl.formatMessage({ id: "serverStats.memory" })}</span>
              <span className={usageTone(memPercent)}>
                {memPercent == null ? "--" : `${Math.round(memPercent)}%`}
              </span>
            </div>
            <MiniChart values={memSeries} strokeClass="text-success" />
            <div className="flex items-center justify-between">
              <span>{intl.formatMessage({ id: "serverStats.download" })}</span>
              <span>{formatRate(latest?.rxBytesPerSec ?? null)}</span>
            </div>
            <MiniChart values={rxSeries} strokeClass="text-primary" />
            <div className="flex items-center justify-between">
              <span>{intl.formatMessage({ id: "serverStats.upload" })}</span>
              <span>{formatRate(latest?.txBytesPerSec ?? null)}</span>
            </div>
            <MiniChart values={txSeries} strokeClass="text-warning" />
          </div>
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={intl.formatMessage(
          { id: "serverStats.ballAriaLabel" },
          {
            cpu: cpuPercent == null ? "--" : Math.round(cpuPercent),
            memory: memPercent == null ? "--" : Math.round(memPercent),
          },
        )}
        className={`fixed z-[80] flex touch-none select-none flex-col items-center justify-center rounded-full border border-border bg-popover text-ui-xs shadow-md ${
          dragPos ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ ...ballStyle, width: BALL_SIZE, height: BALL_SIZE }}
        onPointerDown={onBallPointerDown}
        onPointerMove={onBallPointerMove}
        onPointerUp={onBallPointerUp}
        onPointerCancel={onBallPointerCancel}
      >
        <span className={usageTone(cpuPercent)}>
          {cpuPercent == null ? "--" : `${Math.round(cpuPercent)}%`}
        </span>
        <span className={usageTone(memPercent)}>
          {memPercent == null ? "--" : `${Math.round(memPercent)}%`}
        </span>
      </button>
    </>
  );
}
