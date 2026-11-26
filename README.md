# CloudClientForge —— 一键把云游戏网页变成 Windows 桌面客户端

输入一个网址，输出一个**单文件 exe**：双击就玩，自带窗口化启动、开始游戏自动全屏、
登录持久化、外链交给浏览器、退出确认、防息屏、托盘菜单，以及「首次解包、之后 1 秒启动」的缓存启动器。

两种用法，功能完全一样（GUI 只是 forge.ps1 的界面壳）：

- **图形界面**：双击 **`CloudClientForge.exe`** → 粘贴网址 → 点「生成客户端」
- **命令行**：`powershell -ExecutionPolicy Bypass -File forge.ps1 -Url "https://xxx.com/cloudgame"`，
  或者双击 `forge.cmd`（会提示你粘贴网址）

> 非官方工具：只是把你自己能打开的网页装进一个本地窗口，不绕过登录、不修改游戏文件、
> 也不包含任何厂商资源；请遵守各站点服务条款，仅个人使用。

> **直接下载**：Windows 便携版在 [Releases](https://github.com/erhuobuer233/CloudClientForge/releases/latest)
> （`CloudClientForge-v<版本>-win-x64.zip`，解压即用）。第一次生成前，在 `toolchain\` 里跑一次
> `npm install` + `node node_modules\electron\install.js`；之后 `forge.ps1` / 界面都会自动复用。

跑完你会得到：

```
<安装目录>\Cloudgame\example.com\
├─ Example Cloud.exe           ← 单文件客户端（双击即用）
├─ Example Cloud.zip           ← 分发包（exe + 说明，直接发给别人）
├─ app\                        ← Electron 源码（要改逻辑就改这里并重新打包）
├─ _build\launcher.cs
├─ tools\build-client.ps1      ← 重新打包（一条命令）
├─ README.md / CHANGELOG.md
└─ dist\
```

> 默认输出到 `<本目录>\Cloudgame\<网址域名>`，一个站点一个文件夹，不会互相覆盖。
> 传了 `-Out`（或在界面里填了目录）就用你指定的；如果把目录指到生成器自己身上，
> 生成器会直接拒绝并提示改回默认，免得把工具目录搞乱。

工具自己的目录长这样：

```
<安装目录>\
├─ CloudClientForge.exe    ← 图形界面（双击即用，需和下面这些同级）
├─ forge.ps1 / forge.cmd   ← 命令行入口
├─ VERSION                 ← 版本号（发版改这一处，forge / build-gui 都读它）
├─ build-exe.cmd           ← 双击重新生成 CloudClientForge.exe（首次全量，之后快速）
├─ gui\app\                ← 界面源码（改界面改这里，tools\build-gui.ps1 重新打包）
├─ lib\template\           ← 生成的客户端用的模板（main.js / launcher.cs / 脚本 / README）
├─ lib\make-icon.ps1       ← favicon → 多分辨率 ico
├─ tools\                  ← build-client.ps1（生成项目内） / build-gui.ps1（界面自身）
├─ toolchain\              ← Electron + electron-builder（.gitignore，需要时 npm install）
├─ Cloudgame\              ← 默认输出目录（.gitignore）：一个网址一个子文件夹
├─ LICENSE                 ← MIT（只覆盖本项目源码）
└─ .gitignore              ← 排除 toolchain/node_modules、exe/zip、Cloudgame/ 等
```

---

## 系统要求

| 项 | 要求 |
| --- | --- |
| 系统 | **仅 Windows 10 / 11（x64）**。打包依赖 Windows 自带的 `.NET Framework` `csc.exe` 与 Win32 路径，macOS / Linux 不能运行 |
| PowerShell | 5.1 或更高（Win10/11 自带）；`forge.ps1` 启动时会自检 |
| Node.js | **22.12+** 与 npm（Electron 44 的引擎要求；只用于装一次工具链 `toolchain\`，以及 `npm start` 调试源码） |
| 磁盘 | 约 1.5 GB（工具链 450MB + 一个生成客户端约 420MB + 解包缓存） |
| 其它 | 打包/运行不需要管理员权限；生成的客户端只依赖系统自带 .NET Framework 4.x |

## 图形界面（CloudClientForge.exe）

双击根目录的 **`CloudClientForge.exe`** 就能用，不用记参数：

| 区域 | 能做什么 |
| --- | --- |
| 左栏 | 粘贴网址；展开「高级选项」可改 产品名 / 窗口标题 / 输出目录 / 图标地址 / 游戏画面元素 id / 额外允许地址 |
| 输出目录 | **留空 = 默认** `<生成器目录>\Cloudgame\<网址域名>`（输入框里会实时显示这个默认路径）；旁边「浏览」选别的目录，点「默认」一键回到默认 |
| 开关 | 创建桌面快捷方式、打包 zip、只生成工程、覆盖同名目录 |
| 右栏 | 6 个阶段的实时进度、完整构建日志（可滚动）、取消按钮、工具链状态 |
| 完成后 | 直接「打开目录 / 复制路径 / 再生成一个」 |
| **启动器（顶部标签）** | 自动扫 `Cloudgame\<域名>\*.exe`，列出已生成的客户端（图标 / 名字 / 域名 / 大小 / 时间），**点「启动」直接运行**，也可打开所在文件夹、刷新列表；卡片支持双击启动；生成结束后自动刷新，数量显示在标签角标上 |
| 客户端管理 | 每行右侧 `⋯`：**重命名**（改 exe 文件名，同目录 `Start *.cmd` 一起更新）、**更换图标**（选 png/ico/jpg，自动转成多尺寸 ico）、**删除客户端**（圆角确认框，删整个 `Cloudgame\<域名>` 目录） |
| 主题 | 标题栏 ☀ / ☾ 一键切换**深色 / 浅色**，写进设置文件，下次启动沿用 |
| 独立启动器 | 标题栏 ▤ 或**托盘菜单「打开启动器」**唤出一个 520×660 的小面板：不打开主界面也能直接启动游戏；托盘菜单还有「显示主界面 / 退出」 |

- 托盘常驻：关掉主窗口只是收进托盘（托盘菜单「退出」才真正退出），方便随时唤出启动器。
- **单实例**：重复双击 exe 不会叠出多个窗口，只会把已有窗口提到前面。
- 底部状态栏末尾会显示当前版本（例如 `v1.2.1`），方便确认自己用的是哪一版。
- 界面记住上次填的内容与主题（`%APPDATA%\CloudClientForge\settings.json`）。
  其中**输出目录留空表示用默认值**；如果旧版本里存过「生成器自己的目录」这类值，启动时会自动清掉。
- 它是**前端**：真正的生成逻辑还是根目录的 `forge.ps1`，所以 **exe 必须和 `forge.ps1`、`toolchain\` 放在同一目录**
  （启动器会把所在目录通过 `CLOUDFORGE_HOME` 传给界面）。
- 首次启动解包运行环境约 4 秒，之后约 1 秒。
### 生成 / 重新生成 CloudClientForge.exe

最省事：**双击根目录的 `build-exe.cmd`**（首次完整打包，之后自动走快速模式）。

命令行：

```powershell
# 首次（或换了工具链/图标）：完整打包，约 1~2 分钟
powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1

# 之后只改了界面代码：快速重建，约 20 秒
powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1 -Fast

# 强制完整重建 / 保留 320MB 中间产物
powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1 -Clean
powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1 -KeepRelease
```

| 模式 | 做什么 | 耗时 |
| --- | --- | --- |
| 默认（完整） | electron-builder 重新生成 `_build\gui-release\win-unpacked`（复制 320MB 运行时） | 约 1~2 分钟 |
| `-Fast` | **复用**已有 `win-unpacked`，只重打 `app.asar` → 重打 payload → 编译 exe | 约 17~20 秒 |
| `-Clean` | 忽略缓存强制完整重建 | 同完整 |

> `-Fast` 需要上一次构建保留运行时（`build-exe.cmd` 会自动加 `-KeepRelease`）。
> 想省 320MB 空间就手动删掉 `_build\gui-release`，下次自动回到完整构建。
> 工具链没装时脚本会自己 `npm install`（`-NoInstall` 可关闭）。

界面代码在 `gui\app\`（`src/main.js`、`src/preload.js`、`src/ui/*`），样式全在 `src/ui/styles.css`。

## 快速开始

```powershell
cd <安装目录>

# 最简：只给网址（产品名/图标/显示名自动推导）
powershell -ExecutionPolicy Bypass -File forge.ps1 -Url "https://example.com/cloudgame"

# 指定名字（exe 名、目录名都用它，必须是英文）
powershell -ExecutionPolicy Bypass -File forge.ps1 `
    -Url "https://example.com/cloudgame" `
    -Name "Example Cloud" `
    -DisplayName "示例云游戏"

# 同时创建桌面/开始菜单快捷方式
powershell -ExecutionPolicy Bypass -File forge.ps1 -Url "..." -Shortcuts
```

> 只要在**普通 PowerShell**里跑就行（不需要管理员）。生成的项目完全独立，
> 可以整个目录拷走/改名/删掉，不影响本工具。
>
> 忘了参数？直接运行 `forge.ps1`（或加 `-Help`）会打印完整用法。

## 参数

| 参数 | 说明 |
| --- | --- |
| `-Url`（必填，除非 `-Help`） | 云游戏网页地址，例如 `https://xxx.com/cloudgame` |
| `-Name` | 英文产品名（exe/目录名）。默认由域名推导，如 `game.example.com` → `Game Cloud` |
| `-DisplayName` | 窗口标题 / 界面显示名，默认取网页标题 |
| `-Out` | 输出目录，默认 `<本目录>\Cloudgame\<网址域名>`（例如 `<安装目录>\Cloudgame\example.com`） |
| `-ProbeSelectors` | 「进入游戏」要看的画面元素 id，逗号分隔，`#`/`.` 可省。默认 `WelinkGameVideo,gamePlayLayer,gameVideo,game-player,gameCanvas` |
| `-AllowUrls` | 额外允许留在客户端内的地址（登录域名、支付域名等），可多个 |
| `-IconUrl` | 指定图标。默认自动找页面 `<link rel="icon">`，再退回 `/favicon.ico` |
| `-SkipBuild` | 只生成工程，不打包（快，用于调整参数/改代码） |
| `-SkipZip` | 不生成 zip |
| `-Shortcuts` | 生成桌面 / 开始菜单快捷方式 |
| `-Force` | 输出目录已存在时覆盖 |
| `-OpenFolder` | 完成后打开输出目录 |

## 它做了什么

1. **读网址**：抓页面（按页面 charset 解码，中文标题不会乱码）→ 取标题、favicon。
2. **推导命名**：域名 → 英文产品名；网页标题 → 显示名；再算出用户数据目录、缓存目录、单实例互斥名。
3. **生成工程**：从 `lib\template\` 套模板写出 `app\src\main.js`、`preload.js`、`package.json`、
   `_build\launcher.cs`、`tools\*.ps1`、`Start *.cmd`、`README.md`、`CHANGELOG.md`、`dist\README.txt`。
4. **生成图标**：favicon → 多分辨率 `icon.ico`（16/24/32/48/64/128/256）+ `icon.png`；
   没有 favicon 就按名字生成占位图标（渐变方块 + 首字母）。
5. **打包**：electron-builder 出文件夹版 → 压成 `payload.zip` → 按 SHA256 生成缓存指纹 →
   用 .NET 自带 `csc` 把 payload 编进启动器 → 得到单文件 exe。
6. **分发**：把 exe + 说明打成 `zip`；顺手清掉 320MB 的中间产物（随时可重建）。

## 客户端里的关键设计（模板已内置）

- **圆角启动画面**：打开时先显示一张圆角渐变启动卡（图标 + 名字 + 进度条），页面就绪后淡出
  （至少停留 0.8 秒，避免只闪一下）：
- **自绘圆角对话框**：退出确认 / 加载失败 / 页面卡住都不再用系统灰框，而是同一套深色圆角卡片：
- **默认窗口化**：1280×800 居中、不最大化；`F11` / `Alt+Enter` 手动全屏。
- **开始游戏才全屏**：每 800ms 探测一次「是否已在游戏画面」，判据是
  ① 页面自己全屏；② 命中的画面元素**可见**且铺开（canvas / 有流 / 有画面 / 内含媒体）；
  ③ 兜底：铺满 ≥70% 视口的且正在播放的 video / canvas。
  **只在状态跳变时动作**，手动切的全屏不会被抢回来；退出游戏恢复原窗口。
  （启动界面里「先创建好但隐藏」的元素不会命中。）
- **外链交给浏览器**：`window.open`、`target=_blank`、页面顶层跳转，
  只要不是入口页自己的地址，全部 `shell.openExternal`，客户端永远停在游戏页。
- **退出干净**：关窗 / `Alt+F4` 弹确认框，确认后 `destroy()` + `app.quit()` + 2 秒 `app.exit()` 兜底。
- **串流友好**：`backgroundThrottling:false`、全屏 `powerSaveBlocker('prevent-display-sleep')`、
  权限请求全放行、UA 伪装成普通 Chrome。
- **单文件缓存启动器**：首次解包到 `%LOCALAPPDATA%\<产品名>Desktop\runtime\<payload指纹>`，
  之后直接启动；重新打包后指纹变化，旧缓存自动清理；启动子进程时会清掉
  `ELECTRON_RUN_AS_NODE`（否则会被某些环境带坏，表现为「双击没反应」）。

## 依赖与工具链

- `toolchain\`：Electron 44.7.2 + electron-builder 26。版本钉在 `toolchain\package.json` 里，
  首次使用 `cd toolchain; npm install` 即可（`node_modules` 不进仓库）。
  生成的 `app\package.json` 里用 `electronVersion` + `electronDist` 直接指向它，
  并且**故意不写 `devDependencies`**——否则 electron-builder 会顺手在 `app\` 里跑一次
  `npm install`（几百 MB + 联网），完全没必要。
- 打包还需要 Windows 自带的 `.NET Framework` 的 `csc.exe`（系统自带）。
- 生成的项目里没有 `app\node_modules`。想用 `npm start` 调试源码的话，
  在 `app\` 里 `npm install` 一次即可（只是调试用，打包不需要）。
- 界面（`CloudClientForge.exe`）也复用同一个 toolchain；它自己的工程在 `gui\app\`，
  用 `tools\build-gui.ps1` 重新打包。

> 如果以后要换 Electron 版本：改 `toolchain\package.json` 里的版本号，重新 `npm install`。
> 生成新客户端时会从 `toolchain\node_modules\electron\package.json` 自动读版本号。

## 改模板 = 改所有新生成的客户端

客户端逻辑都在 `lib\template\`：

| 文件 | 作用 |
| --- | --- |
| `main.js` | 主进程：窗口、全屏判据、快捷键、托盘、外链、退出、防息屏 |
| `preload.js` | 全屏 / 键盘锁状态上报 |
| `launcher.cs` | 单文件缓存启动器 |
| `splash.html` | 圆角启动画面（图标 + 名字 + 进度条） |
| `modal.html` + `modal-preload.js` | 圆角自绘对话框（退出确认 / 加载失败 / 卡住） |
| `build-client.ps1` | 生成的项目里那条重新打包命令 |
| `create-shortcuts.ps1` | 快捷方式 |
| `start.cmd` | 兜底启动器（ASCII） |
| `README.md` | 生成项目里的使用说明 |

改完模板重新 forge 一次即可（已生成的老项目不会自动更新）。

## 常见问题

**1. 打不开这个网址 / 超时**
生成器需要先访问页面来读标题和图标。站点挂了、需要登录、需要代理时都会失败。
可以先用浏览器确认能打开；确实无法访问时，用 `-Name` + `-DisplayName` + `-IconUrl` 也能生成
（此时它仍然会尝试访问一次网址，失败会直接报错，不会生成半成品）。

**2. 产品名提示只能英文**
exe 文件名/目录名走 ASCII 是为了避免中文路径在打包工具、脚本里出编码问题；
中文放进 `-DisplayName`（窗口标题）即可。

**3. 进游戏没有自动全屏**
说明站点用的画面元素 id 不在默认列表里，而且没有被「铺满 70% 视口」的兜底命中。
按 `F12` 打开开发者工具，找到游戏画面元素（`<video>` / `<canvas>` / 容器 div）的 id，然后：

```powershell
powershell -ExecutionPolicy Bypass -File forge.ps1 -Url "..." -ProbeSelectors "#你的id"
```

也可以不改判据：客户端托盘菜单里有「启动时自动全屏」，或直接 `F11`。

**4. 图标是占位图**
页面 favicon 不是 PNG/JPG/ICO（比如 webp/svg）时无法解码，会退化成占位图。
用 `-IconUrl` 指一个 png/ico 地址，或手工替换生成项目里的 `app\assets\icon.ico` 后重新打包。

**4.5 打包报 `The specified electronDist does not exist`？**

说明 electron 的**包**装好了，但它的**运行时二进制**（`toolchain\node_modules\electron\dist`，约 100MB）
没下载下来。**Electron 44 起已经没有 postinstall 了**，`npm install` 只装包、不下二进制，
必须再跑一次 `node node_modules\electron\install.js`（或 `npx install-electron`）。

现在构建脚本会自动检测并补下载（带 npmmirror 镜像），日志里会看到
`Electron 运行时缺失，正在补下载二进制…`。手动补也行：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
cd toolchain\node_modules\electron
node install.js
```

**4.6 首次运行就报 `Invalid configuration object` / `configuration.electronVersion should be: null | string`？**

v1.2.0 及更早的一个真实 bug：**恰好在那次运行里第一次安装工具链**时，`npm install` 的输出会被
`Ensure-Toolchain` 当成返回值，`$electronVersion` 变成 `["", "added 284 packages in 47s", "44.7.2"]`
这样的数组，写进 `app\package.json` 后 electron-builder 直接拒绝。

- **处理**：升级到 **v1.2.1+**（`ensure-toolchain.ps1` 已修：npm/node 输出改走 host 流 + 临时降级 EAP）
- 已经生成的坏目录：勾上「覆盖同名目录」重新生成一次即可；也可以手工把 `app\package.json` 里的
  `"electronVersion": [...]` 改成 `"electronVersion": "44.7.2"`
- 判断特征：`package.json` 里 `electronVersion` 不是单个字符串

**5. 打包失败：找不到 electron-builder**
`toolchain\node_modules` 被删了。把它恢复（从别的客户端项目 `app\node_modules` 拷一份），
或者进生成项目的 `app\` 目录 `npm install`，再把 `tools\build-client.ps1` 里的 `$eb`
改成 `app\node_modules\.bin\electron-builder.cmd`。

**6. 换了机器 / 拷走了生成的项目**
`app\package.json` 里的 `electronDist` 和 `tools\build-client.ps1` 里的 `$toolchain` 是本机绝对路径。
打包需要它们指向一个有效的 toolchain；只想**用**客户端的话不受影响（exe 自带运行环境）。

## 合规与免责声明

这个项目**只是一个本地网页外壳**：把你本来就能用浏览器打开的网页，装进一个没有浏览器壳的
窗口里，再补上全屏、防息屏、退出确认这些体验。请先确认下面几条再使用 / 分发：

- **不提供任何游戏资源**：仓库里没有游戏客户端、美术素材、字体、图标、账号数据。
  生成客户端时，图标是你本机从目标站点实时下载的，不随仓库分发。
- **不绕过任何技术措施**：不做登录绕过、反作弊规避、协议逆向、抓包改包；登录仍然走站点自己的页面。
- **遵守站点服务条款**：是否允许第三方外壳访问，由各站点自己的 ToS 决定；用之前请自行确认，
  风险自负。工具作者不对因使用本工具导致的账号/服务问题负责。
- **生成的客户端只供个人本机使用**：它包含站点图标与页面内容，版权归原权利人；
  **不要公开分发**生成的客户端安装包。
- **商标与名称**归各自权利人所有；本仓库不 affiliated、不 endorsed，README 里示例一律使用
  `example.com` 这类占位域名。

## 分发（Releases）

仓库**不放** `*.exe` / `*.zip`（单文件客户端 130MB+，超过 GitHub 单文件 100MB 限制）。
要发布成品就走 GitHub Releases：

```powershell
# 本地打包
CloudClientForge.exe            # 或者：
powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1

# 上传（需要 gh CLI 登录）
gh release create v1.0.0 CloudClientForge.exe `
  --title "CloudClientForge v1.0.0" `
  --notes "Windows 10/11 x64；首次运行会解包约 4 秒。"
```

Release 里的 exe 只是**工具本体**（138MB）；它仍然需要同目录的 `forge.ps1` 和 `toolchain\` 才能生成客户端，
所以更推荐把“工具 + 用法”打包成 zip（源码或带 toolchain 的完整包）放 Release。

## 开发与 CI

- `tools\smoke-test.ps1`：**冒烟测试**——只生成工程、不打包 exe，检查模板占位符是否全部替换、
  图标是否合法 ICO、生成的 JS 语法是否正确。本地随时能跑：

  ```powershell
  powershell -ExecutionPolicy Bypass -File tools\smoke-test.ps1
  ```

- CI：`.github\workflows\ci.yml`（`windows-latest`）会 `npm install` 工具链并跑上面这条冒烟测试。
  想省 CI 时间可以把 Electron 缓存换成 `actions/cache`（工作流里已带）。
### 自动发版（GitHub Actions）

`.github\workflows\release.yml`：**推 tag 就自动出包**。

```powershell
git tag v1.0.1
git push origin v1.0.1
```

流程：`windows-latest` → 装 toolchain（含 Electron 运行时）→ `tools\make-release.ps1 -Version <tag>`
（构建 exe、组装便携包、算 SHA256、渲染发布说明）→ 上传 artifact → `gh release create`
（附件是便携 zip，正文取自 `docs\release-notes-template.md`）。

- 手动触发：Actions → **Release** → Run workflow，填版本号；勾 `dry_run` 只构建不发版
- 本地等价一条命令：

  ```powershell
  powershell -ExecutionPolicy Bypass -File tools\make-release.ps1 -Version 1.0.1
  # 产物在 release-assets\（已在 .gitignore 里）
  ```

- 版本号只来自 tag / `-Version`，不会从上次生成的产物里继承，避免版本漂移

- 没有单测框架：这个项目本质是「拼装 + 打包」，冒烟测试覆盖了最容易坏的环节
  （模板替换、路径、图标、语法）。

## 仓库里有什么（准备上传 GitHub 时看这里）

刻意**不放进仓库**的东西（都已写进 `.gitignore`）：

| 路径 / 文件 | 为什么不提交 |
| --- | --- |
| `toolchain\node_modules\` | 约 450MB 第三方依赖（Electron + electron-builder），按需安装，见 `toolchain\README.md` |
| `Cloudgame\` | 生成的客户端（exe / zip / 站点图标 / 站点名），一个网址一个文件夹 |
| `*.exe`、`*.zip` | 单文件客户端 130MB+，超过 GitHub 单文件 100MB 限制；要分发用 Releases |
| `_build\gui-release\`、`_build\*payload*` | 打包中间产物，随时可重建 |
| `_build\PayloadInfo.cs` | 由 `tools\build-gui.ps1` 按 payload 指纹生成 |

提交的是**源码**：`forge.ps1`、`forge.cmd`、`build-exe.cmd`、`lib\template\`（客户端模板：main.js / 启动画面 /
自绘对话框 / 启动器 / 打包脚本）、`gui\app\`（界面）、`tools\`（打包 + 冒烟测试）、
`.github\workflows\ci.yml`、`toolchain\package.json` + `toolchain\README.md`、`README.md`、
`LICENSE`、`.gitignore`、`.gitattributes`。

首次 clone 之后：

```powershell
cd toolchain
npm install electron@44.7.2 electron-builder@26.15.3
# 回到根目录后双击 CloudClientForge.exe（或跑 forge.ps1）即可
```

> 生成客户端时，图标是从目标站点实时下载的（favicon / apple-touch-icon），不随仓库分发；
> 这些图标与站点内容版权归原权利人，生成的客户端只适合自己本机使用。
## 已验证

| 生成对象 | 结果 |
| --- | --- |
| 云游戏站点 A（网页端 + 蔚领 SDK 的 3D 项目） | ✅ 自动命名、标题取页面标题、favicon 转图标；exe 启动后 **1280×800 窗口化**、独立缓存目录；进游戏后自动全屏 |
| 云游戏站点 B（另一款、同一套 SDK） | ✅ 标题自动去掉「官方网站」这类尾巴、图标取 apple-touch-icon；出 exe + zip，全新配置下同样是 1280×800 窗口 |
| 图形界面全流程 | ✅ 在 `CloudClientForge.exe` 里粘网址点生成：状态从「生成中」到「完成」、6 个阶段逐个点亮、日志实时滚动、结束弹出结果卡片（打开目录/复制路径）；生成的 exe + zip 均正常 |

这两个都是**本机实测**跑出来的结果，仓库里不带任何生成产物（`Cloudgame\` 已在 .gitignore 里）。
生成器版本用的是通用判据；针对具体站点还可以用 `-ProbeSelectors` 微调。

> 小提示：客户端按「产品名」区分用户数据目录（`%APPDATA%\<产品名>`）。
> 如果新生成的客户端和旧客户端同名，会**复用同样的窗口大小 / 登录配置**——
> 想完全从零开始，换个 `-Name`，或先删掉 `%APPDATA%\<产品名>`。

> 生成出来的客户端具体表现（登录、开始游戏自动全屏等）取决于站点本身；
> 「进入游戏」的判据可以用 `-ProbeSelectors` 按站点微调。
