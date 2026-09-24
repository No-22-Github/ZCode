/**
 * Web 端激活会话的位置记录。
 *
 * Bugfix：Web 入口此前从不给 Root 传 initialTaskId，刷新后总是回到
 * serverInfo.workspaces[0] 的首页，当前会话丢失。这里把 Root 层的激活
 * workspace + activeTaskId 同步到 sessionStorage 和 URL（?task=<id>），
 * 启动时由 main.tsx 读回（见 specs/web-refresh-restore-session/spec.md）。
 */
import { useEffect } from "react";
import { logger } from "@/logger.js";

export const WEB_ACTIVE_SESSION_STORAGE_KEY = "zcode:web:active-session";

export interface WebActiveSessionRecord {
  /** 激活会话 id；纯草稿态（尚未发首条消息）没有可恢复的服务端会话，缺省。 */
  sessionId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

/** 读取记录；缺失、损坏或字段非法一律返回 null，由调用方退回首页，不报错。 */
export function readWebActiveSessionRecord(): WebActiveSessionRecord | null {
  try {
    const raw = sessionStorage.getItem(WEB_ACTIVE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WebActiveSessionRecord> | null;
    if (!parsed || typeof parsed.workspacePath !== "string" || !parsed.workspacePath) {
      return null;
    }
    return {
      workspacePath: parsed.workspacePath,
      ...(typeof parsed.workspaceIdentity === "string" && parsed.workspaceIdentity
        ? { workspaceIdentity: parsed.workspaceIdentity }
        : {}),
      ...(typeof parsed.sessionId === "string" && parsed.sessionId
        ? { sessionId: parsed.sessionId }
        : {}),
    };
  } catch {
    return null;
  }
}

function writeLocationRecord(record: WebActiveSessionRecord | null): void {
  try {
    if (record) {
      sessionStorage.setItem(WEB_ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(record));
    } else {
      sessionStorage.removeItem(WEB_ACTIVE_SESSION_STORAGE_KEY);
    }
  } catch (error) {
    // 隐私模式等场景 sessionStorage 不可用：只丢恢复能力，不影响运行
    logger.debug("[webSessionSync] sessionStorage 不可用", error);
  }

  // URL 只放 taskId：工作区路径可能含敏感信息，且会触发自动填充/同步
  try {
    const url = new URL(window.location.href);
    if (record?.sessionId) {
      url.searchParams.set("task", record.sessionId);
    } else {
      url.searchParams.delete("task");
    }
    const nextHref = url.toString();
    if (nextHref !== window.location.href) {
      // replaceState 不产生历史记录，刷新/分享链接都能带上当前会话
      window.history.replaceState(null, "", nextHref);
    }
  } catch (error) {
    logger.debug("[webSessionSync] URL 同步失败", error);
  }
}

export interface WebActiveSessionSyncParams {
  /** 仅 Web 启用；桌面有自己的窗口级会话恢复，不能改 URL。 */
  enabled: boolean;
  workspacePath: string | undefined;
  workspaceIdentity?: string;
  sessionId: string | null;
}

export function useWebActiveSessionLocationSync({
  enabled,
  workspacePath,
  workspaceIdentity,
  sessionId,
}: WebActiveSessionSyncParams): void {
  useEffect(() => {
    if (!enabled) return;
    if (!workspacePath) {
      // 回到欢迎页/无激活 workspace：清掉记录，避免下次恢复到陈旧上下文
      writeLocationRecord(null);
      return;
    }
    writeLocationRecord({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
  }, [enabled, sessionId, workspaceIdentity, workspacePath]);
}
