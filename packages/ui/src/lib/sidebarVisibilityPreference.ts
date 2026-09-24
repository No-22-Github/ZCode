/**
 * 侧栏显隐偏好（localStorage）。
 *
 * Bugfix：isSidebarVisible 之前只是 useAppPanels 里的 useState(true)，
 * 刷新后总是回到展开态，用户收起侧栏的选择丢失。这里统一读写 localStorage；
 * 存储不可用（隐私模式等）时静默退回默认展开。
 */
const STORAGE_KEY = "zcode:sidebar-visible";

export function readSidebarVisiblePreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveSidebarVisiblePreference(visible: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, visible ? "1" : "0");
  } catch {
    // 写不进去就只影响本次会话内的恢复，不打断交互
  }
}
