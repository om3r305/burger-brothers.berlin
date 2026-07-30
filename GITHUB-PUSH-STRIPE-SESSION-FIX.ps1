$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$requiredFiles = @(
  "app\api\payments\prepare\route.ts"
)

if (!(Test-Path -LiteralPath $src -PathType Container)) {
  Write-Host "Calisan proje bulunamadi: $src" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
  Write-Host "GitHub repo bulunamadi: $repo" -ForegroundColor Red
  exit 1
}

Set-Location $repo

Write-Host ""
Write-Host "GitHub repository guncelleniyor..." -ForegroundColor Cyan

git pull --ff-only

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "git pull basarisiz oldu. Commit ve push yapilmadi." -ForegroundColor Red
  exit 1
}

$gitPaths = New-Object System.Collections.Generic.List[string]

Write-Host ""
Write-Host "Guncellenen Stripe odeme dosyasi kontrol ediliyor..." -ForegroundColor Cyan

foreach ($file in $requiredFiles) {
  $sourceFile = Join-Path $src $file
  $targetFile = Join-Path $repo $file

  if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    Write-Host "ZORUNLU DOSYA BULUNAMADI: $sourceFile" -ForegroundColor Red
    exit 1
  }

  New-Item `
    -ItemType Directory `
    -Path (Split-Path -Parent $targetFile) `
    -Force | Out-Null

  Copy-Item `
    -LiteralPath $sourceFile `
    -Destination $targetFile `
    -Force

  $gitPaths.Add(($file -replace "\\", "/"))
  Write-Host "Kopyalandi: $file" -ForegroundColor Green
}

Write-Host ""
Write-Host "Temiz production build baslatiliyor..." -ForegroundColor Cyan

Remove-Item `
  -LiteralPath (Join-Path $repo ".next") `
  -Recurse `
  -Force `
  -ErrorAction SilentlyContinue

Remove-Item `
  -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") `
  -Force `
  -ErrorAction SilentlyContinue

npx.cmd prisma generate

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "PRISMA GENERATE HATALI - Commit ve push yapilmadi." -ForegroundColor Red
  exit 1
}

npm.cmd run build

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "BUILD HATALI - Commit ve push yapilmadi." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Build basarili." -ForegroundColor Green

$uniqueGitPaths = $gitPaths | Sort-Object -Unique

foreach ($path in $uniqueGitPaths) {
  git add -- $path

  if ($LASTEXITCODE -ne 0) {
    Write-Host "Git add basarisiz: $path" -ForegroundColor Red
    exit 1
  }
}

git diff --cached --check

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Stage edilen dosyada diff hatasi bulundu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Gonderilecek degisiklik:" -ForegroundColor Cyan

git status --short
git -c core.pager=cat diff --cached --stat

git diff --cached --quiet

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Yeni degisiklik bulunamadi; dosya GitHub klasorunde zaten ayni." -ForegroundColor Yellow
  exit 0
}

git commit -m "Fix Stripe Checkout session placeholder in payment return URL"

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Commit olusturulamadi." -ForegroundColor Red
  exit 1
}

$branch = (git branch --show-current).Trim()

if (!$branch) {
  $branch = "main"
}

git push -u origin $branch

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Git push basarisiz oldu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "STRIPE CHECKOUT SESSION DUZELTMESI GITHUB'A GONDERILDI" -ForegroundColor Green
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Gonderilen dosya:" -ForegroundColor Cyan
Write-Host " - app\api\payments\prepare\route.ts" -ForegroundColor Green
