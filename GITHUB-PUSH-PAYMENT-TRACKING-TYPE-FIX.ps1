$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$requiredFiles = @(
  "lib\server\payment-finalize.ts"
)

if (!(Test-Path -LiteralPath $src -PathType Container)) {
  Write-Host "Çalışan proje bulunamadı: $src" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
  Write-Host "GitHub repo bulunamadı: $repo" -ForegroundColor Red
  exit 1
}

Set-Location $repo

Write-Host ""
Write-Host "GitHub repository güncelleniyor..." -ForegroundColor Cyan

git pull --ff-only

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "git pull başarısız oldu. Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

$gitPaths = New-Object System.Collections.Generic.List[string]

Write-Host ""
Write-Host "TypeScript düzeltmesi aktarılıyor..." -ForegroundColor Cyan

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
  Write-Host "Kopyalandı: $file" -ForegroundColor Green
}

Write-Host ""
Write-Host "Temiz production build başlatılıyor..." -ForegroundColor Cyan

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
  Write-Host "PRISMA GENERATE HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

npm.cmd run build

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "BUILD HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Build başarılı ✅" -ForegroundColor Green

$uniqueGitPaths = $gitPaths | Sort-Object -Unique

foreach ($path in $uniqueGitPaths) {
  git add -- $path

  if ($LASTEXITCODE -ne 0) {
    Write-Host "Git add başarısız: $path" -ForegroundColor Red
    exit 1
  }
}

git diff --cached --check

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Stage edilen dosyada diff hatası bulundu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Gönderilecek değişiklik:" -ForegroundColor Cyan

git status --short
git -c core.pager=cat diff --cached --stat

git diff --cached --quiet

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Yeni değişiklik bulunamadı; dosya GitHub klasöründe zaten aynı." -ForegroundColor Yellow
  exit 0
}

git commit -m "Fix payment tracking result TypeScript type"

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Commit oluşturulamadı." -ForegroundColor Red
  exit 1
}

$branch = (git branch --show-current).Trim()

if (!$branch) {
  $branch = "main"
}

git push -u origin $branch

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Git push başarısız oldu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "ÖDEME TAKİP TYPESCRIPT DÜZELTMESİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Gönderilen dosya:" -ForegroundColor Cyan
Write-Host " - lib\server\payment-finalize.ts" -ForegroundColor Green
