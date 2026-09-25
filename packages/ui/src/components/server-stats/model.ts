import { SERVER_STATS_WINDOWS, type ServerStatsPoint, type ServerStatsRange } from "@zcode/shared";

export const usage = (used: number | null | undefined, total: number | null | undefined) =>
  used != null && total != null && total > 0
    ? Math.min(100, Math.max(0, (used / total) * 100))
    : null;
export const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value)}%`;
export const tone = (value: number | null | undefined) =>
  value != null && value > 95
    ? "text-destructive"
    : value != null && value > 80
      ? "text-warning"
      : "text-foreground";
export function bytes(value: number | null | undefined, compact = false) {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = compact ? ["B", "K", "M", "G", "T"] : ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index > 0 && value < 100 ? 1 : 0)}${compact ? "" : " "}${units[index]}`;
}
export const rate = (value: number | null | undefined, compact = false) =>
  value == null ? "—" : `${bytes(value, compact)}${compact ? "" : "/s"}`;
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m`;

/** 保留真实时间位置与缺测断点，不能把 null 过滤后压缩成连续数据。 */
export function chartPaths(
  points: ServerStatsPoint[],
  key: "cpuPercent" | "rxBytesPerSec" | "txBytesPerSec",
  range: ServerStatsRange,
  end: number,
  max: number,
  base: number,
  amplitude: number,
) {
  const { duration: windowMs, step } = SERVER_STATS_WINDOWS[range];
  const segments: { x: number; y: number }[][] = [];
  let segment: { x: number; y: number }[] = [];
  let previous = 0;
  for (const point of points) {
    const value = point[key];
    if (point.t < end - windowMs || point.t > end) continue;
    if (value == null || !Number.isFinite(value) || (previous && point.t - previous > step * 2)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (value != null && Number.isFinite(value))
      segment.push({
        x: 2 + ((point.t - (end - windowMs)) / windowMs) * 296,
        y: base - Math.min(1, Math.max(0, value / (max || 1))) * amplitude,
      });
    previous = point.t;
  }
  if (segment.length) segments.push(segment);
  return segments.map((s) => ({
    line: s.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "),
    area: `M${s[0]!.x.toFixed(2)},${base} ${s.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")} L${s.at(-1)!.x.toFixed(2)},${base} Z`,
    last: s.at(-1)!,
  }));
}
