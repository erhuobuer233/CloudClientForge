# 生成 CloudClientForge 自己的图标：圆角渐变方块 + 云朵 + 下载箭头
# 输出 app\assets\icon.png + icon.ico（多分辨率）
param(
    [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# ---- 圆角矩形（半径 56）作为外轮廓 ----
function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
    $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

$outer = New-RoundedPath 4 4 248 248 60
$rect = New-Object System.Drawing.Rectangle(4, 4, 248, 248)
$c1 = [System.Drawing.Color]::FromArgb(255, 138, 152, 255)   # 靛蓝
$c2 = [System.Drawing.Color]::FromArgb(255, 186, 130, 255)   # 紫
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 55.0)
$g.FillPath($brush, $outer)
$brush.Dispose()

# 顶部高光
$g.SetClip($outer)
$hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, 256, 256)),
    [System.Drawing.Color]::FromArgb(60, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255), 90.0)
$g.FillRectangle($hl, 0, 0, 256, 256)
$hl.Dispose()

# ---- 云朵（白色）----
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(248, 255, 255, 255))
$g.FillEllipse($white, 62, 108, 82, 82)
$g.FillEllipse($white, 104, 84, 86, 86)
$g.FillEllipse($white, 146, 112, 66, 66)
$g.FillRectangle($white, 92, 150, 108, 40)
$white.Dispose()

# ---- 云里的下载箭头（深色）----
$dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 26, 32, 62))
$g.FillRectangle($dark, 121, 112, 14, 34)
$arrow = New-Object System.Drawing.Drawing2D.GraphicsPath
$arrow.AddPolygon(@(
    (New-Object System.Drawing.Point(100, 142)),
    (New-Object System.Drawing.Point(156, 142)),
    (New-Object System.Drawing.Point(128, 176))
))
$g.FillPath($dark, $arrow)
$arrow.Dispose()
$dark.Dispose()

# 底部收边高光（让边角更"实"一点）
$g.ResetClip()
$outline = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 255, 255, 255), 2)
$g.DrawPath($outline, $outer)
$outline.Dispose()
$g.Dispose()

# ---- 输出 ----
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$base = New-Object System.Drawing.Bitmap($bmp, 256, 256)
$base.Save((Join-Path $OutDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$datas = @()
foreach ($s in $sizes) {
    $sb = New-Object System.Drawing.Bitmap($s, $s)
    $sg = [System.Drawing.Graphics]::FromImage($sb)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sg.DrawImage($base, 0, 0, $s, $s)
    $sg.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $sb.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $datas += , $ms.ToArray()
    $ms.Dispose(); $sb.Dispose()
}

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([Byte]$dim); $bw.Write([Byte]$dim)
    $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$datas[$i].Length)
    $bw.Write([UInt32]$offset)
    $offset += $datas[$i].Length
}
foreach ($d in $datas) { $bw.Write($d) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'icon.ico'), $out.ToArray())
$bw.Dispose(); $out.Dispose(); $base.Dispose(); $bmp.Dispose()

Write-Host "      forge icon: $OutDir (png + ico, $($sizes.Count) sizes)"
