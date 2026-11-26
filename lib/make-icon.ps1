# 站点 favicon → 多分辨率 icon.ico / icon.png（只用 Windows 自带的 System.Drawing）
#
# 参数：
#   -Source      源图路径（png/jpg/ico 均可；没有或无法解码时生成占位图标）
#   -DisplayName 占位图标上用的文字
#   -OutDir      输出目录（要存在）
param(
    [string]$Source,
    [string]$DisplayName = 'Cloud',
    [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Placeholder([string]$text) {
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # 由名字决定一个稳定的颜色，避免每次生成不一样
    $seed = 0
    foreach ($ch in $text.ToCharArray()) { $seed = ($seed * 31 + [int]$ch) % 360 }
    $c1 = [System.Drawing.Color]::FromArgb(255, (30 + $seed % 60), (60 + ($seed * 2) % 80), (120 + ($seed * 3) % 90))
    $c2 = [System.Drawing.Color]::FromArgb(255, (10 + $seed % 30), (20 + ($seed * 2) % 40), (40 + ($seed * 3) % 60))
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 60.0)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    $letter = if ($text -and $text.Length -gt 0) { $text.Substring(0, 1).ToUpper() } else { 'C' }
    $font = New-Object System.Drawing.Font('Segoe UI', 132, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect2 = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString($letter, $font, [System.Drawing.Brushes]::White, $rect2, $fmt)
    $font.Dispose(); $fmt.Dispose(); $g.Dispose()
    return $bmp
}

# ---- 载入源图 ----
$src256 = $null
if ($Source -and (Test-Path -LiteralPath $Source)) {
    try {
        $img = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
        $side = [Math]::Max($img.Width, $img.Height)
        $square = New-Object System.Drawing.Bitmap($side, $side)
        $sg = [System.Drawing.Graphics]::FromImage($square)
        $sg.Clear([System.Drawing.Color]::Transparent)
        $sg.DrawImage($img, [int](($side - $img.Width) / 2), [int](($side - $img.Height) / 2), $img.Width, $img.Height)
        $sg.Dispose()
        $src256 = New-Object System.Drawing.Bitmap($square, 256, 256)
        $square.Dispose(); $img.Dispose()
    } catch {
        Write-Host "      [i] 源图无法解码，改用占位图标：$($_.Exception.Message)"
        $src256 = $null
    }
}
if (-not $src256) { $src256 = New-Placeholder $DisplayName }

# ---- 输出 icon.png ----
$pngPath = Join-Path $OutDir 'icon.png'
$src256.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# ---- 输出多分辨率 icon.ico（PNG 帧，Vista+ 支持）----
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$datas = @()
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src256, 0, 0, $s, $s)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $datas += , $ms.ToArray()
    $ms.Dispose(); $bmp.Dispose()
}

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type = icon
$bw.Write([UInt16]$sizes.Count)      # count
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]0)               # palette
    $bw.Write([Byte]0)               # reserved
    $bw.Write([UInt16]1)             # planes
    $bw.Write([UInt16]32)            # bpp
    $bw.Write([UInt32]$datas[$i].Length)
    $bw.Write([UInt32]$offset)
    $offset += $datas[$i].Length
}
foreach ($d in $datas) { $bw.Write($d) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'icon.ico'), $out.ToArray())
$bw.Dispose(); $out.Dispose(); $src256.Dispose()

Write-Host ("      icon: {0} (png 130KB / ico {1} sizes)" -f $OutDir, $sizes.Count)
