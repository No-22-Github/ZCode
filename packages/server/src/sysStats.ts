/** Single server-owned sampler; bounded in-memory history, no external processes. */
import { readFile, readdir, statfs } from "node:fs/promises";
import { cpus, hostname, loadavg } from "node:os";
import {
  SERVER_STATS_WINDOWS,
  type ServerStatsPoint,
  type ServerStatsSnapshot,
  type ServerStatsRange,
} from "@zcode/shared";
import { createDailyTraffic, createStatsHistory } from "./sysStatsHistory.js";

export type { ServerStatsPoint, ServerStatsSnapshot } from "@zcode/shared";

interface CpuSample {
  idle: number;
  total: number;
}

/** 解析 /proc/stat 首行 `cpu  user nice system idle iowait ...` 的累计节拍数。 */
export function parseProcStat(text: string): CpuSample {
  const cpuLine = text.split("\n").find((line) => line.startsWith("cpu ")) ?? "";
  const values = cpuLine
    .trim()
    .split(/\s+/)
    .slice(1, 9)
    .map((raw) => Number.parseInt(raw, 10));
  // idle + iowait 一起视为空闲，与常用 CPU% 口径一致
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce<number>(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
  return { idle, total };
}

/** 解析 /proc/meminfo；数值单位是 kB，统一换算成字节。 */
export function parseProcMemInfo(text: string) {
  const values = new Map<string, number>();
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const value = Number.parseInt(line.slice(separator + 1).trim(), 10);
    if (Number.isFinite(value)) {
      values.set(line.slice(0, separator).trim(), value * 1024);
    }
  }
  return {
    totalBytes: values.get("MemTotal") ?? 0,
    cachedBytes: Math.max(
      0,
      (values.get("Cached") ?? 0) + (values.get("SReclaimable") ?? 0) - (values.get("Shmem") ?? 0),
    ),
    swapTotalBytes: values.get("SwapTotal") ?? 0,
    swapUsedBytes: Math.max(0, (values.get("SwapTotal") ?? 0) - (values.get("SwapFree") ?? 0)),
    // 老内核没有 MemAvailable 时退回 MemFree，宁可见到偏高数字也不显示 0
    availableBytes: values.get("MemAvailable") ?? values.get("MemFree") ?? 0,
  };
}

/** 解析 /proc/net/dev（前两行是表头），汇总除 lo 外所有网卡的收发字节。 */
export function parseProcNetDev(text: string): { rxBytes: number; txBytes: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim() === "lo") continue;
    const fields = line
      .slice(separator + 1)
      .trim()
      .split(/\s+/)
      .map((raw) => Number.parseInt(raw, 10));
    // 接收侧第 1 列是 bytes；发送侧跟在 8 个接收字段之后，第 9 列是 bytes
    const rxBytes = fields[0];
    const txBytes = fields[8];
    if (rxBytes !== undefined && Number.isFinite(rxBytes)) rx += rxBytes;
    if (txBytes !== undefined && Number.isFinite(txBytes)) tx += txBytes;
  }
  return { rxBytes: rx, txBytes: tx };
}

/** /proc/diskstats sectors are always 512 bytes; exclude partitions/stacked duplicates. */
export function parseProcDiskStats(text: string, devices: Set<string>) {
  let rxBytes = 0,
    txBytes = 0,
    found = false;
  for (const line of text.trim().split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (!devices.has(fields[2] ?? "")) continue;
    const read = Number(fields[5]),
      written = Number(fields[9]);
    if (!Number.isFinite(read) || !Number.isFinite(written)) continue;
    found = true;
    rxBytes += read * 512;
    txBytes += written * 512;
  }
  return found ? { rxBytes, txBytes } : null;
}

async function readDiskCounters() {
  try {
    const names = await readdir("/sys/block");
    const leaves = await Promise.all(
      names
        .filter((name) => !/^(loop|ram|zram)/.test(name))
        .map(async (name) => {
          const slaves = await readdir(`/sys/block/${name}/slaves`);
          return slaves.length === 0 ? name : null;
        }),
    );
    const devices = new Set(leaves.filter((name): name is string => name !== null));
    const counters = parseProcDiskStats(await readFile("/proc/diskstats", "utf8"), devices);
    return counters ? { ...counters, key: [...devices].sort().join(",") } : null;
  } catch {
    return null;
  }
}

type Counters = { rxBytes: number; txBytes: number; at: number; key?: string };
function rates(
  current: { rxBytes: number; txBytes: number } | null,
  previous: Counters | null,
  now: number,
) {
  const seconds = previous ? (now - previous.at) / 1000 : 0;
  return current && previous && seconds > 0
    ? {
        rx: Math.max(0, current.rxBytes - previous.rxBytes) / seconds,
        tx: Math.max(0, current.txBytes - previous.txBytes) / seconds,
      }
    : { rx: null, tx: null };
}

export function createSysStatsSampler() {
  const history = createStatsHistory();
  const traffic = createDailyTraffic();
  const host = { name: hostname(), cores: cpus().length };
  let latest: ServerStatsPoint | null = null;
  let startedAt: number | null = null;
  let available = false;
  let initialized = false;
  let timer: NodeJS.Timeout | null = null;
  let pending: Promise<void> | null = null;
  let prevCpu: CpuSample | null = null;
  let prevNet: Counters | null = null;
  let prevDisk: Counters | null = null;
  let disk = { total: null as number | null, used: null as number | null, at: 0 };

  async function sampleOnce() {
    try {
      const [statText, memText, netText, uptimeText, diskCounters] = await Promise.all([
        readFile("/proc/stat", "utf8"),
        readFile("/proc/meminfo", "utf8"),
        readFile("/proc/net/dev", "utf8"),
        readFile("/proc/uptime", "utf8"),
        readDiskCounters(),
      ]);
      const now = Date.now();
      if (now - disk.at >= 10_000) {
        try {
          const fs = await statfs("/");
          disk = {
            total: fs.blocks * fs.bsize,
            used: Math.max(0, fs.blocks - fs.bfree) * fs.bsize,
            at: now,
          };
        } catch {
          disk = { total: null, used: null, at: now };
        }
      }
      const cpu = parseProcStat(statText);
      let cpuPercent: number | null = null;
      if (prevCpu && cpu.total > prevCpu.total) {
        cpuPercent = Math.min(
          100,
          Math.max(0, (1 - (cpu.idle - prevCpu.idle) / (cpu.total - prevCpu.total)) * 100),
        );
      }
      // guest/guest_nice 已包含在 user/nice；parseProcStat 只累加前八列，避免重复计数。
      prevCpu = cpu;
      const net = parseProcNetDev(netText);
      const network = rates(net, prevNet, now);
      const io = rates(diskCounters, diskCounters?.key === prevDisk?.key ? prevDisk : null, now);
      prevNet = { ...net, at: now };
      prevDisk = diskCounters ? { ...diskCounters, at: now } : null;
      traffic.add(now, net);
      const mem = parseProcMemInfo(memText),
        load = loadavg();
      latest = {
        t: now,
        cpuPercent,
        cpuPeak: cpuPercent,
        memTotalBytes: mem.totalBytes,
        memUsedBytes: Math.max(0, mem.totalBytes - mem.availableBytes),
        memCachedBytes: mem.cachedBytes,
        swapTotalBytes: mem.swapTotalBytes,
        swapUsedBytes: mem.swapUsedBytes,
        rxBytesPerSec: network.rx,
        txBytesPerSec: network.tx,
        rxPeak: network.rx,
        txPeak: network.tx,
        loadAvg1: load[0] ?? 0,
        loadAvg5: load[1] ?? 0,
        loadAvg15: load[2] ?? 0,
        uptimeSec: Number.parseFloat(uptimeText) || 0,
        rssBytes: process.memoryUsage().rss,
        diskTotalBytes: disk.total,
        diskUsedBytes: disk.used,
        diskReadBytesPerSec: io.rx,
        diskWriteBytesPerSec: io.tx,
      };
      startedAt ??= now;
      history.add(latest);
      available = true;
    } catch {
      available = false;
      // 失败区间没有可靠样本：重置基线，不把恢复后的差值冒充实时速率或今日流量。
      prevCpu = null;
      prevNet = null;
      prevDisk = null;
      traffic.resetBaseline();
    }
  }
  function sample() {
    // 并发首访与慢 IO 共用同一个采样 Promise，保持唯一写入顺序。
    if (!pending)
      pending = sampleOnce().finally(() => {
        pending = null;
      });
    return pending;
  }
  return {
    async touch(range: ServerStatsRange = "1m"): Promise<ServerStatsSnapshot> {
      if (!initialized) {
        await sample();
        if (!initialized) {
          initialized = true;
          if (available) {
            timer = setInterval(() => void sample(), 1000);
            timer.unref();
          }
        }
      }
      return {
        available,
        latest: latest ? { ...latest } : null,
        points: history.read(range, Date.now()),
        range,
        stepMs: SERVER_STATS_WINDOWS[range].step,
        host,
        startedAt,
        traffic: traffic.read(),
      };
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
let sampler: ReturnType<typeof createSysStatsSampler> | null = null;
export function getSysStatsSampler() {
  return (sampler ??= createSysStatsSampler());
}
