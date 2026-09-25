import { useEffect, useRef, useState } from "react";
import {
  serverStatsSnapshotSchema,
  type ServerStatsRange,
  type ServerStatsSnapshot,
} from "@zcode/shared";
import { logger } from "@/logger.js";

export function useServerStats(enabled: boolean, range: ServerStatsRange) {
  const [snapshot, setSnapshot] = useState<ServerStatsSnapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const received = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const stop = () => {
      clearTimeout(timer);
      controller?.abort();
    };
    const poll = async () => {
      if (disposed || document.hidden) return;
      const request = new AbortController();
      controller = request;
      const started = performance.now();
      let delay = 2000;
      try {
        const response = await fetch(`/api/sys-stats?range=${range}`, { signal: request.signal });
        if (!response.ok) throw new Error(`sys-stats HTTP ${response.status}`);
        const data = serverStatsSnapshotSchema.parse(await response.json());
        // 切换范围/后台切回时，旧响应不得覆盖新范围的快照。
        if (disposed || request.signal.aborted) return;
        if (!data.available) throw new Error("sys-stats unavailable");
        received.current = true;
        setSnapshot(data);
        setOnline(true);
        setLatency(Math.round(performance.now() - started));
      } catch (error) {
        if (disposed || request.signal.aborted) return;
        setOnline(false);
        logger.debug("[serverStats] polling unavailable", error);
        if (!received.current) return;
        delay = 10_000;
      }
      setNow(Date.now());
      if (!disposed && !request.signal.aborted) timer = setTimeout(() => void poll(), delay);
    };
    const visibility = () => {
      stop();
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, range]);
  return { snapshot, online, latency, now };
}
