[CmdletBinding()]
param([string]$ProjectRoot = "C:\Web\burger")
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$definitions = @(
  @{ slug="burger-brothers"; packageId="berlin.burgerbrothers.app"; apk="burger-brothers.apk" },
  @{ slug="bb-schnell"; packageId="berlin.burgerbrothers.schnell"; apk="bb-schnell.apk" },
  @{ slug="bb-driver"; packageId="berlin.burgerbrothers.driver"; apk="bb-driver.apk" }
)
$encoding = New-Object System.Text.UTF8Encoding($false)
foreach ($d in $definitions) {
  Remove-Item -LiteralPath (Join-Path $ProjectRoot "public\downloads\$($d.apk)") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $ProjectRoot "mobile\android\$($d.slug)\releases") -Recurse -Force -ErrorAction SilentlyContinue
  $data = [ordered]@{ available=$false; version="1.0.0"; versionCode=1; apkUrl="/downloads/$($d.apk)"; sha256=""; sizeBytes=0; publishedAt=$null; minimumAndroid=8; packageId=$d.packageId }
  [IO.File]::WriteAllText((Join-Path $ProjectRoot "public\downloads\$($d.slug)-version.json"), ($data | ConvertTo-Json -Depth 10), $encoding)
}
Remove-Item -LiteralPath (Join-Path $ProjectRoot "public\.well-known\assetlinks.json") -Force -ErrorAction SilentlyContinue
Write-Host "Published APK files were reset. Keystore was not touched." -ForegroundColor Green
