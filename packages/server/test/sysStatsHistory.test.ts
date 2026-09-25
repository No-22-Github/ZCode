import assert from "node:assert/strict";
import test from "node:test";
import { createDailyTraffic, createStatsHistory } from "../src/sysStatsHistory.js";
import type { ServerStatsPoint } from "@zcode/shared";

const point = (t: number, cpu: number | null): ServerStatsPoint => ({
  t,
  cpuPercent: cpu,
  cpuPeak: cpu,
  memTotalBytes: 100,
  memUsedBytes: 25,
  memCachedBytes: 10,
  swapTotalBytes: 0,
  swapUsedBytes: 0,
  rxBytesPerSec: cpu,
  txBytesPerSec: null,
  rxPeak: cpu,
  txPeak: null,
  loadAvg1: 0,
  loadAvg5: 0,
  loadAvg15: 0,
  uptimeSec: 10,
  rssBytes: 5,
  diskTotalBytes: null,
  diskUsedBytes: null,
  diskReadBytesPerSec: null,
  diskWriteBytesPerSec: null,
});
test("history averages only valid samples and preserves bucket peaks", () => {
  const history = createStatsHistory();
  history.add(point(1000, null));
  history.add(point(2000, 10));
  history.add(point(3000, 90));
  const data = history.read("15m", 3000);
  assert.equal(data.length, 1);
  assert.equal(data[0]?.cpuPercent, 50);
  assert.equal(data[0]?.cpuPeak, 90);
  assert.equal(data[0]?.txBytesPerSec, null);
  assert.equal(history.read("1m", 3000).length, 3);
});
test("history is bounded at each resolution and does not fill missing time", () => {
  const history = createStatsHistory();
  for (let t = 0; t < 90_000_000; t += 1000) history.add(point(t, 25));
  for (const [range, limit] of [
    ["1m", 60],
    ["15m", 180],
    ["24h", 288],
  ] as const) {
    assert.equal(history.read(range, 90_000_000 - 1000).length, limit);
  }
  assert.deepEqual(history.read("1m", 91_000_000), []);
  const cold = createStatsHistory();
  cold.add(point(90_000_000, 10));
  assert.equal(cold.read("24h", 90_000_000).length, 1);
});
test("daily traffic handles midnight, counter reset and missing observations", () => {
  const traffic = createDailyTraffic();
  const t = Date.parse("2026-09-25T23:59:58Z");
  traffic.add(t, { rxBytes: 100, txBytes: 200 });
  traffic.add(t + 1000, { rxBytes: 150, txBytes: 220 });
  assert.equal(traffic.read().rxBytes, 50);
  traffic.add(t + 2000, { rxBytes: 200, txBytes: 250 });
  assert.equal(traffic.read().day, "2026-09-26");
  assert.equal(traffic.read().rxBytes, 0);
  traffic.add(t + 3000, { rxBytes: 10, txBytes: 10 });
  assert.equal(traffic.read().rxBytes, 0);
  traffic.resetBaseline();
  traffic.add(t + 5000, { rxBytes: 1000, txBytes: 1000 });
  assert.equal(traffic.read().rxBytes, 0);
});
