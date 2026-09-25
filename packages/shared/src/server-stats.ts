import { z } from "zod";

const metric = z.number().finite().nonnegative();
const rate = metric.nullable();
export const serverStatsRangeSchema = z.enum(["1m", "15m", "24h"]);
export type ServerStatsRange = z.infer<typeof serverStatsRangeSchema>;
export const SERVER_STATS_WINDOWS = {
  "1m": { duration: 60_000, step: 1000, limit: 60 },
  "15m": { duration: 900_000, step: 5000, limit: 180 },
  "24h": { duration: 86_400_000, step: 300_000, limit: 288 },
} as const;

export const serverStatsPointSchema = z.object({
  t: metric,
  cpuPercent: rate,
  memTotalBytes: metric,
  memUsedBytes: metric,
  memCachedBytes: metric,
  swapTotalBytes: metric,
  swapUsedBytes: metric,
  rxBytesPerSec: rate,
  txBytesPerSec: rate,
  loadAvg1: metric,
  loadAvg5: metric,
  loadAvg15: metric,
  uptimeSec: metric,
  rssBytes: metric,
  diskTotalBytes: rate,
  diskUsedBytes: rate,
  diskReadBytesPerSec: rate,
  diskWriteBytesPerSec: rate,
  cpuPeak: rate,
  rxPeak: rate,
  txPeak: rate,
});
export type ServerStatsPoint = z.infer<typeof serverStatsPointSchema>;
export const serverStatsSnapshotSchema = z.object({
  available: z.boolean(),
  points: z.array(serverStatsPointSchema).max(288),
  latest: serverStatsPointSchema.nullable(),
  range: serverStatsRangeSchema,
  stepMs: metric,
  host: z.object({ name: z.string(), cores: metric }),
  startedAt: metric.nullable(),
  traffic: z.object({ day: z.string(), since: metric, rxBytes: metric, txBytes: metric }),
});
export type ServerStatsSnapshot = z.infer<typeof serverStatsSnapshotSchema>;
