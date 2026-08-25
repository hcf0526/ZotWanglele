Add-Type -AssemblyName System.Drawing

function Generate-IconPng {
    param(
        [int]$Size,
        [string]$OutputPath,
        [double]$PaddingRatio = 0.05,
        [double]$CornerRadiusRatio = 0.22
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = $Size * $PaddingRatio
    $contentSize = $Size - ($pad * 2.0)
    $radius = $contentSize * $CornerRadiusRatio
    $rect = New-Object System.Drawing.RectangleF($pad, $pad, $contentSize, $contentSize)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2.0
    $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF($rect.X, $rect.Y)),
        (New-Object System.Drawing.PointF($rect.Right, $rect.Bottom)),
        ([System.Drawing.Color]::FromArgb(255, 15, 23, 42)),
        ([System.Drawing.Color]::FromArgb(255, 30, 27, 75))
    )
    $g.FillPath($bgBrush, $path)

    $borderPen = New-Object System.Drawing.Pen(
        ([System.Drawing.Color]::FromArgb(100, 56, 189, 248)),
        [Math]::Max(1.0, $Size * 0.02)
    )
    $g.DrawPath($borderPen, $path)

    function MapX([double]$x) { return $rect.X + ($x / 128.0) * $rect.Width }
    function MapY([double]$y) { return $rect.Y + ($y / 128.0) * $rect.Height }

    $strokeWidth = [Math]::Max(1.8, $Size * 0.088)

    $pLeft1 = New-Object System.Drawing.PointF((MapX 28), (MapY 38))
    $pLeft2 = New-Object System.Drawing.PointF((MapX 49), (MapY 84))
    $pMid   = New-Object System.Drawing.PointF((MapX 64), (MapY 52))
    $pRight2= New-Object System.Drawing.PointF((MapX 79), (MapY 84))
    $pRight1= New-Object System.Drawing.PointF((MapX 100), (MapY 38))

    $leftBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $pLeft1,
        $pMid,
        ([System.Drawing.Color]::FromArgb(255, 6, 182, 212)),
        ([System.Drawing.Color]::FromArgb(255, 59, 130, 246))
    )
    $leftPen = New-Object System.Drawing.Pen($leftBrush, $strokeWidth)
    $leftPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $leftPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $leftPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $leftPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $leftPath.AddLine($pLeft1, $pLeft2)
    $leftPath.AddLine($pLeft2, $pMid)
    $g.DrawPath($leftPen, $leftPath)

    $rightBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $pMid,
        $pRight1,
        ([System.Drawing.Color]::FromArgb(255, 139, 92, 246)),
        ([System.Drawing.Color]::FromArgb(255, 236, 72, 153))
    )
    $rightPen = New-Object System.Drawing.Pen($rightBrush, $strokeWidth)
    $rightPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $rightPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $rightPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $rightPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $rightPath.AddLine($pMid, $pRight2)
    $rightPath.AddLine($pRight2, $pRight1)
    $g.DrawPath($rightPen, $rightPath)

    if ($Size -ge 24) {
        $starScale = ($contentSize / 128.0)
        $starCx = MapX 64
        $starCy = MapY 52
        $starR1 = 7.5 * $starScale
        $starR2 = 2.4 * $starScale

        $starPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $pts = @(
            (New-Object System.Drawing.PointF($starCx, ($starCy - $starR1))),
            (New-Object System.Drawing.PointF(($starCx + $starR2), ($starCy - $starR2))),
            (New-Object System.Drawing.PointF(($starCx + $starR1), $starCy)),
            (New-Object System.Drawing.PointF(($starCx + $starR2), ($starCy + $starR2))),
            (New-Object System.Drawing.PointF($starCx, ($starCy + $starR1))),
            (New-Object System.Drawing.PointF(($starCx - $starR2), ($starCy + $starR2))),
            (New-Object System.Drawing.PointF(($starCx - $starR1), $starCy)),
            (New-Object System.Drawing.PointF(($starCx - $starR2), ($starCy - $starR2)))
        )
        $starPath.AddPolygon($pts)
        $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
        $g.FillPath($whiteBrush, $starPath)
        $whiteBrush.Dispose()
        $starPath.Dispose()
    }

    $dir = [System.IO.Path]::GetDirectoryName($OutputPath)
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $leftPen.Dispose()
    $leftBrush.Dispose()
    $leftPath.Dispose()
    $rightPen.Dispose()
    $rightBrush.Dispose()
    $rightPath.Dispose()
    $borderPen.Dispose()
    $bgBrush.Dispose()
    $path.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

$targets = @(
    @{ Size = 96; Path = "addon/content/icons/favicon.png" },
    @{ Size = 48; Path = "addon/content/icons/favicon@0.5x.png" },
    @{ Size = 96; Path = "addon/content/icons/icon@96.png" },
    @{ Size = 48; Path = "addon/content/icons/icon@48.png" },
    @{ Size = 24; Path = "addon/content/icons/toolbar.png" },
    @{ Size = 24; Path = "addon/content/icons/icon24.png" },
    @{ Size = 16; Path = "addon/content/icons/icon16.png" },
    @{ Size = 128; Path = "addon/content/icons/icon@128.png" },
    @{ Size = 64; Path = "addon/content/icons/icon@64.png" },
    @{ Size = 32; Path = "addon/content/icons/icon@32.png" }
)

foreach ($t in $targets) {
    Generate-IconPng -Size $t.Size -OutputPath $t.Path
    Write-Output "Generated: $($t.Path) ($($t.Size)x$($t.Size))"
}
