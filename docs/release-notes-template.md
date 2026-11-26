# RELEASE NOTES 模板

由 `.github/workflows/release.yml` 与 `tools/make-release.ps1` 使用。
占位符（会自动替换）：`{{VERSION}}`、`{{SHA256}}`、`{{DATE}}`、`{{COMMIT}}`。

---

把任何**云游戏网页**封装成一个 Windows 桌面客户端：一个网址 → 一个单文件 exe。

## 下载后怎么用（3 步）

1. 解压到任意目录（**路径尽量短，避免中文**）
2. 双击 `CloudClientForge.exe`（首次启动解包约 4 秒）
3. 粘贴云游戏网址 → 点「生成客户端」→ 产物在 `Cloudgame\<网址域名>\`

> 第一次生成会用到 Electron 工具链：在 `toolchain\` 里执行一次
> `npm install` 和 `node node_modules\electron\install.js`（`forge.ps1` 也会自动补）。
> 装好之后：完整生成约 25 秒，只改界面重新打包约 17 秒。

## 本版

- 版本：**v{{VERSION}}**
- 构建：{{DATE}} · commit `{{COMMIT}}`
- 校验：`SHA256 {{SHA256}}`

## 生成的客户端自带

- 默认 **1280×800 窗口化**，开始游戏才自动全屏，退出游戏自动恢复窗口
- 圆角启动画面 + 圆角自绘对话框（退出确认 / 加载失败 / 页面卡住）
- 登录状态持久化、全屏防息屏、后台不降频
- 网页类入口（公告 / 下载 / 用户中心 / 协议）一律交给系统浏览器，客户端始终停在游戏页
- 关窗确认 + 强制退出，不留后台残留
- 托盘菜单：全屏 / 启动时自动全屏 / 玩游戏时自动全屏 / 防息屏 / 退出前询问 / 重新加载 / 回到入口
- 单文件 exe（带缓存启动器）：首次解包约 4 秒，之后约 1 秒

## 系统要求

- **Windows 10 / 11（x64）**，不支持 macOS / Linux
- PowerShell 5.1+（系统自带）、.NET Framework 4.x（系统自带）
- Node.js **22.12+** 与 npm（仅首次装工具链需要）

## 边界与合规

- 不是官方客户端，也不会绕过任何登录 / 校验 / 反作弊；只是把你自己能打开的官方网页装进本地窗口
- **不含任何游戏资源**：图标是生成时从目标站点实时下载的，仓库与安装包里都没有
- 生成的客户端只建议**自己本机使用**；请遵守各站点服务条款，不要公开分发

## 反馈

- Issues：https://github.com/erhuobuer233/CloudClientForge/issues
- 源码（MIT）：https://github.com/erhuobuer233/CloudClientForge
