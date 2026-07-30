$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$files = @(
  "app\api\tv\login\route.ts",
  "tools\security-tests.mjs"
)

if (!(Test-Path -LiteralPath $src)) {
  Write-Host "Çalışan proje bulunamadı: $src" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git"))) {
  Write-Host "GitHub repo bulunamadı: $repo" -ForegroundColor Red
  Write-Host "Git init yapılmadı." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "TV PIN düzeltmesi GitHub klasörüne aktarılıyor..." -ForegroundColor Cyan

foreach ($file in $files) {
  $sourceFile = Join-Path $src $file
  $targetFile = Join-Path $repo $file

  if (!(Test-Path -LiteralPath $sourceFile)) {
    Write-Host "DOSYA BULUNAMADI: $sourceFile" -ForegroundColor Red
    exit 1
  }

  New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force

  Write-Host "Kopyalandı: $file" -ForegroundColor Green
}

Set-Location $repo

# Gizli dosyalar hiçbir zaman stage edilmez.
$forbiddenTracked = git ls-files -- ".env" ".env.*" "*.pem" "*.key" "*.p12" "*.pfx" "*.db" "*.sqlite" "*.sqlite3" "print-agent/config.json" "print-proxy/config.json"

if ($forbiddenTracked) {
  Write-Host ""
  Write-Host "Git deposunda takip edilen gizli dosya tespit edildi. Push durduruldu:" -ForegroundColor Red
  $forbiddenTracked | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

npm.cmd run security:test
if ($LASTEXITCODE -ne 0) {
  Write-Host "GÜVENLİK TESTİ HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) {
  Write-Host "TYPECHECK HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

npm.cmd run build
if ($LASTEXITCODE -ne 0) {
  Write-Host "BUILD HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Build ve güvenlik kontrolleri başarılı ✅" -ForegroundColor Green

$gitFiles = $files | ForEach-Object {
  $_ -replace "\\", "/"
}

git add -- $gitFiles

Write-Host ""
Write-Host "Gönderilecek değişiklikler:" -ForegroundColor Cyan

git status --short
git diff --cached --stat

git diff --cached --quiet

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Yeni değişiklik bulunamadı." -ForegroundColor Yellow
  exit 0
}

git commit -m "Fix local TV PIN resolution without weakening production auth"

if ($LASTEXITCODE -ne 0) {
  Write-Host "Commit oluşturulamadı." -ForegroundColor Red
  exit 1
}

$branch = (git branch --show-current).Trim()

if (!$branch) {
  Write-Host "Aktif Git branch bulunamadı." -ForegroundColor Red
  exit 1
}

git push -u origin $branch

if ($LASTEXITCODE -ne 0) {
  Write-Host "Git push başarısız oldu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "TV PIN DÜZELTMESİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
Write-Host "Branch: $branch" -ForegroundColor Cyan
