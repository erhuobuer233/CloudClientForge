# CloudClientForge —— 一键把「云游戏网页」变成 Windows 桌面客户端
#
# 用法（一条命令）：
#   powershell -ExecutionPolicy Bypass -File forge.ps1 -Url "https://xxx.yyy.com/cloudgame"
#
# 它会：
#   1. 打开网址，读页面标题 / favicon，自动推导产品名与图标
#   2. 生成一个完整的 Electron 客户端工程（窗口化启动、开始游戏自动全屏、外链交给浏览器、
#      退出确认、防息屏、托盘、单文件缓存启动器 …… 都是现成的）
#   3. 直接打包成单文件 exe，并额外打一个 zip 分发包
#
# 常用参数：
#   -Name "Azur Promilia Cloud"   自定义英文产品名（exe / 目录名都用它）
#   -DisplayName "示例云游戏"     窗口标题 / 界面里显示的名字（默认取页面标题）
#   -Out  D:\Tools\MyClient      输出目录（默认 <本目录>\Cloudgame\<网址域名>）
#   -ProbeSelectors "#WelinkGameVideo,#gamePlayLayer"  指定「进游戏」的画面元素 id
#   -AllowUrls "https://passport.example.com/"        额外允许留在客户端内的地址
#   -IconUrl "https://.../favicon.png"                指定图标
#   -SkipBuild                    只生成工程，不打包 exe
#   -Shortcuts                    同时创建桌面 / 开始菜单快捷方式
#   -Force                        目标目录已存在时覆盖
param(
    [Parameter(Position = 0)][string]$Url,
    [string]$Name,
    [string]$DisplayName,
    [string]$Out,
    [string]$ProbeSelectors,
    [string[]]$AllowUrls,
    [string]$IconUrl,
    [switch]$Force,
    [switch]$SkipBuild,
    [switch]$SkipZip,
    [switch]$Shortcuts,
    [switch]$OpenFolder,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$forgeRoot = $PSScriptRoot
# 版本号：优先读同目录的 VERSION 文件（发版时只改这一处），否则用兜底值
$FORGE_VERSION = '1.2.1'
$versionFile = Join-Path $forgeRoot 'VERSION'
if (Test-Path $versionFile) {
    $v = (Get-Content $versionFile -First 1 -ErrorAction SilentlyContinue)
    if ($v -and $v.Trim() -match '^\d+\.\d+\.\d+$') { $FORGE_VERSION = $v.Trim() }
}
$tpl = Join-Path $forgeRoot 'lib\template'
$toolchain = Join-Path $forgeRoot 'toolchain'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
if ($Help -or -not $Url) {
    Write-Host ''
    Write-Host "CloudClientForge v$FORGE_VERSION —— 一键把云游戏网页变成 Windows 桌面客户端" -ForegroundColor Magenta
    Write-Host ''
    Write-Host '用法：'
    Write-Host '  powershell -ExecutionPolicy Bypass -File forge.ps1 -Url "<云游戏网页地址>" [选项]'
    Write-Host ''
    Write-Host '示例：'
    Write-Host '  forge.ps1 -Url "https://example.com/cloudgame"'
    Write-Host '  forge.ps1 -Url "https://xxx.com/cloudgame" -Name "My Game Cloud" -DisplayName "我的云游戏" -Shortcuts'
    Write-Host ''
    Write-Host '选项：'
    Write-Host '  -Name           英文产品名（exe/目录名），默认由域名推导'
    Write-Host '  -DisplayName    窗口标题，默认取网页标题'
    Write-Host '  -Out            输出目录，默认 <本目录>\Cloudgame\<网址域名>'
    Write-Host '  -ProbeSelectors 「进入游戏」判据的画面元素 id，逗号分隔，如 "#gameVideo,#player"'
    Write-Host '  -AllowUrls      额外允许留在客户端内的地址（登录/支付域名等，可多个）'
    Write-Host '  -IconUrl        指定图标地址'
    Write-Host '  -SkipBuild      只生成工程，不打包 exe'
    Write-Host '  -SkipZip        不生成 zip 分发包'
    Write-Host '  -Shortcuts      创建桌面 / 开始菜单快捷方式'
    Write-Host '  -Force          输出目录已存在时覆盖'
    Write-Host '  -OpenFolder     完成后打开输出目录'
    Write-Host '  -Help           显示本帮助'
    Write-Host ''
    exit 0
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# 让重定向到管道/文件的中文输出用 UTF-8（GUI 前端会按 UTF-8 解码）
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ------------------------------------------------------------------ 小工具

function Step([string]$text) {
    Write-Host ''
    Write-Host "== $text" -ForegroundColor Cyan
}

function Info([string]$text) {
    Write-Host "   $text"
}

function Warn([string]$text) {
    Write-Host "   [!] $text" -ForegroundColor Yellow
}

function Fail([string]$text) {
    Write-Host ''
    Write-Host "[x] $text" -ForegroundColor Red
    exit 1
}

function ConvertTo-Camel([string]$s) {
    $parts = ($s -replace '[^A-Za-z0-9]+', ' ').Trim() -split '\s+'
    $out = ''
    foreach ($p in $parts) {
        if ($p.Length -gt 0) { $out += $p.Substring(0, 1).ToUpper() + $p.Substring(1) }
    }
    if (-not $out) { $out = 'CloudGame' }
    return $out
}

function Esc-Js([string]$s) {
    return $s.Replace('\', '\\').Replace("'", "\'").Replace("`r", '').Replace("`n", ' ')
}

function Esc-Cs([string]$s) {
    return $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", ' ')
}

function Expand-Template([string]$path, [hashtable]$map) {
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    foreach ($k in $map.Keys) { $text = $text.Replace($k, [string]$map[$k]) }
    return $text
}

function Write-Text([string]$path, [string]$text, [bool]$bom) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($bom)))
}



# 抓网页并「按页面自己的 charset 解码」，同时拿到 HTTP 状态码。
# 为什么不直接用 Invoke-WebRequest：
#   · -UseBasicParsing 的 .Content 在服务端没给 charset 时按 Latin-1 解，中文标题变乱码；
#   · -OutFile 又拿不到状态码。
# 所以这里用 .NET 自带 WebRequest，一次请求拿到状态码 + 原始字节，再自己解码：
#   先尝试「严格 UTF-8」（绝大多数中文站点），不合法再退回响应头 / meta 里的 charset。
function Fetch-Html([string]$u) {
    $bytes = $null
    $status = 0
    $headerCharset = ''
    try {
        $req = [System.Net.WebRequest]::Create($u)
        $req.UserAgent = $ua
        $req.Timeout = 30000
        $req.ReadWriteTimeout = 30000
        $req.AllowAutoRedirect = $true
        $resp = $req.GetResponse()
        $status = [int]$resp.StatusCode
        $headerCharset = [string]$resp.CharacterSet
        $stream = $resp.GetResponseStream()
        $ms = New-Object System.IO.MemoryStream
        $stream.CopyTo($ms)
        $bytes = $ms.ToArray()
        $ms.Dispose(); $stream.Dispose(); $resp.Close()
    } catch {
        return $null
    }
    if (-not $bytes -or $bytes.Length -eq 0) { return $null }

    # 候选 charset：响应头 → meta → utf-8
    $charsets = @()
    if ($headerCharset) { $charsets += $headerCharset }
    $head = [System.Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min(4096, $bytes.Length))
    $mm = [regex]::Match($head, '(?i)charset\s*=\s*["'']?([a-z0-9_\-]+)')
    if ($mm.Success) { $charsets += $mm.Groups[1].Value }
    $charsets += 'utf-8'

    $text = $null
    # 1) 严格 UTF-8（能成功解码就认为页面是 UTF-8，忽略服务端错误的 latin1 声明）
    try {
        $strict = New-Object System.Text.UTF8Encoding($false, $true)
        $text = $strict.GetString($bytes)
    } catch {
        $text = $null
    }
    # 2) 退回按声明解码
    if ($null -eq $text) {
        $charsets = @($charsets | Select-Object -Unique)
        foreach ($cs in $charsets) {
            try {
                $enc = [System.Text.Encoding]::GetEncoding($cs)
                $text = $enc.GetString($bytes)
                break
            } catch { }
        }
    }
    if ($null -eq $text) { $text = [System.Text.Encoding]::UTF8.GetString($bytes) }

    return @{ Html = $text; Bytes = $bytes.Length; Status = $status; Charset = ($charsets -join ',') }
}

function Download([string]$u, [string]$path) {
    try {
        $req = [System.Net.WebRequest]::Create($u)
        $req.UserAgent = $ua
        $req.Timeout = 60000
        $resp = $req.GetResponse()
        $stream = $resp.GetResponseStream()
        $fs = [System.IO.File]::Create($path)
        $stream.CopyTo($fs)
        $fs.Dispose(); $stream.Dispose(); $resp.Close()
        return $true
    } catch {
        return $false
    }
}
# ------------------------------------------------------------------ 0. 检查环境

Write-Host ''
Write-Host "CloudClientForge v$FORGE_VERSION" -ForegroundColor Magenta
Write-Host "  把云游戏网页一键封装成 Windows 桌面客户端"

Step '0/6 检查环境'

# 平台检查：本项目依赖 Windows 自带的 .NET Framework 编译器与 Win32 路径
if ($env:OS -ne 'Windows_NT') {
    Fail 'CloudClientForge 只能在 Windows 10/11 上运行（依赖 .NET Framework 的 csc.exe 和 Windows 路径）。'
}
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Fail ('需要 PowerShell 5.1 或更高（当前 {0}）。' -f $PSVersionTable.PSVersion)
}

if (-not (Test-Path $csc)) { Fail "找不到 .NET 编译器：$csc" }
# 工具链自检（缺依赖自动 npm install；缺 Electron 运行时二进制自动补下载）
. (Join-Path $forgeRoot 'lib\ensure-toolchain.ps1')
try {
    $electronVersion = Ensure-Toolchain -Toolchain $toolchain
} catch {
    Fail $_.Exception.Message
}
if ("$electronVersion" -notmatch '^\d+\.\d+\.\d+') {
    Fail "Electron 版本异常：'$electronVersion'（应形如 44.7.2）"
}
Info "toolchain: electron $electronVersion / electron-builder OK"

# ------------------------------------------------------------------ 1. 读取网址

Step '1/6 读取目标网址'

if ($Url -notmatch '^https?://') { $Url = 'https://' + $Url }
$uri = $null
try { $uri = [Uri]$Url } catch { Fail "网址格式不对：$Url" }

$page = Fetch-Html $Url
if (-not $page) { Fail "打不开这个网址：$Url`n（检查网址是否正确、是否需要梯子/登录）" }
$html = [string]$page.Html
Info "HTTP $($page.Status)  $($uri.AbsoluteUri)"

# 标题（可能带 HTML 实体）
$title = ''
$m = [regex]::Match($html, '(?is)<title[^>]*>(.*?)</title>')
if ($m.Success) { $title = $m.Groups[1].Value }
Add-Type -AssemblyName System.Web
$title = [System.Web.HttpUtility]::HtmlDecode($title).Trim()
if ($title) {
    # 常见尾巴去掉，窗口标题更干净（例如「《某游戏》官方网站」→「《某游戏》」）
    $title = $title -replace '(?i)\s*[-|—–_]\s*(官方网站|官网|官网首页|首页)\s*$', ''
    $title = $title -replace '(官方网站|官网首页|官网)$', ''
    $title = $title.Trim()
    Info "页面标题: $title"
} else {
    Warn '页面里没读到 <title>，显示名将用产品名'
}

# favicon 候选：<link rel=...icon...> 优先，其次 /favicon.ico
$iconCandidates = @()
foreach ($lm in [regex]::Matches($html, '(?is)<link[^>]+rel=["'']?[^>]*icon[^>]*>')) {
    $tag = $lm.Value
    $hm = [regex]::Match($tag, '(?is)href=["'']([^"'']+)["'']')
    if ($hm.Success) {
        try { $iconCandidates += ([Uri]::new($uri, $hm.Groups[1].Value)).AbsoluteUri } catch { }
    }
}
$iconCandidates += ([Uri]::new($uri, '/favicon.ico')).AbsoluteUri
if ($IconUrl) { $iconCandidates = @($IconUrl) + $iconCandidates }
$iconCandidates = $iconCandidates | Select-Object -Unique

# ------------------------------------------------------------------ 2. 推导命名

Step '2/6 推导命名'

$hostParts = @($uri.Host -split '\.' | Where-Object { $_ })
# 取「最有辨识度」的那一段：优先最左边（game.example.com → game，
# www.example.com → example），www 之类的跳过；只有两段时用主域名。
$skip = @('www', 'm', 'web', 'new')
$label = ''
if ($hostParts.Count -ge 3) {
    $label = $hostParts[0]
    if ($skip -contains $label.ToLower()) { $label = $hostParts[1] }
} elseif ($hostParts.Count -eq 2) {
    $label = $hostParts[0]
} else {
    $label = $hostParts[0]
}
if (-not $label) { $label = 'cloudgame' }
$base = ConvertTo-Camel $label
if (-not $Name) { $Name = "$base Cloud" }
$product = $Name.Trim()

if ($product -notmatch '^[A-Za-z0-9 ._\-]+$') {
    Fail "产品名只能用英文字母/数字/空格/._-（当前：$product）`n中文只用于显示名，请另外用 -DisplayName 指定。"
}
$product = ($product -replace '\s+', ' ').Trim()

$display = if ($DisplayName) { $DisplayName.Trim() } elseif ($title) { $title } else { $product }
$folderName = $product -replace '[^A-Za-z0-9]', ''
if (-not $folderName) { Fail '无法从产品名推导目录名，请用 -Name 指定一个英文名。' }
$slug = ($label -replace '[^A-Za-z0-9]', '').ToLower()
if (-not $slug) { $slug = 'cloudgame' }
$cacheRoot = $folderName + 'Desktop'
$mutex = $folderName + 'Launcher'
$officialSite = $uri.GetLeftPart([UriPartial]::Authority) + '/'

if ($Out) { $target = $Out } else { $target = Join-Path $forgeRoot (Join-Path 'Cloudgame' $uri.Host) }
$target = [System.IO.Path]::GetFullPath($target)

Info "产品名 (exe/目录): $product"
Info "显示名 (窗口标题): $display"
Info "输出目录: $target"

# 留在客户端内的地址：入口自己（同源 + 同一级路径），其它交给浏览器
$origin = $uri.GetLeftPart([UriPartial]::Authority)
$segments = @($uri.AbsolutePath.Trim('/') -split '/' | Where-Object { $_ })
if ($segments.Count -gt 0) { $inApp = @("$origin/$($segments[0])") } else { $inApp = @("$origin/") }
if ($AllowUrls) { $inApp = @($inApp) + $AllowUrls }
$inApp = @($inApp | Where-Object { $_ } | Select-Object -Unique)
$inAppJson = '[' + (($inApp | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ', ') + ']'
Info ("客户端内允许的地址: " + ($inApp -join ' , '))

# 「进入游戏」判据要看的元素 id
$ids = @('WelinkGameVideo', 'gamePlayLayer', 'gameVideo', 'game-player', 'gameCanvas')
if ($ProbeSelectors) {
    $ids = @($ProbeSelectors -split ',' | ForEach-Object { $_.Trim().TrimStart('#', '.') } | Where-Object { $_ })
}
$idsJson = '[' + (($ids | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ', ') + ']'
Info ('画面元素 id: ' + ($ids -join ', '))

# 防护：不要把客户端直接生成到「生成器自己的目录」或它的上级（会把工具目录搞乱）
$forgeNorm = [System.IO.Path]::GetFullPath($forgeRoot).TrimEnd('\')
$targetNorm = [System.IO.Path]::GetFullPath($target).TrimEnd('\')
$cloudgameRoot = Join-Path $forgeNorm 'Cloudgame'
if ($targetNorm -eq $forgeNorm) {
    Fail "输出目录不能是生成器自己的目录：$target`n（默认是 <本目录>\Cloudgame\<网址域名>；不传 -Out 就用默认值）"
}
if ($forgeNorm.StartsWith($targetNorm + '\')) {
    Fail "输出目录不能是生成器的上级目录：$target`n（默认是 <本目录>\Cloudgame\<网址域名>；不传 -Out 就用默认值）"
}
if ($targetNorm.StartsWith($forgeNorm + '\') -and -not ($targetNorm -eq $cloudgameRoot -or $targetNorm.StartsWith($cloudgameRoot + '\'))) {
    Warn "输出目录在生成器目录里面（不在 Cloudgame\ 下）：$target"
}

if ((Test-Path $target) -and (@(Get-ChildItem $target -Force).Count -gt 0)) {
    if (-not $Force) { Fail "输出目录已存在且不为空：$target`n换个 -Out，或加 -Force 覆盖。" }
    Write-Host "   [!] 覆盖已有目录：$target" -ForegroundColor Yellow
    Remove-Item $target -Recurse -Force
}

# ------------------------------------------------------------------ 3. 生成工程

Step '3/6 生成客户端工程'

$appDir = Join-Path $target 'app'
$srcDir = Join-Path $appDir 'src'
$assetsDir = Join-Path $appDir 'assets'
$buildDir = Join-Path $target '_build'
$toolsDir = Join-Path $target 'tools'
foreach ($d in @($srcDir, $assetsDir, $buildDir, $toolsDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

$builtAt = (Get-Date).ToString('yyyy-MM-dd HH:mm')

# main.js / preload.js
$map = @{
    '@@CLOUD_URL@@'       = (Esc-Js $uri.AbsoluteUri)
    '@@PRODUCT@@'         = (Esc-Js $product)
    '@@DISPLAY_NAME@@'    = (Esc-Js $display)
    '@@OFFICIAL_SITE@@'   = (Esc-Js $officialSite)
    '@@SLUG@@'            = $slug
    '@@IN_APP_PREFIXES@@' = $inAppJson
    '@@GAME_ELEMENT_IDS@@' = $idsJson
    '@@GAME_IDS_JSON@@'   = $idsJson
    '@@BUILT_AT@@'        = $builtAt
    '@@FORGE_VERSION@@'   = $FORGE_VERSION
}
Write-Text (Join-Path $srcDir 'main.js') (Expand-Template (Join-Path $tpl 'main.js') $map) $false
Write-Text (Join-Path $srcDir 'preload.js') (Expand-Template (Join-Path $tpl 'preload.js') $map) $false
Info 'app\src\main.js + preload.js'

# package.json
$pkg = [ordered]@{
    name            = "$slug-cloud-desktop"
    productName     = $product
    version         = '1.0.0'
    description     = "$display 网页端的桌面封装客户端（Electron，由 CloudClientForge 生成）"
    author          = '本地封装'
    license         = 'MIT'
    private         = $true
    main            = 'src/main.js'
    scripts         = [ordered]@{ start = 'electron .'; dist = 'electron-builder --win dir' }
    # 注意：这里故意不写 devDependencies。
    #   electron/electron-builder 由生成器的 toolchain 提供（electronVersion + electronDist 已指向它），
    #   一旦声明了 devDependencies，electron-builder 会顺手在 app\ 里跑一次 npm install
    #   （几百 MB、还要联网），完全没必要。
    build           = [ordered]@{
        appId             = "com.$slug.cloud.desktop"
        productName       = $product
        electronVersion   = $electronVersion
        electronDist      = "$toolchain\node_modules\electron\dist"
        electronLanguages = @('zh-CN', 'en-US')
        directories       = [ordered]@{ output = '../release'; buildResources = 'assets' }
        files             = @('src/**/*', 'assets/icon.png', 'assets/icon.ico', 'package.json')
        win               = [ordered]@{
            icon         = 'assets/icon.ico'
            target       = @(@{ target = 'dir'; arch = @('x64') })
            artifactName = $product + '-${version}-${arch}.${ext}'
        }
    }
}
Write-Text (Join-Path $appDir 'package.json') ($pkg | ConvertTo-Json -Depth 10) $false
Info 'app\package.json'

# 启动器 / 脚本
$csMap = @{
    '@@PRODUCT@@'    = (Esc-Cs $product)
    '@@APP_EXE@@'    = (Esc-Cs "$product.exe")
    '@@CACHE_ROOT@@' = (Esc-Cs $cacheRoot)
    '@@MUTEX@@'      = (Esc-Cs $mutex)
    '@@SPLASH_FOOT@@' = (Esc-Cs $display)
}
Write-Text (Join-Path $buildDir 'launcher.cs') (Expand-Template (Join-Path $tpl 'launcher.cs') $csMap) $false
Info '_build\launcher.cs'

$psMap = @{
    '@@ROOT@@'         = $target
    '@@PRODUCT@@'      = $product
    '@@TOOLCHAIN@@'    = $toolchain
    '@@CACHE_ROOT@@'   = $cacheRoot
}
Write-Text (Join-Path $toolsDir 'build-client.ps1') (Expand-Template (Join-Path $tpl 'build-client.ps1') $psMap) $true
Write-Text (Join-Path $toolsDir 'create-shortcuts.ps1') (Expand-Template (Join-Path $tpl 'create-shortcuts.ps1') $psMap) $true
Info 'tools\build-client.ps1 + create-shortcuts.ps1'

$cmdMap = @{
    '@@PRODUCT@@'   = $product
    '@@TOOLCHAIN@@' = $toolchain
}
Write-Text (Join-Path $target "Start $product.cmd") (Expand-Template (Join-Path $tpl 'start.cmd') $cmdMap) $false
Info "Start $product.cmd"

# 说明文档
$docMap = @{
    '@@PRODUCT@@'      = $product
    '@@DISPLAY_NAME@@' = $display
    '@@CLOUD_URL@@'    = $uri.AbsoluteUri
    '@@CACHE_ROOT@@'   = $cacheRoot
    '@@BUILT_AT@@'     = $builtAt
    '@@TOOLCHAIN@@'    = $toolchain
    '@@GENERATED_BY@@' = "$forgeRoot\forge.ps1 (v$FORGE_VERSION)"
}
# 启动画面 / 自绘确认框（圆角风格），图标和名字用同一套 token
Write-Text (Join-Path $srcDir 'splash.html') (Expand-Template (Join-Path $tpl 'splash.html') $map) $false
Write-Text (Join-Path $srcDir 'modal.html') (Expand-Template (Join-Path $tpl 'modal.html') $map) $false
Write-Text (Join-Path $srcDir 'modal-preload.js') (Expand-Template (Join-Path $tpl 'modal-preload.js') $map) $false
Info 'app\src\splash.html + modal.html（圆角界面）'
Write-Text (Join-Path $target 'README.md') (Expand-Template (Join-Path $tpl 'README.md') $docMap) $false
$changelog = @"
# 更新日志

## 1.0.0 — $builtAt

首个版本，由 CloudClientForge v$FORGE_VERSION 生成。

- 封装官方网页端 <$($uri.AbsoluteUri)>
- 默认窗口化（1280×800 居中），检测到进入游戏后自动全屏、退出游戏恢复窗口
- 登录状态持久化、全屏防息屏、后台不降频
- 网页类入口一律交给系统浏览器，客户端始终停在游戏页面
- 关窗 / Alt+F4 确认后强制结束进程，不留后台残留
- 托盘菜单：全屏、自动全屏开关、防息屏、退出前询问、重新加载、开发者工具
- 单文件客户端（带缓存启动器）：首次解包约 4 秒，之后约 1 秒
"@
Write-Text (Join-Path $target 'CHANGELOG.md') $changelog $false
Info 'README.md + CHANGELOG.md'

# dist 说明
$distDir = Join-Path $target 'dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$distReadme = @"
$product 桌面版
$(('=' * ($product.Length + 5)))
版本：1.0.0

这是什么
--------
官方网页端（$($uri.AbsoluteUri)）的桌面封装客户端。
它不是官方客户端，只是一个本地的网页外壳，不会修改任何游戏数据。


怎么用
------
1. 双击 "$product.exe"
2. 第一次启动会解压运行环境（约 4 秒），之后约 1 秒
3. 用你自己的账号登录，登录状态会保存在本机，下次免登录


如果 Windows 弹出「已保护你的电脑」
----------------------------------
程序没有购买数字签名证书，首次运行时 SmartScreen 可能会拦截：
点「更多信息」→「仍要运行」即可。

如果弹出「Windows 安全中心：是否要允许网络访问」，选「允许访问」（串流需要网络）。


快捷键
------
  F11 / Alt+Enter    全屏切换
  Ctrl+Shift+H       回到入口页
  F12                开发者工具
  Ctrl+W             已屏蔽，防止误关串流


全屏是自动的
------------
启动后是普通窗口（1280×800），点「开始游戏」进入游戏后自动全屏；
退出游戏回到启动界面时自动恢复窗口。也可以随时按 F11 手动切换。

右下角托盘图标右键可以：全屏、启动时自动全屏、玩游戏时自动全屏、
全屏时防止息屏、退出前询问、重新加载、回到入口页、开发者工具。


网页类入口会打开浏览器
----------------------
点「公告 / 下载 / 用户中心 / 各类协议」这类入口时，会用你的默认浏览器打开，
客户端窗口始终停在游戏页面上。


退出游戏
--------
点右上角 × 或按 Alt+F4 会弹确认框：选「退出」结束客户端并释放云游戏会话，
选「继续游戏」接着玩。不需要去任务管理器手动结束进程。


系统要求
--------
Windows 10 / 11 64 位（需要 .NET Framework 4.0 以上，系统自带）


数据放在哪 / 怎么卸载
---------------------
程序本体就是这一个 exe，删掉它就等于卸载。
另外会在你电脑上生成两处数据，不需要时可一并删除：
  %APPDATA%\$product              你的登录状态与设置
  %LOCALAPPDATA%\$cacheRoot   运行环境缓存（约 320MB）

换电脑或换目录时它会重新解包一次（约 4 秒），属正常现象。
"@
Write-Text (Join-Path $distDir 'README.txt') $distReadme $true
Info 'dist\README.txt'

# ------------------------------------------------------------------ 4. 图标

Step '4/6 生成图标'

$iconSource = Join-Path $forgeRoot '_build\favicon-download'
New-Item -ItemType Directory -Force -Path (Split-Path $iconSource -Parent) | Out-Null
$iconFile = $null
foreach ($cand in $iconCandidates) {
    $tmp = "$iconSource.bin"
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    if (Download $cand $tmp) {
        $len = (Get-Item $tmp).Length
        if ($len -gt 200) {
            $iconFile = $tmp
            Info "favicon: $cand ($([math]::Round($len/1KB)) KB)"
            break
        }
    }
}
if (-not $iconFile) { Warn '没下载到 favicon，将生成占位图标（可用 -IconUrl 指定）' }

# 注意：没有 favicon 时 $iconFile 是 $null，直接写 `-Source $iconFile` 会被 PowerShell
# 当成「参数缺少值」而报错，所以这里用数组拼接 + 展开传参。
$iconArgs = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $forgeRoot 'lib\make-icon.ps1'),
    '-DisplayName', $display,
    '-OutDir', $assetsDir
)
if ($iconFile) { $iconArgs += @('-Source', $iconFile) }
& powershell.exe @iconArgs
if (-not (Test-Path (Join-Path $assetsDir 'icon.ico'))) { Fail '图标生成失败' }

# ------------------------------------------------------------------ 5. 打包

$exePath = Join-Path $target "$product.exe"
if ($SkipBuild) {
    Step '5/6 跳过打包（-SkipBuild）'
    Info '需要时运行：powershell -ExecutionPolicy Bypass -File tools\build-client.ps1'
} else {
    Step '5/6 打包单文件客户端（首次约 1~2 分钟）'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $toolsDir 'build-client.ps1')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exePath)) { Fail '打包失败，请看上面的输出' }
    Copy-Item $exePath (Join-Path $distDir "$product.exe") -Force
    Info ("exe: $exePath  ({0} MB)" -f [math]::Round((Get-Item $exePath).Length / 1MB, 1))
}

# ------------------------------------------------------------------ 6. 分发 zip

Step '6/6 收尾'

if (-not $SkipBuild -and -not $SkipZip) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = Join-Path $target "$product.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $distDir, $zip, [System.IO.Compression.CompressionLevel]::NoCompression, $false)
    Info ("zip: $zip  ({0} MB)" -f [math]::Round((Get-Item $zip).Length / 1MB, 1))
}

if ($Shortcuts -and (Test-Path $exePath)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $toolsDir 'create-shortcuts.ps1')
}

# 清理中间产物（release 320MB、payload 139MB），保留可重建
Remove-Item (Join-Path $target 'release') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $target '_build\payload.zip') -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "== 完成" -ForegroundColor Green
Write-Host "   目录 : $target"
if (-not $SkipBuild) {
    Write-Host "   客户端: $(Join-Path $target "$product.exe")"
    if (-not $SkipZip) { Write-Host "   分发包: $(Join-Path $target "$product.zip")" }
}
Write-Host "   重新打包: powershell -ExecutionPolicy Bypass -File `"$toolsDir\build-client.ps1`""
Write-Host ''

if ($OpenFolder) { Start-Process explorer.exe $target }
