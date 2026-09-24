import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { parseProcMemInfo, parseProcNetDev, parseProcStat } from "../src/sysStats.js";

const STAT_SAMPLE_A = `cpu  100 0 50 800 100 0 10 0 0 0
cpu0 50 0 25 400 50 0 5 0 0 0
intr 123
`;

const STAT_SAMPLE_B = `cpu  180 0 90 820 120 0 14 0 0 0
cpu0 90 0 45 410 60 0 7 0 0 0
intr 456
`;

test("parseProcStat reads idle+iowait and total ticks", () => {
  const a = parseProcStat(STAT_SAMPLE_A);
  const b = parseProcStat(STAT_SAMPLE_B);
  // A: total=1060, idle=900；B: total=1224, idle=940
  assert.equal(a.total, 1060);
  assert.equal(a.idle, 900);
  const totalDelta = b.total - a.total;
  const idleDelta = b.idle - a.idle;
  const cpuPercent = (1 - idleDelta / totalDelta) * 100;
  assert.equal(totalDelta, 164);
  assert.equal(idleDelta, 40);
  assert.ok(cpuPercent > 0 && cpuPercent < 100);
  assert.equal(Math.round(cpuPercent), 76);
});

test("parseProcMemInfo converts kB and falls back when MemAvailable missing", () => {
  const modern = parseProcMemInfo("MemTotal: 16000000 kB\nMemAvailable: 8000000 kB\n");
  assert.equal(modern.totalBytes, 16_000_000 * 1024);
  assert.equal(modern.availableBytes, 8_000_000 * 1024);

  const legacy = parseProcMemInfo("MemTotal: 1000 kB\nMemFree: 400 kB\n");
  assert.equal(legacy.availableBytes, 400 * 1024);
});

const NET_DEV_SAMPLE = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9999999    8000    0    0    0     0          0         0  9999999    8000    0    0    0     0       0          0
  eth0: 1000    10    0    0    0     0          0         0  2000    20    0    0    0     0       0          0
  eth1: 500    5    0    0    0     0          0         0  700    7    0    0    0     0       0          0
`;

test("parseProcNetDev sums non-loopback interfaces only", () => {
  const net = parseProcNetDev(NET_DEV_SAMPLE);
  assert.equal(net.rxBytes, 1500);
  assert.equal(net.txBytes, 2700);
});

test("sys-stats sampler reports availability per platform", async () => {
  const { getSysStatsSampler } = await import("../src/sysStats.js");
  const snapshot = await getSysStatsSampler().touch();
  if (existsSync("/proc/stat")) {
    assert.equal(snapshot.available, true);
    // 首个采样点立即建立基线；内存字段来自 /proc/meminfo
    assert.ok(snapshot.points.length >= 1);
    const first = snapshot.points[0];
    assert.ok(first, "expected at least one point");
    assert.equal(first.cpuPercent, null);
    assert.equal(first.rxBytesPerSec, null);
    assert.ok(first.memTotalBytes > 0);
  } else {
    // macOS / Windows 开发机没有 /proc
    assert.equal(snapshot.available, false);
    assert.deepEqual(snapshot.points, []);
  }
});
