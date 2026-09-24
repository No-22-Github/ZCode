import { PanelLeft } from "lucide-react";
import { DesktopTopOverlayActionButton } from "@/DesktopTopOverlayActionButton.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WebSidebarToggle({ onToggle }: { onToggle: () => void }) {
  const { intl } = useZCodeIntl();
  const title = intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" });
  return (
    <DesktopTopOverlayActionButton
      title={title}
      ariaLabel={title}
      onClick={onToggle}
      testId="web-sidebar-toggle"
    >
      {/* Web 触屏没有 hover，侧栏入口必须始终显示，不能沿用桌面 logo 切换。 */}
      <PanelLeft className="size-4" />
    </DesktopTopOverlayActionButton>
  );
}
