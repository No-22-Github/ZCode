/**
 * 终端启动期输出缓冲。
 *
 * Bugfix：terminalService.create() 返回 id 到前端完成 onDynamicData 订阅之间存在窗口期，
 * PTY 一启动就开始发数据，fish/zsh 等登录 shell 的启动输出（greeting、profile 警告）
 * 会因为尚无订阅者而整体丢失。这里把窗口期内的 chunk 存入 pending，首个订阅者
 * attach 时一次性按到达顺序补发；缓冲上限 64KB，超出丢最旧，保证内存严格有界。
 */

export const TERMINAL_PENDING_DATA_MAX_BYTES = 64 * 1024;

export interface TerminalPendingDataBuffer {
  /** 是否已有订阅者完成首次挂载；attach 之后不再缓冲。 */
  readonly attached: boolean;
  /** PTY onData 泵调用：未 attach 时存入缓冲，已 attach 时为直通 no-op。 */
  push(data: string): void;
  /**
   * 首个订阅者挂载时取出全部缓冲（按到达顺序）并标记 attached；
   * 之后的调用一律返回空数组，后续订阅者只收实时数据（重连补发不在范围内）。
   */
  attach(): readonly string[];
}

export function createTerminalPendingDataBuffer(
  maxBytes: number = TERMINAL_PENDING_DATA_MAX_BYTES,
): TerminalPendingDataBuffer {
  let chunks: string[] = [];
  let bytes = 0;
  let attached = false;

  return {
    get attached() {
      return attached;
    },
    push(data) {
      if (attached) return;
      chunks.push(data);
      bytes += Buffer.byteLength(data);
      // 超限丢最旧；单个超过整个上限的 chunk 会被整体丢弃，保证字节数严格有界。
      while (bytes > maxBytes && chunks.length > 0) {
        bytes -= Buffer.byteLength(chunks[0]!);
        chunks.shift();
      }
    },
    attach() {
      if (attached) return [];
      attached = true;
      const replay = chunks;
      chunks = [];
      bytes = 0;
      return replay;
    },
  };
}
