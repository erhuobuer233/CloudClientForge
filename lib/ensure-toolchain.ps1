# CloudClientForge —— 工具链自检 / 自动安装
#
# 背景（两个都踩过）：
#   1. electron 的**运行时二进制**（node_modules\electron\dist，约 100MB）不是随 npm 包一起下来的。
#      Electron 44 起甚至**没有 postinstall**，二进制是在首次 require('electron') 或执行
#      `node node_modules/electron/install.js`（bin: install-electron）时才下载。
#      所以只 `npm install` 会出现「包装好了、electronDist 不存在」的报错。
#   2. electron-builder 的 winCodeSign / nsis 等二进制也要联网，国内直连常失败，用镜像更稳。
#
# 用法：
#   . "$PSScriptRoot\lib\ensure-toolchain.ps1"          # 或 dot-source 绝对路径
#   $electronVersion = Ensure-Toolchain -Toolchain $toolchain [-NoInstall]
#
# 返回：electron 版本号（例如 "44.7.2"）。任何一步失败都会 throw。
function Ensure-Toolchain {
    param(
        [Parameter(Mandatory = $true)][string]$Toolchain,
        [switch]$NoInstall
    )

    $electronDir = Join-Path $Toolchain 'node_modules\electron'
    $electronPkg = Join-Path $electronDir 'package.json'
    $electronExe = Join-Path $electronDir 'dist\electron.exe'
    $eb = Join-Path $Toolchain 'node_modules\.bin\electron-builder.cmd'

    # 镜像：只在没设置时兜底（用户可自行覆盖）
    if (-not $env:ELECTRON_MIRROR) {
        $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    }
    if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
        $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
    }

    # ---- 1. 依赖包本体 ----
    if (-not (Test-Path $eb) -or -not (Test-Path $electronPkg)) {
        if ($NoInstall) {
            throw "工具链未安装：请先在 $Toolchain 执行 npm install（或去掉 -NoInstall 让脚本自动装）"
        }
        Write-Host "   安装工具链依赖（npm install，首次约 1~2 分钟；镜像 $env:ELECTRON_MIRROR）..."
        Push-Location $Toolchain
        try {
            Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
            & npm.cmd install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm install 失败（exit $LASTEXITCODE）" }
        } finally {
            Pop-Location
        }
    }

    if (-not (Test-Path $electronPkg)) {
        throw "工具链不完整：$electronPkg 不存在。请删除 $Toolchain\node_modules 后重试。"
    }

    # ---- 2. Electron 运行时二进制 ----
    if (-not (Test-Path $electronExe)) {
        if ($NoInstall) {
            throw "Electron 运行时缺失：$electronExe（去掉 -NoInstall 让脚本自动补，或手动 node install.js）"
        }
        Write-Host '   Electron 运行时缺失，正在补下载二进制（约 100MB）...'
        Push-Location $electronDir
        try {
            Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
            & node install.js
            if ($LASTEXITCODE -ne 0) { throw "Electron 运行时下载失败（exit $LASTEXITCODE）" }
        } finally {
            Pop-Location
        }
    }

    if (-not (Test-Path $electronExe)) {
        throw "Electron 运行时仍缺失：$electronExe`n请手动执行：cd `"$electronDir`"; node install.js（可先设 ELECTRON_MIRROR）"
    }
    if (-not (Test-Path $eb)) {
        throw "electron-builder 缺失：$eb`n请删除 $Toolchain\node_modules 后重新 npm install。"
    }

    return ([System.IO.File]::ReadAllText($electronPkg, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).version
}
