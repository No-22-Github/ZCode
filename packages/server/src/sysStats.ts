/**
 * VPS 系统状态采样（服务器状态悬浮球数据源）。
 *
 * 全部数据直接读 /proc，不引入任何依赖：
 * - CPU：/proc/stat 两次采样差值算使用率（idle 列含 iowait）；
 * - 内存：/proc/meminfo，已用 = MemTotal − MemAvailable。不用 os.freemem()，
 *   它把可回收缓存也算成“已用”，数字会偏高很多；
 * - 网速：/proc/net/dev 汇总除 lo 外所有网卡的收发字节，差值除以间隔得到速率；
 * - 附带 os.loadavg()、开机时长（/proc/uptime）和本进程 RSS。
 *
 * 采样器懒启动：首次有 /api/sys-stats 请求才开始跑；连续 30 秒无人请求自动停掉，
 * 没人看的时候不占资源。非 Linux（没有 /proc）时报告 available: false。
 */
import { readFile } from "node:fs/promises";
import { loadavg } from "node:os";

const SAMPLE_INTERVAL_MS = 1000;
const MAX_POINTS = 60;
const IDLE_STOP_AFTER_MS = 30_000;

export interface ServerStatsPoint {
  /** 采样时刻（epoch 毫秒） */
  t: number;
  /** CPU 使用率百分比；首个采样点没有前值，为 null */
  cpuPercent: number | null;
  memTotalBytes: number;
  memUsedBytes: number;
  /** 首个采样点为 null */
  rxBytesPerSec: number | null;
  /** 首个采样点为 null */
  txBytesPerSec: number | null;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  uptimeSec: number;
  rssBytes: number;
}

export interface ServerStatsSnapshot {
  available: boolean;
  points: ServerStatsPoint[];
}

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
    .slice(1)
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
export function parseProcMemInfo(text: string): { totalBytes: number; availableBytes: number } {
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

interface SysStatsSampler {
  /** 记录一次请求并返回当前点列；采样器未运行时懒启动。 */
  touch(): Promise<ServerStatsSnapshot>;
}

function createSysStatsSampler(): SysStatsSampler {
  const points: ServerStatsPoint[] = [];
  let timer: NodeJS.Timeout | null = null;
  let lastRequestedAt = 0;
  let samplingFailed = false;
  let prevCpu: CpuSample | null = null;
  let prevNet: { rxBytes: number; txBytes: number; at: number } | null = null;

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  async function sampleOnce(): Promise<void> {
    let statText: string;
    let memInfoText: string;
    let netDevText: string;
    let uptimeText: string;
    try {
      [statText, memInfoText, netDevText, uptimeText] = await Promise.all([
        readFile("/proc/stat", "utf8"),
        readFile("/proc/meminfo", "utf8"),
        readFile("/proc/net/dev", "utf8"),
        readFile("/proc/uptime", "utf8"),
      ]);
    } catch {
      // 没有 /proc（macOS/Windows 开发机）：报告不可用并停止采样，接口不报错
      samplingFailed = true;
      stop();
      return;
    }

    const now = Date.now();
    const cpu = parseProcStat(statText);
    let cpuPercent: number | null = null;
    if (prevCpu) {
      const totalDelta = cpu.total - prevCpu.total;
      const idleDelta = cpu.idle - prevCpu.idle;
      if (totalDelta > 0) {
        cpuPercent = Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
      }
    }
    prevCpu = cpu;

    const net = parseProcNetDev(netDevText);
    let rxBytesPerSec: number | null = null;
    let txBytesPerSec: number | null = null;
    if (prevNet) {
      const elapsedSec = (now - prevNet.at) / 1000;
      if (elapsedSec > 0) {
        // 计数器回绕或重启会出现负差值，钳到 0
        rxBytesPerSec = Math.max(0, (net.rxBytes - prevNet.rxBytes) / elapsedSec);
        txBytesPerSec = Math.max(0, (net.txBytes - prevNet.txBytes) / elapsedSec);
      }
    }
    prevNet = { rxBytes: net.rxBytes, txBytes: net.txBytes, at: now };

    const load = loadavg();
    const mem = parseProcMemInfo(memInfoText);
    points.push({
      t: now,
      cpuPercent,
      memTotalBytes: mem.totalBytes,
      memUsedBytes: Math.max(0, mem.totalBytes - mem.availableBytes),
      rxBytesPerSec,
      txBytesPerSec,
      loadAvg1: load[0] ?? 0,
      loadAvg5: load[1] ?? 0,
      loadAvg15: load[2] ?? 0,
      uptimeSec: Number.parseFloat(uptimeText.trim().split(/\s+/)[0] ?? "") || 0,
      rssBytes: process.memoryUsage().rss,
    });
    if (points.length > MAX_POINTS) {
      points.splice(0, points.length - MAX_POINTS);
    }
  }

  return {
    async touch() {
      lastRequestedAt = Date.now();
      if (samplingFailed) {
        return { available: false, points: [] as ServerStatsPoint[] };
      }
      if (!timer) {
        // 重新启动时丢弃跨空闲期的旧基线，避免首个点算出横跨整个空闲间隔的“平均速率”
        prevCpu = null;
        prevNet = null;
        timer = setInterval(() => {
          void sampleOnce();
          if (Date.now() - lastRequestedAt > IDLE_STOP_AFTER_MS) {
            stop();
          }
        }, SAMPLE_INTERVAL_MS);
        // 采样定时器不允许反过来把服务进程钉在内存里
        timer.unref?.();
        // 首次访问同步完成基线采样：非 Linux 主机立刻拿到 available:false，
        // Linux 主机立刻有第一个点；之后再交给定时器增量采样。
        await sampleOnce();
        if (samplingFailed) {
          stop();
          return { available: false, points: [] as ServerStatsPoint[] };
        }
      }
      return { available: true, points: [...points] };
    },
  };
}

let sampler: SysStatsSampler | null = null;

export function getSysStatsSampler(): SysStatsSampler {
  if (!sampler) {
    sampler = createSysStatsSampler();
  }
  return sampler;
}
