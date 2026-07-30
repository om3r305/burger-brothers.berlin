#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$GitHubRoot = "C:\Web\burger-github"
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")
$GitHubRoot = [IO.Path]::GetFullPath($GitHubRoot).TrimEnd("\")
if (-not (Test-Path "$ProjectRoot\package.json")) { throw "package.json bulunamadi: $ProjectRoot" }
if (-not (Test-Path "$GitHubRoot\.git")) { throw "GitHub repo klasoru bulunamadi: $GitHubRoot" }
$files = @(
  "components\showcase\ShowcaseStage.tsx",
  "components\showcase\ShowcaseStage.module.css",
  "app\admin\showcase\page.tsx",
  "tools\showcase-premium-responsive-tests.cjs",
  "SHOWCASE-PREMIUM-RESPONSIVE-FIX-REPORT-TR.md"
)
Write-Host "`n[1/5] Dosyalar kontrol ediliyor..." -ForegroundColor Cyan
foreach ($rel in $files) { if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $rel) -PathType Leaf)) { throw "Eksik dosya: $rel" } }
Push-Location $ProjectRoot
try {
  Write-Host "`n[2/5] Regression testi..." -ForegroundColor Cyan
  & node.exe "tools\showcase-premium-responsive-tests.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Showcase testi basarisiz." }
  Write-Host "`n[3/5] Temiz production build..." -ForegroundColor Cyan
  if (Test-Path ".next") { Remove-Item ".next" -Recurse -Force }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Build basarisiz. GitHub'a gonderilmedi." }
} finally { Pop-Location }
Write-Host "`n[4/5] Degisen dosyalar GitHub klasorune kopyalaniyor..." -ForegroundColor Cyan
foreach ($rel in $files) {
  $src=Join-Path $ProjectRoot $rel; $dst=Join-Path $GitHubRoot $rel; $dir=Split-Path -Parent $dst
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dst -Force
}
Write-Host "`n[5/5] main branch commit ve push..." -ForegroundColor Cyan
Push-Location $GitHubRoot
try {
  $branch=(& git branch --show-current).Trim(); if ($branch -ne "main") { throw "Aktif branch main degil: $branch" }
  foreach ($rel in $files) { & git add -- $rel }
  $changes=& git diff --cached --name-only
  if ($changes) {
    & git commit -m "fix: make premium showcase scenes responsive"
    if ($LASTEXITCODE -ne 0) { throw "Commit basarisiz." }
    & git push origin main
    if ($LASTEXITCODE -ne 0) { throw "Push basarisiz." }
  } else { Write-Host "Yeni degisiklik yok." -ForegroundColor Yellow }
} finally { Pop-Location }
Write-Host "`nTAMAMLANDI: responsive sahneler + hava metinleri + build + push" -ForegroundColor Green
