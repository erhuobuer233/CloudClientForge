# 打包 CloudClientForge 界面本身 → 根目录 CloudClientForge.exe（单文件，带缓存启动器）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1            # 完整构建（约 2 分钟）
#   powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1 -Fast      # 快速重建（复用运行时，约 40 秒）
#   powershell -ExecutionPolicy Bypass -File tools\build-gui.ps1 -Clean     # 强制完整重建
#
# 参数：
#   -Fast        复用 _build\gui-release\win-unpacked，只重打 app.asar（改界面代码后用这个）
#   -KeepRelease 保留 320MB 的文件夹版中间产物（方便排查/二次实验）
#   -NoInstall   工具链缺失时不自动 npm install，直接报错
param(
    [switch]$Fast,
    [switch]$KeepRelease,
    [switch]$NoInstall,
    [switch]$Clean,
    # 版本号：默认取环境里的 tag（CI 用 GITHUB_REF_NAME=v1.2.3），再退回 1.0.0
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$total = [System.Diagnostics.Stopwatch]::StartNew()

$root      = Split-Path $PSScriptRoot -Parent
$guiApp    = Join-Path $root 'gui\app'
$release   = Join-Path $root '_build\gui-release'
$appDir    = Join-Path $release 'win-unpacked'
$build     = Join-Path $root '_build'
$payload   = Join-Path $build 'gui-payload.zip'
$infoCs    = Join-Path $build 'PayloadInfo.cs'
$out       = Join-Path $root 'CloudClientForge.exe'
$csc       = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$toolchain = Join-Path $root 'toolchain'
$eb        = Join-Path $toolchain 'node_modules\.bin\electron-builder.cmd'
$electronExe = Join-Path $toolchain 'node_modules\electron\dist\electron.exe'
$asarCli   = Join-Path $toolchain 'node_modules\@electron\asar\bin\asar.js'

if (-not $Version) {
    $candidate = if ($env:GITHUB_REF_NAME) { $env:GITHUB_REF_NAME } else { '' }
    if ($candidate -match '^v?(\d+\.\d+\.\d+)$') { $Version = $Matches[1] }
}
# 注意：不要从上次生成的 package.json 读版本，否则本地构建会在 1.0.0 / 1.0.1 之间漂移。
# 版本只来自 -Version 或 CI 的 tag，其它情况固定 1.0.0。
if (-not $Version) { $Version = '1.0.0' }
$Version = $Version.TrimStart('v')
$asmVersion = if ($Version -match '^\d+\.\d+\.\d+') { ($Version -replace '[^0-9.].*$', '') + '.0' } else { '1.0.0.0' }
function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }

Step '0/5 检查环境'
if (-not (Test-Path $csc)) { throw "找不到 .NET 编译器 csc.exe：$csc（需要 Windows + .NET Framework）" }
if (-not (Test-Path (Join-Path $build 'launcher-gui.cs'))) { throw "找不到 $build\launcher-gui.cs" }

# 工具链自检（缺依赖自动装、缺 Electron 运行时自动补下载）——与 forge.ps1 共用同一份逻辑。
# 注意：Electron 44 起没有 postinstall，`npm install` 只装包、不下二进制，
# 所以第一次用必须再跑一次 node_modules\electron\install.js（脚本已自动处理）。
. (Join-Path $root 'lib\ensure-toolchain.ps1')
$electronVersion = Ensure-Toolchain -Toolchain $toolchain -NoInstall:$NoInstall
if ("$electronVersion" -notmatch '^\d+\.\d+\.\d+') {
    throw "Electron 版本异常：'$electronVersion'（应形如 44.7.2）"
}
Write-Host "   electron $electronVersion / electron-builder OK  |  CloudClientForge v$Version"

Step '1/5 生成界面图标'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'lib\make-forge-icon.ps1') -OutDir (Join-Path $guiApp 'assets')
if ($LASTEXITCODE -ne 0) { throw '图标生成失败' }

Step '2/5 写 gui\app\package.json'
$pkg = [ordered]@{
    name          = 'cloudclientforge-gui'
    productName   = 'CloudClientForge'
    version       = $Version
    description   = 'CloudClientForge - 一键把云游戏网页变成桌面客户端'
    author        = '本地封装'
    license       = 'MIT'
    private       = $true
    main          = 'src/main.js'
    build         = [ordered]@{
        appId                 = 'com.cloudclientforge.gui'
        productName           = 'CloudClientForge'
        electronVersion       = $electronVersion
        electronDist          = '../../toolchain/node_modules/electron/dist'
        electronLanguages     = @('zh-CN', 'en-US')
        # 关闭 asar 完整性校验：这样「快速模式」可以只替换 app.asar 而不必重打整个运行时
        disableAsarIntegrity  = $true
        directories           = [ordered]@{ output = '../../_build/gui-release'; buildResources = 'assets' }
        files                 = @('src/**/*', 'assets/icon.png', 'assets/icon.ico', 'package.json')
        win                   = [ordered]@{
            icon         = 'assets/icon.ico'
            target       = @(@{ target = 'dir'; arch = @('x64') })
            artifactName = 'CloudClientForge-${version}-${arch}.${ext}'
        }
    }
}
[System.IO.File]::WriteAllText((Join-Path $guiApp 'package.json'), ($pkg | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))

Step '3/5 构建界面'
$appExe = Join-Path $appDir 'CloudClientForge.exe'
$canFast = $Fast -and -not $Clean -and (Test-Path $appExe) -and (Test-Path (Join-Path $appDir 'resources\app.asar'))

if ($canFast) {
    # 快速模式：Electron 运行时（320MB）没变，只替换应用代码
    Write-Host '   快速模式：只重打 app.asar，跳过 Electron 复制'
    $tmpAsar = Join-Path $build 'app.asar'
    if (Test-Path $tmpAsar) { Remove-Item $tmpAsar -Force }
    & node $asarCli pack $guiApp $tmpAsar
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmpAsar)) { throw 'asar pack 失败' }
    Copy-Item $tmpAsar (Join-Path $appDir 'resources\app.asar') -Force
    Remove-Item $tmpAsar -Force
    Write-Host ("   app.asar 已更新（{0} KB）" -f [math]::Round((Get-Item (Join-Path $appDir 'resources\app.asar')).Length / 1KB, 1))
} else {
    Write-Host '   完整构建：electron-builder 打包（含运行环境，约 1~2 分钟）'
    if (Test-Path $release) { Remove-Item $release -Recurse -Force }
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    & $eb --win dir --projectDir $guiApp
    if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败（exit $LASTEXITCODE）" }
    if (-not (Test-Path $appExe)) { throw "没有生成 $appExe" }
}

Step '4/5 压缩运行环境并写指纹'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $payload) { Remove-Item $payload -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $appDir, $payload, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$id = (Get-FileHash $payload -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
Write-Host ("   payload.zip = {0} MB   id = {1}" -f [math]::Round((Get-Item $payload).Length / 1MB, 1), $id)

$infoContent = @"
// 由 tools\build-gui.ps1 自动生成，请勿手工修改
internal static class PayloadInfo
{
    public const string Id = "$id";
    public const string Version = "$asmVersion";
}
"@
[System.IO.File]::WriteAllText($infoCs, $infoContent, (New-Object System.Text.UTF8Encoding($true)))

Step '5/5 编译单文件'
if (Test-Path $out) { Remove-Item $out -Force }
& $csc /nologo /target:winexe /platform:x64 /optimize+ /utf8output /codepage:65001 `
    /out:"$out" `
    /win32icon:"$(Join-Path $guiApp 'assets\icon.ico')" `
    /resource:"$payload",payload.zip `
    /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "$build\launcher-gui.cs" "$infoCs"
if ($LASTEXITCODE -ne 0) { throw "csc 编译失败（exit $LASTEXITCODE）" }

if (-not $KeepRelease) {
    Remove-Item $release -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $payload -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "   已保留中间产物：$release"
}

$total.Stop()
Write-Host ''
Write-Host ("完成：{0}  ({1} MB，用时 {2:N1} 秒)" -f $out, [math]::Round((Get-Item $out).Length / 1MB, 1), $total.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host '      首次启动解包到 %LOCALAPPDATA%\CloudClientForgeDesktop\runtime，之后约 1 秒。'
