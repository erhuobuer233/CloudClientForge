# toolchain —— 打包用的 Electron / electron-builder

这个目录的 `node_modules` **不进仓库**（约 450MB，第三方依赖），但工具运行需要它。
版本已经在 `package.json` 里钉死了（electron 44.7.2 + electron-builder 26.15.3）。

## 首次使用：两条命令

```powershell
cd toolchain
npm install                                   # 装 electron / electron-builder 包
node node_modules\electron\install.js         # 下载 Electron 运行时二进制（约 100MB）
```

> **为什么需要第二条**：Electron 44 起去掉了 `postinstall`，`npm install` 只装 npm 包，
> 不会下载 `node_modules\electron\dist`（约 100MB 的运行时）。没有它 electron-builder 会报
> `The specified electronDist does not exist`。
>
> `forge.ps1` / `tools\build-gui.ps1` / `tools\smoke-test.ps1` 都会**自动检测并补下载**，
> 所以手动装工具链时才需要跑第二条。

国内网络可以加镜像后再装：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm install
```

## 怎么判断装好了

下面两个路径存在就 OK：

```
toolchain/node_modules/electron/dist/electron.exe
toolchain/node_modules/electron-builder/package.json
```

`forge.ps1` 启动时会检查它们；缺了会直接报错并提示看这个文件。

## 换 Electron 版本

改 `package.json` 里的 `electron` 版本后重新 `npm install` 即可。生成新客户端时，
生成器会读取 `toolchain/node_modules/electron/package.json` 的版本号写进客户端配置，
不需要改代码。

## 也可以复用现成目录

如果本机别的 Electron 项目里已有 `node_modules`（含 electron + electron-builder），
整个拷到 `toolchain/node_modules` 也行，省一次下载。

## 常见问题：`The specified electronDist does not exist`

这是「electron 包装好了、但运行时二进制没下下来」的典型症状：`node_modules\electron\dist` 不存在。

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
cd node_modules\electron
node install.js
```

`tools\build-gui.ps1` 现在会自动检测并补下载，一般不需要手动处理。