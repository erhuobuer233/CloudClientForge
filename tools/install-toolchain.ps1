# 安装 / 修复工具链（GUI 的「现在安装」按钮调用它；CLI 也可以直接用）
#
# 做的事就是 lib\ensure-toolchain.ps1 那套：
#   1) 缺依赖 → npm install（约 1~2 分钟，需联网）
#   2) 缺 Electron 运行时二进制 → node install.js（约 100MB）
#   3) 校验版本号
param(
    [switch]$NoInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$toolchain = Join-Path $root 'toolchain'

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

. (Join-Path $root 'lib\ensure-toolchain.ps1')

Write-Host "工具链目录：$toolchain"

try {
    $ver = Ensure-Toolchain -Toolchain $toolchain -NoInstall:$NoInstall
} catch {
    Write-Host ''
    Write-Host "[x] 工具链安装失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host '    常见原因：没联网 / 代理不通 / 磁盘空间不足。可以设了镜像后重试：'
    Write-Host '      $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"'
    exit 1
}

Write-Host ''
Write-Host "[OK] 工具链就绪：electron $ver" -ForegroundColor Green
exit 0
