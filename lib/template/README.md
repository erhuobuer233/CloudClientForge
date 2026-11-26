# @@PRODUCT@@ 桌面版

把官方网页端 <@@CLOUD_URL@@> 封装成一个独立的 Windows 桌面客户端。
本目录由 **CloudClientForge** 于 @@BUILT_AT@@ 自动生成。

> 说明：这是**本地封装官方网页**的个人工具，不是官方客户端，也不修改任何游戏数据。

**当前版本：`1.0.0`**

---

## 一、怎么启动

```
@@PRODUCT@@.exe
```

单文件、自带全部运行环境，**复制到任何地方都能直接运行**，不需要安装。
首次启动会解包运行环境（约 4 秒），之后约 1 秒。

- 也可以双击 `Start @@PRODUCT@@.cmd`（依次尝试：单文件 → 文件夹版 → 源码）
- 也可以把 `@@PRODUCT@@.zip` 直接发给别人（解压后就是 exe + 说明）

首次打开需要在页面里登录一次，登录状态会保存在本机，下次免登录。

## 二、它做了什么

| 功能 | 说明 |
| --- | --- |
| 圆角启动画面 | 打开时先显示一张圆角渐变启动卡（图标 + 名字 + 进度条），页面就绪后淡出 |
| 自绘对话框 | 退出确认 / 加载失败 / 页面卡住 都是圆角深色卡片，不是系统灰框 |
| 真全屏 | 没有浏览器外壳/地址栏/标签页，`F11` / `Alt+Enter` 随时切换 |
| 开始游戏前窗口化 | 默认 **1280×800 居中普通窗口**（不是最大化） |
| 开始游戏后自动全屏 | 检测到游戏画面出现就全屏；退出游戏自动恢复原窗口 |
| 防止息屏 | 全屏时阻止显示器休眠；后台不降频，避免串流卡顿 |
| 登录持久化 | 独立分区保存，下次打开免登录 |
| 外链交给浏览器 | 公告/下载/用户中心/协议/客服等一律用系统浏览器打开，客户端始终停在游戏页 |
| 退出干净 | 关窗 / `Alt+F4` 弹确认框，确认后强制结束进程，不留后台残留 |
| 托盘菜单 | 全屏、自动全屏开关、防息屏、退出前询问、重新加载、回入口、开发者工具 |

### 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `F11` / `Alt+Enter` | 全屏 ⇄ 窗口 |
| `Ctrl+Shift+H` | 回到入口页 |
| `F12` / `Ctrl+Shift+I` | 开发者工具 |
| `Ctrl` `+` / `Ctrl` `-` / `Ctrl+0` | 画面缩放 / 复位 |
| `Ctrl+W` | 已屏蔽（防止误关串流） |

> `F5` / `Ctrl+R` 故意不拦截（会和游戏内按键冲突）；重新加载请用托盘菜单。
> `Esc` 客户端不碰，交给页面。

## 三、配置与数据

| 内容 | 位置 |
| --- | --- |
| 设置 | `%APPDATA%\@@PRODUCT@@\settings.json` |
| 登录状态 / 缓存 | `%APPDATA%\@@PRODUCT@@\Partitions\...` |
| 解包缓存 | `%LOCALAPPDATA%\@@CACHE_ROOT@@\runtime\<payload指纹>`（约 320 MB） |

```json
{
  "autoFullscreen": false,
  "fullscreenInGame": true,
  "keepAwake": true,
  "confirmOnExit": true,
  "zoom": 1,
  "window": { "width": 1280, "height": 800, "x": null, "y": null, "maximized": false }
}
```

退出登录 / 清缓存：关掉客户端，删掉 `Partitions` 目录。恢复默认设置：删掉 `settings.json`。

## 四、常见问题

**第一次运行被 Windows 拦了？** SmartScreen 点「更多信息 → 仍要运行」；防火墙询问选「允许访问」（串流需要网络）。

**没有自动全屏？**
站点可能用了别的画面元素 id。可以：
1. 手动 `F11`（托盘里也能开）；
2. 用 `F12` 打开开发者工具看清画面元素的 id，然后重新生成客户端时加
   `-ProbeSelectors "#你的元素id"`（本项目 main.js 里的 `GAME_ELEMENT_IDS`）；
3. 或在托盘里直接勾「启动时自动全屏」。

**想换主题/名字/图标？** 重新用 CloudClientForge 生成一次即可（`-Name` / `-DisplayName` / `-IconUrl`）。

## 五、源码与重新打包

```
@@PRODUCT@@.exe          成品（单文件，带缓存启动器）
app\src\main.js          主进程（窗口、全屏、快捷键、托盘、外链、启动画面）
app\src\preload.js       预加载（全屏/键盘锁状态上报）
app\src\splash.html      圆角启动画面
app\src\modal.html       圆角自绘对话框（退出确认等）
app\assets\icon.ico      图标
_build\launcher.cs       单文件启动器源码
tools\build-client.ps1   重新打包（一条命令）
tools\create-shortcuts.ps1  重建桌面/开始菜单快捷方式
```

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-client.ps1
```

> 构建工具链在生成器的 `@@TOOLCHAIN@@\node_modules`（Electron + electron-builder）。
> 那个目录还在就能离线重新打包。

---

生成器：`@@GENERATED_BY@@`（改客户端逻辑请改生成器的模板，再重新生成）。
