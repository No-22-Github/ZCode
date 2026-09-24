import assert from "node:assert/strict";
import test from "node:test";
import {
  readWebActiveSessionRecord,
  WEB_ACTIVE_SESSION_STORAGE_KEY,
} from "../src/root/webActiveSessionLocationSync.js";
import {
  readSidebarVisiblePreference,
  saveSidebarVisiblePreference,
} from "../src/lib/sidebarVisibilityPreference.js";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function withStorage<T>(storage: StorageLike | undefined, run: () => T): T {
  const original = globalThis.sessionStorage;
  const originalLocal = globalThis.localStorage;
  globalThis.sessionStorage = storage as Storage;
  globalThis.localStorage = storage as Storage;
  try {
    return run();
  } finally {
    globalThis.sessionStorage = original;
    globalThis.localStorage = originalLocal;
  }
}

function memoryStorage(
  seed: Record<string, string> = {},
): StorageLike & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

test("readWebActiveSessionRecord returns null for missing, broken or invalid records", () => {
  withStorage(memoryStorage(), () => {
    assert.equal(readWebActiveSessionRecord(), null);
  });
  withStorage(memoryStorage({ [WEB_ACTIVE_SESSION_STORAGE_KEY]: "not json" }), () => {
    assert.equal(readWebActiveSessionRecord(), null);
  });
  withStorage(
    memoryStorage({
      [WEB_ACTIVE_SESSION_STORAGE_KEY]: JSON.stringify({ sessionId: "s1" }),
    }),
    () => {
      // 缺 workspacePath 的记录不可用，避免恢复到未知工作区
      assert.equal(readWebActiveSessionRecord(), null);
    },
  );
});

test("readWebActiveSessionRecord keeps valid fields and drops invalid ones", () => {
  withStorage(
    memoryStorage({
      [WEB_ACTIVE_SESSION_STORAGE_KEY]: JSON.stringify({
        sessionId: "task-1",
        workspacePath: "/srv/repo",
        workspaceIdentity: "identity-1",
      }),
    }),
    () => {
      assert.deepEqual(readWebActiveSessionRecord(), {
        sessionId: "task-1",
        workspacePath: "/srv/repo",
        workspaceIdentity: "identity-1",
      });
    },
  );
  withStorage(
    memoryStorage({
      [WEB_ACTIVE_SESSION_STORAGE_KEY]: JSON.stringify({
        sessionId: 42,
        workspacePath: "/srv/repo",
        workspaceIdentity: "",
      }),
    }),
    () => {
      // 非字符串 sessionId / 空 identity 只被丢弃，不影响工作区恢复
      assert.deepEqual(readWebActiveSessionRecord(), { workspacePath: "/srv/repo" });
    },
  );
});

test("sidebar visibility preference defaults to open and round-trips", () => {
  withStorage(memoryStorage(), () => {
    assert.equal(readSidebarVisiblePreference(), true);
    saveSidebarVisiblePreference(false);
    assert.equal(readSidebarVisiblePreference(), false);
    saveSidebarVisiblePreference(true);
    assert.equal(readSidebarVisiblePreference(), true);
  });
});

test("storage failures fall back to defaults instead of throwing", () => {
  withStorage(undefined, () => {
    // 隐私模式下全局存储可能不存在
    assert.equal(readSidebarVisiblePreference(), true);
    assert.doesNotThrow(() => saveSidebarVisiblePreference(false));
    assert.doesNotThrow(() => readWebActiveSessionRecord());
  });
});
