import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { DesktopTopOverlayActionButton } from "@/DesktopTopOverlayActionButton.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WebSidebarToggle({
  sidebarVisible,
  onToggle,
}: {
  sidebarVisible: boolean;
  onToggle: () => void;
}) {
  const { intl } = useZCodeIntl();
  const title = intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" });
  return (
    <DesktopTopOverlayActionButton
      title={title}
      ariaLabel={title}
      onClick={onToggle}
      testId="web-sidebar-toggle"
    >
      {/* Web 触屏没有 hover，侧栏入口必须始终显示，不能沿用桌面 logo 切换。
          图标语义与桌面端一致：展开时显示收起图标，收起时显示展开图标。 */}
      {sidebarVisible ? (
        <PanelLeftClose className="size-4" />
      ) : (
        <PanelLeftOpen className="size-4" />
      )}
    </DesktopTopOverlayActionButton>
  );
}
