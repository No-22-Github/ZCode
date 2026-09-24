import type { ReactNode } from "react";
import { AlertDialogHost } from "@/AlertDialogHost.js";
import { ConfirmDialogHost } from "@/ConfirmDialog.js";
import { CuaPermissionObservationAttachment } from "@/cua-permission/CuaPermissionObservationAttachment.js";
import { ServerStatsBall } from "@/components/ServerStatsBall.js";

export function RootShell({ children }: { children: ReactNode }) {
  // Web 远控在手机浏览器里不能用固定 100vh，
  // 地址栏收放会让底部输入区被裁到视口外；根节点改用动态视口高度。
  return (
    <div className="relative h-dvh">
      {children}
      <CuaPermissionObservationAttachment />
      <AlertDialogHost />
      <ConfirmDialogHost />
      {/* 仅 Web 端渲染；桌面端组件内部直接返回 null */}
      <ServerStatsBall />
    </div>
  );
}
