Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '樣本.png'
$bmp = New-Object System.Drawing.Bitmap(900, 420)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Microsoft JhengHei', 30)
$fontSmall = New-Object System.Drawing.Font('Microsoft JhengHei', 18)
$brush = [System.Drawing.Brushes]::Black
$g.DrawString('訂單編號：ABC-2026', $font, $brush, 30, 30)
$g.DrawString('臺灣銀行 台北分行', $font, $brush, 30, 100)
$g.DrawString('王小明 你好，很高興認識你', $font, $brush, 30, 170)
$g.DrawString('2024 年 12 月 31 日', $font, $brush, 30, 240)
$g.DrawString('大小太犬 分辨測試', $fontSmall, $brush, 30, 330)
$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "已產生 $out"
