import assert from "node:assert/strict";
import test from "node:test";
import {
  TERMINAL_PENDING_DATA_MAX_BYTES,
  createTerminalPendingDataBuffer,
} from "../src/terminal/terminalPendingBuffer.js";

test("pending buffer replays buffered chunks once to the first subscriber", () => {
  const buffer = createTerminalPendingDataBuffer();
  assert.equal(buffer.attached, false);
  buffer.push("fish: greeting\n");
  buffer.push("warning: something\n");

  const replayed = buffer.attach();
  assert.deepEqual([...replayed], ["fish: greeting\n", "warning: something\n"]);
  assert.equal(buffer.attached, true);

  // 第二个订阅者不再拿到补发
  assert.deepEqual([...buffer.attach()], []);
});

test("pending buffer drops oldest chunks beyond the 64KB cap", () => {
  const buffer = createTerminalPendingDataBuffer(TERMINAL_PENDING_DATA_MAX_BYTES);
  const chunk = "a".repeat(16 * 1024);
  buffer.push(chunk);
  buffer.push(chunk);
  buffer.push(chunk);
  buffer.push(chunk);
  buffer.push(chunk); // 80KB > 64KB：最旧的 16KB 丢弃
  assert.equal(buffer.attached, false);

  const replayed = [...buffer.attach()];
  assert.equal(replayed.length, 4);
  const totalBytes = replayed.reduce((sum, item) => sum + Buffer.byteLength(item), 0);
  assert.ok(totalBytes <= TERMINAL_PENDING_DATA_MAX_BYTES);
  assert.ok(replayed.every((item) => item === chunk));
});

test("pending buffer drops an oversized single chunk whole", () => {
  const buffer = createTerminalPendingDataBuffer(1024);
  buffer.push("x".repeat(4096));
  assert.deepEqual([...buffer.attach()], []);
});

test("pending buffer stops buffering after attach", () => {
  const buffer = createTerminalPendingDataBuffer();
  buffer.attach();
  buffer.push("after attach\n");
  assert.deepEqual([...buffer.attach()], []);
});

test(
  "real pty keeps early output before the first subscription",
  { timeout: 20_000 },
  async (t) => {
    // node-pty 缺少原生产物时（如未编译的 CI 环境）跳过，不让环境问题伪装成回归
    let createTerminalService: typeof import("../src/terminal/terminalService.js").createTerminalService;
    try {
      ({ createTerminalService } = await import("../src/terminal/terminalService.js"));
    } catch (error) {
      t.skip(`terminalService unavailable: ${String(error)}`);
      return;
    }

    const settingService = {
      get: () => Promise.reject(new Error("settings unavailable in test")),
    } as unknown as import("../src/setting/setting.js").ISettingService;
    const service = createTerminalService({ settingService });

    const { id } = await service.create({ cols: 80, rows: 24, cwd: process.env.HOME ?? "/" });
    try {
      // create() 返回后立刻写入，此时订阅尚未建立，输出必须落入 pending 而不是丢失
      await service.write({ id, data: "echo zcode-race-marker-2\n" });
      const chunks: string[] = [];
      const subscription = service.onDynamicData(id)((data) => chunks.push(data));
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !chunks.join("").includes("zcode-race-marker-2")) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      subscription.dispose();
      assert.ok(
        chunks.join("").includes("zcode-race-marker-2"),
        `early output lost; received: ${JSON.stringify(chunks.slice(0, 10))}`,
      );
    } finally {
      await service.dispose({ id });
    }
  },
);
