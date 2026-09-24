# Linux x64 VPS 部署

适用 Debian 12+ / Arch Linux x64（glibc）。CI 在 Ubuntu 22.04 x64 原生构建；不支持 Alpine/musl 或 ARM。压缩包包含 Web、Server、Agent、JS/native 依赖，不包含 Node 或浏览器二进制。

## 下载与解压

GitHub Actions 的 **Linux x64 VPS package** 工作流在 main 推送或手动运行时生成 `zcode-<上游版本>-no22.<run_number>.<run_attempt>.tar.gz` 和 `sha256.txt`。Artifacts 下载的外层是 ZIP，解开后才是这两个文件。保留 30 天，需要长期保存时自行备份。

服务器预先安装 Node **24.x**（CI 固定 24.14.0）、git、bash、tar。以下示例假设 Node 位于 `/usr/bin/node`；如不是，修改 service 中的 ExecStart 为 `command -v node` 的绝对路径，不要依赖交互 shell 的 fnm/nvm 初始化。首次部署：

```bash
node --version
sha256sum -c sha256.txt
sudo useradd --system --user-group --create-home --home-dir /var/lib/zcode --shell /bin/bash zcode
sudo install -d -o zcode -g zcode /var/lib/zcode/workspaces /var/lib/zcode/data
sudo tar -xzf zcode-<版本号>.tar.gz -C /opt
sudo cp /opt/zcode/deploy/zcode.service /etc/systemd/system/zcode.service
sudo systemctl daemon-reload
sudo systemctl enable --now zcode
sudo systemctl status zcode
curl --fail http://127.0.0.1:3030/api/server-info
```

`<版本号>` 替换为实际文件名；已有 zcode 用户时跳过 useradd。项目放入 `/var/lib/zcode/workspaces` 或其他该用户有权限的路径。包由 root 管理，Agent 使用 zcode 用户权限；git 身份、SSH 密钥、模型 API 配置也应在该用户环境中配置。浏览器工具需要时再安装兼容的浏览器和系统依赖。

## Cloudflare Tunnel / Access

将现有 Tunnel 的 published application route 指向 **http://127.0.0.1:3030**，HTTP 和 `/ws` WebSocket 共用此源站。Cloudflare Access 应用保护整个域名（包括 `/api/*` 和 `/ws*`），登录后即可访问页面。示例 unit 显式 `--no-token`，应用不会再要求第二份 token；不要把此无 token 服务改成公网监听，也不要把源站端口映射到公网。

cloudflared 与 ZCode 运行在同一 VPS 网络环境。如果 cloudflared 在独立容器中，容器的 127.0.0.1 不是宿主机，需让 Tunnel 与此 loopback 服务处于同一网络命名空间。

## 运维与更新

```bash
sudo journalctl -u zcode -f
sudo systemctl restart zcode
sudo systemctl stop zcode
```

浏览器关闭不等同于停止 systemd 服务。会话与项目保存在 `/var/lib/zcode`，不放入安装目录 `/opt/zcode`。升级前等长任务结束：校验新包，停止服务，将旧 `/opt/zcode` 移到版本备份目录，再解压新包并启动；不要覆盖式解压留下旧 JS chunk。回滚可切回旧包，数据目录保留。systemd 负责服务故障重启，**不保证服务重启后自动恢复正在执行的任务**。

CI 解包后验证 TUI/native、静态页面、server-info、WebSocket 和正常停止，不调用付费模型。具体模型配置、真实长任务、Cloudflare 端到端访问仍需在 VPS 验证。
