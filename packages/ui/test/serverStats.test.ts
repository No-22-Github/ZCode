import assert from "node:assert/strict";
import test from "node:test";
import type { ServerStatsPoint } from "@zcode/shared";
import { chartPaths, bytes, usage, tone } from "../src/components/server-stats/model.js";

test("history preserves timestamps, nulls and missing buckets", () => {
  const points = [
    { t: 10_000, cpuPercent: 20 },
    { t: 11_000, cpuPercent: null },
    { t: 12_000, cpuPercent: 30 },
    { t: 20_000, cpuPercent: 40 },
  ] as ServerStatsPoint[];
  const paths = chartPaths(points, "cpuPercent", "1m", 60_000, 100, 50, 48);
  assert.equal(paths.length, 3);
  assert.ok(paths[0]!.last.x < paths[1]!.last.x);
  assert.ok(Math.abs(paths[2]!.last.y - 30.8) < 1e-8);
  assert.equal(chartPaths(points, "cpuPercent", "1m", 200_000, 100, 50, 48).length, 0);
});
test("binary units and usage thresholds stay truthful", () => {
  assert.equal(bytes(1024), "1.0 KiB");
  assert.equal(bytes(null), "—");
  assert.equal(usage(1, 0), null);
  assert.equal(usage(25, 100), 25);
  assert.equal(tone(80), "text-foreground");
  assert.equal(tone(81), "text-warning");
  assert.equal(tone(96), "text-destructive");
});
