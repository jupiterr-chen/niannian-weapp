# 念念听写小程序头像生成器（GDI+ 纯本地绘制，无外部依赖）
# 设计：蓝色渐变圆角底 → 白色对话气泡（念词给孩子听）→ 蓝色大字「听」→
# 白色声波弧线（朗读）。所有元素按 512 逻辑画布等比缩放。
param(
  [string]$OutDir = "$PSScriptRoot\..\assets\brand"
)

Add-Type -AssemblyName System.Drawing

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90)
  $p.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
  $p.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $p.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $p.CloseFigure()
  return $p
}

function Render([int]$size) {
  $s = $size / 512.0
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # 背板：圆角方块 + 纵向蓝渐变（品牌主色 #1d4ed8 → #3b82f6）
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $c1 = [System.Drawing.Color]::FromArgb(255, 29, 78, 216)
  $c2 = [System.Drawing.Color]::FromArgb(255, 59, 130, 246)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 90.0)
  $g.FillPath($bg, (New-RoundRect 0 0 $size $size (112 * $s)))

  # 白色对话气泡 + 左下小尾巴（“念词的声音”）
  $white = [System.Drawing.Brushes]::White
  $bubblePath = New-RoundRect (96 * $s) (110 * $s) (320 * $s) (250 * $s) (56 * $s)
  $tail = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tail.AddPolygon(@(
    [System.Drawing.PointF]::new((150 * $s), (344 * $s)),
    [System.Drawing.PointF]::new((214 * $s), (344 * $s)),
    [System.Drawing.PointF]::new((158 * $s), (404 * $s))
  ))
  $g.FillPath($white, $bubblePath)
  $g.FillPath($white, $tail)

  # 气泡里的大字「听」，用品牌蓝
  $font = New-Object System.Drawing.Font('Microsoft YaHei', (152 * $s), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF((96 * $s), (110 * $s), (320 * $s), (250 * $s))
  $g.DrawString('听', $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 29, 78, 216))), $textRect, $sf)

  # 声波：气泡右上角外侧三条同心弧线
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, (22 * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  foreach ($r in @(24, 52, 80)) {
    $rr = $r * $s
    $g.DrawArc($pen, ((410 - $r) * $s), ((126 - $r) * $s), (2 * $rr), (2 * $rr), -72, 78)
  }

  $out = Join-Path $OutDir ("niannian-avatar-$size.png")
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "saved: $out"
}

Render 512
Render 1024
