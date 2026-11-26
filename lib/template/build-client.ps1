# 把文件夹版打包成「带缓存的单文件启动器」，输出到根目录 @@PRODUCT@@.exe
#
# 由 CloudClientForge 生成。用法（一条命令，缺文件夹版会自动生成）：
#   powershell -ExecutionPolicy Bypass -File tools\build-client.ps1
#
# 说明：运行环境（electron / electron-builder）来自生成器的 toolchain：
#   @@TOOLCHAIN@@\node_modules
# 如果那个目录被删掉了，可以在 app\ 里自己 `npm install`，然后把下面的
# $eb 换成 app\node_modules\.bin\electron-builder.cmd。

$ErrorActionPreference = 'Stop'

$root      = '@@ROOT@@'
$appDir    = Join-Path $root 'release\win-unpacked'
$app       = Join-Path $root 'app'
$build     = Join-Path $root '_build'
$payload   = Join-Path $build 'payload.zip'
$infoCs    = Join-Path $build 'PayloadInfo.cs'
$out       = Join-Path $root '@@PRODUCT@@.exe'
$csc       = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$toolchain = '@@TOOLCHAIN@@'
$eb        = Join-Path $toolchain 'node_modules\.bin\electron-builder.cmd'

if (-not (Test-Path $csc)) { throw "找不到 csc.exe：$csc" }

# Electron 44 起没有 postinstall：npm install 不会下载运行时二进制，这里先确认一次
$tcElectron = Join-Path $toolchain 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $tcElectron)) {
    throw "Electron 运行时缺失：$tcElectron`n请在 `"$toolchain`" 目录执行：npm install 之后 node node_modules\electron\install.js"
}
if (-not (Test-Path (Join-Path $build 'launcher.cs'))) { throw "找不到 $build\launcher.cs" }
New-Item -ItemType Directory -Force -Path $build | Out-Null

$appExe = Join-Path $appDir '@@PRODUCT@@.exe'
$needBuild = -not (Test-Path $appDir) -or -not (Test-Path $appExe)
if (-not $needBuild) {
    # 源码比构建产物新时自动重新构建，避免打包出旧代码
    $inputs = @()
    $inputs += Get-ChildItem (Join-Path $app 'src') -Recurse -File -ErrorAction SilentlyContinue
    $inputs += Get-ChildItem (Join-Path $app 'assets') -Recurse -File -ErrorAction SilentlyContinue
    $inputs += Get-Item (Join-Path $app 'package.json')
    $builtAt = (Get-Item $appExe).LastWriteTimeUtc
    $newer = $inputs | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1
    if ($newer) {
        Write-Host "      [i] 源码比 release\win-unpacked 新（$($newer.Name)），需要重新构建"
        $needBuild = $true
    }
}

if ($needBuild) {
    if (-not (Test-Path $eb)) { throw "找不到 electron-builder：$eb`n请确认生成器的 toolchain 目录还在，或在 app\ 里自行 npm install。" }
    Write-Host '[0/4] 构建文件夹版（electron-builder）...'
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    & $eb --win dir --projectDir $app
    if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败（exit $LASTEXITCODE）" }
}

Write-Host '[1/4] 压缩运行环境 ...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $payload) { Remove-Item $payload -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $appDir, $payload, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Write-Host ("      payload.zip = {0} MB" -f [math]::Round((Get-Item $payload).Length / 1MB, 1))

Write-Host '[2/4] 计算 payload 指纹并同步版本号 ...'
$id = (Get-FileHash $payload -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
Write-Host "      payload id = $id"

$appVersion = ([System.IO.File]::ReadAllText((Join-Path $app 'package.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($appVersion)) { $appVersion = '0.0.0' }
$asmVersion = if ($appVersion -match '^\d+\.\d+\.\d+') { ($appVersion -replace '[^0-9.].*$', '') + '.0' } else { '1.0.0.0' }

$infoContent = @"
// 由 tools\build-client.ps1 自动生成，请勿手工修改
internal static class PayloadInfo
{
    public const string Id = "$id";
    public const string Version = "$asmVersion";
}
"@
[System.IO.File]::WriteAllText($infoCs, $infoContent, (New-Object System.Text.UTF8Encoding($true)))

Write-Host '[3/4] 编译启动器 ...'
if (Test-Path $out) { Remove-Item $out -Force }
& $csc /nologo /target:winexe /platform:x64 /optimize+ /utf8output /codepage:65001 `
    /out:"$out" `
    /win32icon:"$(Join-Path $root 'app\assets\icon.ico')" `
    /resource:"$payload",payload.zip `
    /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "$build\launcher.cs" "$infoCs"
if ($LASTEXITCODE -ne 0) { throw "csc 编译失败（exit $LASTEXITCODE）" }

Write-Host '[4/4] 完成'
$f = Get-Item $out
Write-Host ("      {0}  ({1} MB)" -f $f.FullName, [math]::Round($f.Length / 1MB, 1))
Write-Host '      首次启动解包到 %LOCALAPPDATA%\@@CACHE_ROOT@@\runtime（约 4 秒），之后约 1 秒。'
