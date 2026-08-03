[CmdletBinding()]
param(
  [string]$ProjectRoot = "C:\Web\burger",
  [switch]$RequirePublishedApks
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$required = @(
  "app\apps\page.tsx",
  "components\mobile\MobileAppsClient.tsx",
  "tools\mobile\Build-BB-Android-Suite.ps1",
  "tools\mobile\Install-BB-Android-Tools.ps1",
  "tools\mobile\Publish-BB-iOS-Association.ps1",
  "mobile\android\burger-brothers\twa-manifest.template.json",
  "mobile\android\bb-schnell\twa-manifest.template.json",
  "mobile\android\bb-driver\twa-manifest.template.json",
  "mobile\ios\burger-brothers\project.yml",
  "mobile\ios\bb-schnell\project.yml",
  "mobile\ios\bb-driver\project.yml",
  "public\downloads\burger-brothers-version.json",
  "public\downloads\bb-schnell-version.json",
  "public\downloads\bb-driver-version.json"
)
foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative))) { throw "Missing file: $relative" }
}

$expected = @(
  @{ slug="burger-brothers"; package="berlin.burgerbrothers.app"; start="/"; apk="burger-brothers.apk" },
  @{ slug="bb-schnell"; package="berlin.burgerbrothers.schnell"; start="/schnellbestellung/enter"; apk="bb-schnell.apk" },
  @{ slug="bb-driver"; package="berlin.burgerbrothers.driver"; start="/driver"; apk="bb-driver.apk" }
)
$packages = New-Object System.Collections.Generic.HashSet[string]
foreach ($item in $expected) {
  $template = Get-Content -LiteralPath (Join-Path $ProjectRoot "mobile\android\$($item.slug)\twa-manifest.template.json") -Raw | ConvertFrom-Json
  if ($template.packageId -ne $item.package) { throw "Wrong package ID for $($item.slug)." }
  if (-not ([string]$template.startUrl).StartsWith($item.start)) { throw "Wrong start URL for $($item.slug)." }
  if (-not $packages.Add([string]$template.packageId)) { throw "Duplicate Android package ID." }

  $release = Get-Content -LiteralPath (Join-Path $ProjectRoot "public\downloads\$($item.slug)-version.json") -Raw | ConvertFrom-Json
  if ($release.packageId -ne $item.package) { throw "Wrong release package ID for $($item.slug)." }

  foreach ($size in @(192, 512, 1024)) {
    $icon = Join-Path $ProjectRoot "public\mobile-icons\$($item.slug)-$size.png"
    if (-not (Test-Path -LiteralPath $icon)) { throw "Missing icon: $icon" }
  }

  if ($RequirePublishedApks) {
    $apkPath = Join-Path $ProjectRoot "public\downloads\$($item.apk)"
    if (-not (Test-Path -LiteralPath $apkPath)) { throw "Published APK is missing: $($item.apk)" }
    if ($release.available -ne $true) { throw "Release available flag is false for $($item.slug)." }
    $hash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($hash -ne [string]$release.sha256) { throw "APK hash mismatch for $($item.slug)." }
  }
}

$page = Get-Content -LiteralPath (Join-Path $ProjectRoot "components\mobile\MobileAppsClient.tsx") -Raw
foreach ($apk in @("burger-brothers.apk", "bb-schnell.apk", "bb-driver.apk")) {
  if (-not $page.Contains($apk)) { throw "Apps page does not contain $apk" }
}

if ($RequirePublishedApks) {
  $assetPath = Join-Path $ProjectRoot "public\.well-known\assetlinks.json"
  if (-not (Test-Path -LiteralPath $assetPath)) { throw "assetlinks.json is missing." }
  $asset = Get-Content -LiteralPath $assetPath -Raw | ConvertFrom-Json
  $assetPackages = @($asset | ForEach-Object { $_.target.package_name })
  foreach ($package in @("berlin.burgerbrothers.app", "berlin.burgerbrothers.schnell", "berlin.burgerbrothers.driver")) {
    if ($assetPackages -notcontains $package) { throw "assetlinks.json is missing $package" }
  }
}

Write-Host "BB mobile suite checks passed." -ForegroundColor Green
