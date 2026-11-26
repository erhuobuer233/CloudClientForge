# 创建 @@PRODUCT@@ 在桌面与开始菜单的快捷方式（含图标）
$ErrorActionPreference = 'Stop'

$root = '@@ROOT@@'
$name = '@@PRODUCT@@'
$single = Join-Path $root "$name.exe"

if (Test-Path -LiteralPath $single) {
    $target = $single
} else {
    $exe = Get-ChildItem -Path (Join-Path $root 'release') -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue |
           Where-Object { $_.DirectoryName -like '*win-unpacked*' } |
           Select-Object -First 1
    if (-not $exe) {
        Write-Host '[x] 找不到客户端，请先运行 tools\build-client.ps1' -ForegroundColor Red
        exit 1
    }
    $target = $exe.FullName
}

$work = Split-Path $target -Parent
Write-Host "[i] 目标: $target"

$shell = New-Object -ComObject WScript.Shell
$created = @()

function New-Shortcut([string]$linkPath) {
    $dir = Split-Path $linkPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $sc = $shell.CreateShortcut($linkPath)
    $sc.TargetPath       = $target
    $sc.WorkingDirectory = $work
    $sc.IconLocation     = "$target,0"
    $sc.Description      = "$name Desktop"
    $sc.Save()
    $script:created += $linkPath
}

$desktop = [Environment]::GetFolderPath('Desktop')
New-Shortcut (Join-Path $desktop "$name.lnk")

$startMenu = [Environment]::GetFolderPath('StartMenu')
$programs  = Join-Path $startMenu 'Programs'
if (-not (Test-Path $programs)) { $programs = $startMenu }
New-Shortcut (Join-Path $programs "$name.lnk")

$created | ForEach-Object { Write-Host "[v] 已创建: $_" -ForegroundColor Green }
