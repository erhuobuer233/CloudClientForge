# 打一个可发布的便携包（给 Release 用）
#
# 做的事：
#   1) 调 tools\build-gui.ps1 生成 CloudClientForge.exe（可 -SkipBuild 跳过）
#   2) 组装便携目录：exe + 脚本 + lib + tools + gui + launcher 源码 + toolchain 说明
#   3) 压成 CloudClientForge-v<ver>-win-x64.zip，算 SHA256
#   4) 用 docs\release-notes-template.md 渲染出 RELEASE_NOTES.md
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\make-release.ps1 -Version 1.0.1
#   powershell -ExecutionPolicy Bypass -File tools\make-release.ps1 -Version 1.0.1 -SkipBuild
#
# 输出（供 CI 读取）：
#   ZIP=<路径>
#   SHA256=<摘要>
#   NOTES=<路径>
#   VERSION=<版本>
param(
    [string]$Version,
    [string]$OutDir,
    [switch]$SkipBuild,
    [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# ---- 版本号：参数 > CI 的 tag > 1.0.0 ----
if (-not $Version) {
    $c = if ($env:GITHUB_REF_NAME) { $env:GITHUB_REF_NAME } else { '' }
    if ($c -match '^v?(\d+\.\d+\.\d+)$') { $Version = $Matches[1] }
}
if (-not $Version) { $Version = '1.0.0' }
$Version = $Version.TrimStart('v')

if (-not $OutDir) { $OutDir = Join-Path $root 'release-assets' }
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$zipName = "CloudClientForge-v$Version-win-x64.zip"
$zip = Join-Path $OutDir $zipName
$exe = Join-Path $root 'CloudClientForge.exe'

Write-Host ''
Write-Host "== CloudClientForge v$Version 打包发布资产" -ForegroundColor Cyan

# ---- 1. 构建 exe ----
if (-not $SkipBuild) {
    Write-Host '-- 构建 CloudClientForge.exe ...'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools\build-gui.ps1') -Version $Version
    if ($LASTEXITCODE -ne 0) { throw "build-gui.ps1 失败（exit $LASTEXITCODE）" }
}
if (-not (Test-Path $exe)) { throw "找不到 $exe（先构建，或去掉 -SkipBuild）" }
Write-Host ("   exe: {0} MB" -f [math]::Round((Get-Item $exe).Length / 1MB, 1))

# ---- 2. 组装便携目录 ----
Write-Host '-- 组装便携目录 ...'
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('ccf-release-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$inner = Join-Path $stage 'CloudClientForge'
New-Item -ItemType Directory -Force -Path $inner | Out-Null

$excludeDirs = @(
    (Join-Path $root 'toolchain\node_modules'),
    (Join-Path $root 'Cloudgame'),
    (Join-Path $root '_build\gui-release'),
    (Join-Path $root '.git'),
    (Join-Path $root '.github'),
    (Join-Path $root 'release-assets')
)
$excludeFiles = @('*.zip', 'package-lock.json', 'PayloadInfo.cs', 'favicon-download.bin', '.gitignore', '.gitattributes')
robocopy $root $inner /E /XD @excludeDirs /XF @excludeFiles /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 失败（exit $LASTEXITCODE）" }

# 便携包不需要 docs（讲原理用的）、也不需要 GUI 的构建中间产物
Remove-Item (Join-Path $inner 'docs') -Recurse -Force -ErrorAction SilentlyContinue

# ---- 3. 压缩 ----
Write-Host '-- 压缩 ...'
Add-Type -AssemblyName System.IO.Compression
$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$arch = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$count = 0
foreach ($f in Get-ChildItem $stage -Recurse -File -Force) {
    $rel = $f.FullName.Substring($stage.Length + 1).Replace('\', '/')
    $entry = $arch.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::NoCompression)
    $es = $entry.Open()
    $src = [System.IO.File]::OpenRead($f.FullName)
    $src.CopyTo($es)
    $src.Dispose(); $es.Dispose()
    $count++
}
$arch.Dispose(); $fs.Dispose()
if (-not $KeepTemp) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }

$zipItem = Get-Item $zip
$sha = (Get-FileHash $zip -Algorithm SHA256).Hash
Write-Host ("   {0}  ({1} MB, {2} files)" -f $zipName, [math]::Round($zipItem.Length / 1MB, 1), $count)

# ---- 4. 渲染 release notes ----
Write-Host '-- 生成 Release 说明 ...'
$tplPath = Join-Path $root 'docs\release-notes-template.md'
$notesPath = Join-Path $OutDir 'RELEASE_NOTES.md'
if (Test-Path $tplPath) {
    $commit = ''
    try { $commit = (& git -C $root rev-parse --short HEAD 2>$null) } catch { }
    $text = [System.IO.File]::ReadAllText($tplPath, [System.Text.Encoding]::UTF8)
    $text = $text.Replace('{{VERSION}}', $Version).
        Replace('{{SHA256}}', $sha).
        Replace('{{DATE}}', (Get-Date).ToString('yyyy-MM-dd')).
        Replace('{{COMMIT}}', $commit)
    # 去掉模板顶部的说明段（到第一个 --- 之后）
    $idx = $text.IndexOf("---`n")
    if ($idx -ge 0) { $text = $text.Substring($idx + 4).TrimStart() }
    [System.IO.File]::WriteAllText($notesPath, $text, (New-Object System.Text.UTF8Encoding($false)))
} else {
    [System.IO.File]::WriteAllText($notesPath, "CloudClientForge v$Version`n`nSHA256: $sha`n", (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ''
Write-Host '== 完成' -ForegroundColor Green
Write-Host "   VERSION=$Version"
Write-Host "   ZIP=$zip"
Write-Host "   SHA256=$sha"
Write-Host "   NOTES=$notesPath"

# 给 CI 用的机器可读输出
Write-Output "VERSION=$Version"
Write-Output "ZIP=$zip"
Write-Output "SHA256=$sha"
Write-Output "NOTES=$notesPath"
