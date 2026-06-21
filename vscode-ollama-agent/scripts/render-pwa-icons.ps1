$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$iconDir = Join-Path $repoRoot 'public/icons'
$sizes = @(180, 192, 512)

function New-Color($Hex, [int]$Alpha = 255) {
  $hexValue = $Hex.TrimStart('#')
  $r = [Convert]::ToInt32($hexValue.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($hexValue.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($hexValue.Substring(4, 2), 16)
  [System.Drawing.Color]::FromArgb($Alpha, $r, $g, $b)
}

function New-RoundedRectPath([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-Polygon($Graphics, $Scale, $Hex, $Alpha, [float[]]$Points) {
  $brush = [System.Drawing.SolidBrush]::new((New-Color $Hex $Alpha))
  try {
    $drawingPoints = for ($i = 0; $i -lt $Points.Count; $i += 2) {
      [System.Drawing.PointF]::new($Points[$i] * $Scale, $Points[$i + 1] * $Scale)
    }
    $Graphics.FillPolygon($brush, [System.Drawing.PointF[]]$drawingPoints)
  }
  finally {
    $brush.Dispose()
  }
}

function Draw-BobIcon($Size) {
  $scale = $Size / 512
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  try {
    $background = New-RoundedRectPath 0 0 $Size $Size (96 * $scale)
    $backgroundBrush = [System.Drawing.SolidBrush]::new((New-Color '#020712'))
    $graphics.FillPath($backgroundBrush, $background)
    $backgroundBrush.Dispose()
    $background.Dispose()

    Fill-Polygon $graphics $scale '#10224a' 153 @(96,64, 416,64, 448,96, 64,96)
    Fill-Polygon $graphics $scale '#030b1f' 133 @(416,64, 448,96, 448,416, 416,448)
    Fill-Polygon $graphics $scale '#010615' 122 @(64,416, 448,416, 416,448, 96,448)
    Fill-Polygon $graphics $scale '#0b1838' 56 @(64,64, 32,96, 32,416, 64,448)

    $head = New-RoundedRectPath (64 * $scale) (64 * $scale) (384 * $scale) (384 * $scale) (64 * $scale)
    $headBrush = [System.Drawing.SolidBrush]::new((New-Color '#071229'))
    $headPen = [System.Drawing.Pen]::new((New-Color '#00e0ff'), 10 * $scale)
    $graphics.FillPath($headBrush, $head)
    $graphics.DrawPath($headPen, $head)
    $headBrush.Dispose()
    $headPen.Dispose()
    $head.Dispose()

    $linePen1 = [System.Drawing.Pen]::new((New-Color '#dfe9ff' 26), 7 * $scale)
    $linePen1.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen1.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddBezier(168 * $scale, 108 * $scale, 226 * $scale, 100 * $scale, 286 * $scale, 100 * $scale, 344 * $scale, 108 * $scale)
    $graphics.DrawPath($linePen1, $path)
    $path.Dispose()
    $linePen1.Dispose()

    $linePen2 = [System.Drawing.Pen]::new((New-Color '#dfe9ff' 13), 5 * $scale)
    $linePen2.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen2.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddBezier(196 * $scale, 128 * $scale, 236 * $scale, 123 * $scale, 276 * $scale, 123 * $scale, 316 * $scale, 128 * $scale)
    $graphics.DrawPath($linePen2, $path)
    $path.Dispose()
    $linePen2.Dispose()

    foreach ($brow in @(
      @{ Hex = '#00e0ff'; Points = @(126,158, 160,140, 194,140, 226,148) },
      @{ Hex = '#7c5cff'; Points = @(286,148, 318,140, 352,140, 386,158) }
    )) {
      $pen = [System.Drawing.Pen]::new((New-Color $brow.Hex 184), 16 * $scale)
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      $points = $brow.Points
      $path.AddBezier($points[0] * $scale, $points[1] * $scale, $points[2] * $scale, $points[3] * $scale, $points[4] * $scale, $points[5] * $scale, $points[6] * $scale, $points[7] * $scale)
      $graphics.DrawPath($pen, $path)
      $path.Dispose()
      $pen.Dispose()
    }

    foreach ($eye in @(
      @{ Hex = '#00e0ff'; X = 186; Y = 236 },
      @{ Hex = '#7c5cff'; X = 326; Y = 236 }
    )) {
      $brush = [System.Drawing.SolidBrush]::new((New-Color $eye.Hex))
      $graphics.FillEllipse($brush, ($eye.X - 34) * $scale, ($eye.Y - 19) * $scale, 68 * $scale, 38 * $scale)
      $brush.Dispose()
    }

    $mouthPen = [System.Drawing.Pen]::new((New-Color '#dfe9ff'), 28 * $scale)
    $mouthPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $mouthPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddBezier(158 * $scale, 320 * $scale, 220 * $scale, 370 * $scale, 292 * $scale, 370 * $scale, 354 * $scale, 320 * $scale)
    $graphics.DrawPath($mouthPen, $path)
    $path.Dispose()
    $mouthPen.Dispose()

    $output = Join-Path $iconDir "bob-face-$Size.png"
    $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Wrote $output"
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

foreach ($size in $sizes) {
  Draw-BobIcon $size
}
