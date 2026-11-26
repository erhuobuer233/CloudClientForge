# 冒烟测试：只生成工程、不打包 exe，检查模板/替换/图标是否正常。
#
# 用法（在仓库根目录或任意位置都行）：
#   powershell -ExecutionPolicy Bypass -File tools\smoke-test.ps1
#   powershell -ExecutionPolicy Bypass -File tools\smoke-test.ps1 -Url "https://example.com/" -Keep
#
# 退出码 0 = 全部通过；1 = 有检查项失败。CI 里就是直接跑它。
param(
    [string]$Url = 'https://example.com/',
    [string]$OutDir,
    [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

if (-not $OutDir) {
    $OutDir = Join-Path $env:TEMP ('ccf-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }

$failed = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
    if ($ok) {
        Write-Host ("  [OK]   {0}" -f $name) -ForegroundColor Green
    } else {
        Write-Host ("  [FAIL] {0} {1}" -f $name, $detail) -ForegroundColor Red
        $script:failed += 1
    }
}

Write-Host ''
Write-Host '== 1/3 生成工程（forge.ps1 -SkipBuild）' -ForegroundColor Cyan
Write-Host "   url : $Url"
Write-Host "   out : $OutDir"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'forge.ps1') -Url $Url -Out $OutDir -SkipBuild -Force
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [FAIL] forge.ps1 退出码 $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '== 2/3 检查产物' -ForegroundColor Cyan
$expected = @(
    'app\src\main.js',
    'app\src\preload.js',
    'app\src\splash.html',
    'app\src\modal.html',
    'app\src\modal-preload.js',
    'app\package.json',
    'app\assets\icon.ico',
    'app\assets\icon.png',
    '_build\launcher.cs',
    'tools\build-client.ps1',
    'tools\create-shortcuts.ps1',
    'README.md',
    'CHANGELOG.md'
)
foreach ($rel in $expected) {
    Check "exists $rel" (Test-Path (Join-Path $OutDir $rel))
}

$mainJs = Join-Path $OutDir 'app\src\main.js'
$mainText = [System.IO.File]::ReadAllText($mainJs, [System.Text.Encoding]::UTF8)

# 占位符必须全部替换掉
$leftover = [regex]::Matches($mainText, '@@[A-Z_]+@@') | ForEach-Object { $_.Value } | Select-Object -Unique
Check '模板占位符已全部替换' ($leftover.Count -eq 0) ("残留: " + ($leftover -join ', '))

# 关键常量应写进 main.js
Check 'CLOUD_URL 已写入' ($mainText -match 'const CLOUD_URL = ''https?://')
Check 'IN_APP_PREFIXES 是数组' ($mainText -match 'const IN_APP_PREFIXES = \[.*\]')
Check 'GAME_ELEMENT_IDS 是数组' ($mainText -match 'const GAME_ELEMENT_IDS = \[.*\]')

# 图标必须是多分辨率 ico（>10KB 且以 00 00 01 00 开头）
$icoPath = Join-Path $OutDir 'app\assets\icon.ico'
if (Test-Path $icoPath) {
    $bytes = [System.IO.File]::ReadAllBytes($icoPath)
    Check 'icon.ico 尺寸正常' ($bytes.Length -gt 10000) ("实际 " + $bytes.Length + " 字节")
    Check 'icon.ico 是合法 ICO' ($bytes[0] -eq 0 -and $bytes[1] -eq 0 -and $bytes[2] -eq 1 -and $bytes[3] -eq 0)
}

Write-Host ''
Write-Host '== 3/3 语法检查（需要 node）' -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    foreach ($js in @('app\src\main.js', 'app\src\preload.js', 'app\src\modal-preload.js')) {
        $p = Join-Path $OutDir $js
        & node --check $p 2>&1 | Out-Null
        Check "node --check $js" ($LASTEXITCODE -eq 0)
    }
} else {
    Write-Host '   (跳过：没找到 node)' -ForegroundColor Yellow
}

if (-not $Keep) { Remove-Item $OutDir -Recurse -Force -ErrorAction SilentlyContinue }
else { Write-Host "   产物保留在: $OutDir" -ForegroundColor Yellow }

Write-Host ''
if ($failed -eq 0) {
    Write-Host '全部检查通过 ✅' -ForegroundColor Green
    exit 0
}
Write-Host ("有 {0} 项检查失败 ❌" -f $failed) -ForegroundColor Red
exit 1
