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
            # 两个坑：
            #   1) 直接 & npm.cmd ...：它的 stdout 会成为函数返回值，污染 $electronVersion
            #      （曾导致生成的 package.json 里 electronVersion 变成数组，electron-builder 报错）
            #   2) `2>&1 | ...`：npm 的 deprecation 警告走 stderr，被当成 ErrorRecord，
            #      在 $ErrorActionPreference='Stop' 下会直接中断脚本
            # 所以统一重定向到临时文件，再回显尾部几行。
            $npmLog = Join-Path ([System.IO.Path]::GetTempPath()) ("ccf-npm-" + [guid]::NewGuid().ToString('N').Substring(0, 6) + ".log")
            # 3) 原生命令的 stderr 在 $ErrorActionPreference='Stop' 下会被当成终止性错误
            #    （npm 的 deprecation 警告就足以中断脚本），所以这里临时降级 EAP。
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                & npm.cmd install --no-audit --no-fund *> $npmLog
                $npmCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $prevEap
            }
            if (Test-Path $npmLog) {
                Get-Content $npmLog -Tail 8 | ForEach-Object { Write-Host "   $_" }
                Remove-Item $npmLog -Force -ErrorAction SilentlyContinue
            }
            if ($npmCode -ne 0) { throw "npm install 失败（exit $npmCode）" }
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
            $insLog = Join-Path ([System.IO.Path]::GetTempPath()) ("ccf-install-" + [guid]::NewGuid().ToString('N').Substring(0, 6) + ".log")
            $prevEap2 = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                & node install.js *> $insLog
                $insCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $prevEap2
            }
            if (Test-Path $insLog) {
                Get-Content $insLog -Tail 6 | ForEach-Object { Write-Host "   $_" }
                Remove-Item $insLog -Force -ErrorAction SilentlyContinue
            }
            if ($insCode -ne 0) { throw "Electron 运行时下载失败（exit $insCode）" }
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

    $ver = ([System.IO.File]::ReadAllText($electronPkg, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).version
    if ($ver -notmatch '^\d+\.\d+\.\d+') {
        throw "读到的 Electron 版本不合法：'$ver'（$electronPkg）"
    }
    return $ver
}
