$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$requiredFiles = @(
  # Checkout ve ödeme başarı ekranı
  "app\checkout\page.tsx",
  "app\payment\return\page.tsx",

  # Online ve Getrennt zahlen ödeme akışları
  "app\api\payments\prepare\route.ts",
  "app\api\payments\share\route.ts",
  "app\api\payments\session\route.ts",

  # Ödeme sonrası sipariş takip bilgisi
  "lib\server\payment-finalize.ts",

  # Güncel ödeme güvenlik testi
  "tools\payment-closeout-tests.cjs"
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
Write-Host "Güncellenen ödeme ve takip dosyaları kontrol ediliyor..." -ForegroundColor Cyan

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
  Write-Host "Stage edilen dosyalarda diff hatası bulundu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Gönderilecek bütün değişiklikler:" -ForegroundColor Cyan

git status --short
git -c core.pager=cat diff --cached --stat

git diff --cached --quiet

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Yeni değişiklik bulunamadı; dosyalar GitHub klasöründe zaten aynı." -ForegroundColor Yellow
  exit 0
}

git commit -m "Fix saved payments across order modes and add direct tracking"

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
Write-Host "KAYITLI ÖDEME VE SİPARİŞ TAKİP GÜNCELLEMESİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Gönderilen dosyalar:" -ForegroundColor Cyan

foreach ($file in $requiredFiles) {
  Write-Host " - $file" -ForegroundColor Green
}
