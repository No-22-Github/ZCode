import { SERVER_STATS_WINDOWS, type ServerStatsPoint, type ServerStatsRange } from "@zcode/shared";

const averaged = [
  "cpuPercent",
  "rxBytesPerSec",
  "txBytesPerSec",
  "diskReadBytesPerSec",
  "diskWriteBytesPerSec",
] as const;
type Averaged = (typeof averaged)[number];
interface Bucket {
  id: number;
  point: ServerStatsPoint;
  sums: Record<Averaged, number>;
  counts: Record<Averaged, number>;
}
const zero = () => Object.fromEntries(averaged.map((key) => [key, 0])) as Record<Averaged, number>;
const peak = (a: number | null, b: number | null) =>
  a == null ? b : b == null ? a : Math.max(a, b);

export function createStatsHistory() {
  const windows: Record<ServerStatsRange, Bucket[]> = { "1m": [], "15m": [], "24h": [] };
  return {
    add(point: ServerStatsPoint) {
      for (const range of Object.keys(windows) as ServerStatsRange[]) {
        const config = SERVER_STATS_WINDOWS[range];
        const buckets = windows[range];
        const id = Math.floor(point.t / config.step);
        let bucket = buckets.at(-1);
        if (!bucket || bucket.id !== id) {
          bucket = { id, point: { ...point }, sums: zero(), counts: zero() };
          buckets.push(bucket);
        }
        const previous = bucket.point;
        bucket.point = {
          ...point,
          cpuPeak: peak(previous.cpuPeak, point.cpuPeak),
          rxPeak: peak(previous.rxPeak, point.rxPeak),
          txPeak: peak(previous.txPeak, point.txPeak),
        };
        for (const key of averaged) {
          const value = point[key];
          if (value != null) {
            bucket.sums[key] += value;
            bucket.counts[key]++;
          }
          bucket.point[key] = bucket.counts[key] ? bucket.sums[key] / bucket.counts[key] : null;
        }
        while (buckets.length > config.limit || (buckets[0] && buckets[0].id <= id - config.limit))
          buckets.shift();
      }
    },
    read(range: ServerStatsRange, now: number) {
      return windows[range]
        .filter((b) => b.point.t > now - SERVER_STATS_WINDOWS[range].duration)
        .map((b) => ({ ...b.point }));
    },
  };
}

export function createDailyTraffic() {
  let value = { day: "", since: 0, rxBytes: 0, txBytes: 0 };
  let previous: { rxBytes: number; txBytes: number } | null = null;
  return {
    resetBaseline() {
      previous = null;
    },
    add(t: number, counters: { rxBytes: number; txBytes: number }) {
      const day = new Date(t).toISOString().slice(0, 10);
      if (day !== value.day) {
        value = { day, since: t, rxBytes: 0, txBytes: 0 };
        previous = null;
      }
      if (previous) {
        value.rxBytes += Math.max(0, counters.rxBytes - previous.rxBytes);
        value.txBytes += Math.max(0, counters.txBytes - previous.txBytes);
      }
      previous = counters;
    },
    read() {
      return { ...value };
    },
  };
}
