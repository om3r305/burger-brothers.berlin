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
if ($ProjectRoot -ne "C:\Web\burger") { Write-Host "Kaynak proje: $ProjectRoot" -ForegroundColor Yellow }
if (-not (Test-Path "$ProjectRoot\package.json")) { throw "package.json bulunamadi: $ProjectRoot" }
if (-not (Test-Path "$GitHubRoot\.git")) { throw "GitHub repo klasoru bulunamadi: $GitHubRoot" }

$files = @(
  "lib\showcase\types.ts",
  "lib\showcase\config.ts",
  "lib\showcase\server.ts",
  "app\api\showcase\route.ts",
  "app\api\admin\showcase\route.ts",
  "app\api\admin\showcase\reviews\route.ts",
  "app\showcase\[screen]\page.tsx",
  "components\showcase\ShowcasePlayer.tsx",
  "components\showcase\ShowcaseStage.tsx",
  "components\showcase\ShowcaseStage.module.css",
  "app\admin\showcase\page.tsx",
  "tools\showcase-platform-expansion-tests.cjs",
  "SHOWCASE-MULTI-SCREEN-PREMIUM-REPORT-TR.md"
)

Write-Host "`n[1/5] Dosyalar kontrol ediliyor..." -ForegroundColor Cyan
foreach ($rel in $files) {
  $src = Join-Path $ProjectRoot $rel
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "Eksik dosya: $src" }
}

Write-Host "`n[2/5] Regression testleri..." -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
  & node.exe "tools\showcase-platform-expansion-tests.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Showcase regression testi basarisiz." }

  Write-Host "`n[3/5] Temiz production build..." -ForegroundColor Cyan
  if (Test-Path ".next") { Remove-Item ".next" -Recurse -Force }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Production build basarisiz. GitHub'a gonderim yapilmadi." }
} finally { Pop-Location }

Write-Host "`n[4/5] Yalniz degisen dosyalar GitHub repo klasorune kopyalaniyor..." -ForegroundColor Cyan
foreach ($rel in $files) {
  $src = Join-Path $ProjectRoot $rel
  $dst = Join-Path $GitHubRoot $rel
  $dir = Split-Path -Parent $dst
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Write-Host "  $rel" -ForegroundColor DarkGray
}

Write-Host "`n[5/5] Commit ve push..." -ForegroundColor Cyan
Push-Location $GitHubRoot
try {
  $branch = (& git branch --show-current).Trim()
  if ($branch -ne "main") { throw "Aktif branch main degil: $branch" }
  foreach ($rel in $files) { & git add -- $rel }
  $changes = & git diff --cached --name-only
  if (-not $changes) {
    Write-Host "Commit edilecek yeni degisiklik yok." -ForegroundColor Yellow
  } else {
    & git commit -m "feat: add multi-screen premium showcase scenes"
    if ($LASTEXITCODE -ne 0) { throw "Git commit basarisiz." }
    & git push origin main
    if ($LASTEXITCODE -ne 0) { throw "Git push basarisiz." }
  }
} finally { Pop-Location }

Write-Host "`nTAMAMLANDI: build + secili dosyalar + main push" -ForegroundColor Green
