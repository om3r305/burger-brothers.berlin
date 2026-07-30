$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$files = @(
  "app\tv\login\page.tsx"
)

if (!(Test-Path -LiteralPath $src -PathType Container)) {
  Write-Host "Çalışan proje bulunamadı: $src" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
  Write-Host "GitHub repo bulunamadı: $repo" -ForegroundColor Red
  Write-Host "Git init yapılmadı." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "TV login hata mesajı düzeltmesi GitHub klasörüne aktarılıyor..." -ForegroundColor Cyan

foreach ($file in $files) {
  $sourceFile = Join-Path $src $file
  $targetFile = Join-Path $repo $file

  if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    Write-Host "DOSYA BULUNAMADI: $sourceFile" -ForegroundColor Red
    exit 1
  }

  New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
  Write-Host "Kopyalandı: $file" -ForegroundColor Green
}

Set-Location $repo

# Önceden stage edilmiş başka dosyalar bu commit'e karışmasın.
# Çalışma dosyaları silinmez; yalnızca staging alanı temizlenir.
git reset
if ($LASTEXITCODE -ne 0) {
  Write-Host "Git staging alanı temizlenemedi." -ForegroundColor Red
  exit 1
}

Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue

npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "TYPECHECK HATALI — Commit ve push yapılmadı." -ForegroundColor Red
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

$gitFiles = $files | ForEach-Object { $_ -replace "\\", "/" }
git add -- $gitFiles

Write-Host ""
Write-Host "Gönderilecek değişiklikler:" -ForegroundColor Cyan
git status --short
git diff --cached --stat

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Yeni kod değişikliği bulunamadı." -ForegroundColor Yellow
  exit 0
}

git commit -m "Fix TV login session error message"
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
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
  Write-Host ""
  Write-Host "Git push başarısız oldu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "TV LOGIN HATA MESAJI GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Not: SESSION_SECRET .env.local içinde kalır ve GitHub'a gönderilmez." -ForegroundColor Yellow
