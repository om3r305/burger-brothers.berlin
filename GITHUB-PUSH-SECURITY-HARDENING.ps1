$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$backupRoot = "C:\Web\burger-github-security-backups"
$backup = Join-Path $backupRoot ("complete-security-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

$files = @(
  ".gitignore",
  "middleware.ts",
  "package.json",
  "package-lock.json",
  "app\api\admin\login\route.ts",
  "app\api\tv\login\route.ts",
  "app\api\drivers\route.ts",
  "app\api\settings\route.ts",
  "app\api\payments\prepare\route.ts",
  "app\driver\page.tsx",
  "app\tv\(protected)\layout.tsx",
  "lib\server\session.ts",
  "lib\server\order-pricing.ts",
  "tools\security-tests.mjs",
  "tools\session-security-tests.cjs",
  "tools\driver-security-tests.cjs",
  "tools\order-pricing-tests.cjs"
)

function Invoke-NpmStep {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  Write-Host ""
  Write-Host $Title -ForegroundColor Cyan
  & npm.cmd @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "$Title başarısız oldu. Hata kodu: $LASTEXITCODE"
  }
}

function Restore-RepoFiles {
  param([hashtable]$ExistingBefore)

  Write-Host ""
  Write-Host "GitHub klasöründeki kopyalar geri yükleniyor..." -ForegroundColor Yellow

  foreach ($file in $files) {
    $target = Join-Path $repo $file
    $saved = Join-Path $backup $file

    if ($ExistingBefore[$file] -eq $true) {
      if (Test-Path -LiteralPath $saved) {
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item -LiteralPath $saved -Destination $target -Force
      }
    }
    else {
      Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    }
  }

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
}

if (!(Test-Path -LiteralPath $src)) {
  Write-Host "Çalışan proje bulunamadı: $src" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git"))) {
  Write-Host "GitHub repo bulunamadı: $repo" -ForegroundColor Red
  Write-Host "Git init yapılmadı." -ForegroundColor Yellow
  exit 1
}

foreach ($file in $files) {
  $sourceFile = Join-Path $src $file
  if (!(Test-Path -LiteralPath $sourceFile)) {
    Write-Host "DOSYA BULUNAMADI: $sourceFile" -ForegroundColor Red
    exit 1
  }
}

$unsafeSource = @()
foreach ($file in $files) {
  $sourceFile = Join-Path $src $file
  $content = Get-Content -LiteralPath $sourceFile -Raw -ErrorAction Stop

  if (
    $content -match '-----BEGIN [A-Z ]*PRIVATE KEY-----' -or
    $content -match '\bsk_live_[A-Za-z0-9]{16,}\b' -or
    $content -match '\b\d{8,10}:[A-Za-z0-9_-]{30,}\b'
  ) {
    $unsafeSource += $file
  }
}

if ($unsafeSource.Count -gt 0) {
  Write-Host "Kaynak kod içinde muhtemel gerçek secret/private key bulundu:" -ForegroundColor Red
  $unsafeSource | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

New-Item -ItemType Directory -Path $backup -Force | Out-Null
$existingBefore = @{}

try {
  Write-Host ""
  Write-Host "Güvenlik dosyaları GitHub klasörüne aktarılıyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $sourceFile = Join-Path $src $file
    $targetFile = Join-Path $repo $file
    $existingBefore[$file] = Test-Path -LiteralPath $targetFile

    if ($existingBefore[$file]) {
      $saved = Join-Path $backup $file
      New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
      Copy-Item -LiteralPath $targetFile -Destination $saved -Force
    }

    New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
    Write-Host "Kopyalandı: $file" -ForegroundColor Green
  }

  Set-Location $repo
  Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

  Invoke-NpmStep -Title "1/4 Bağımlılıklar temiz kuruluyor..." -Arguments @("ci")
  Invoke-NpmStep -Title "2/4 Otomatik güvenlik testleri çalışıyor..." -Arguments @("run", "security:test")
  Invoke-NpmStep -Title "3/4 TypeScript kontrolü çalışıyor..." -Arguments @("run", "typecheck")
  Invoke-NpmStep -Title "4/4 Production build çalışıyor..." -Arguments @("run", "build")

  $trackedFiles = git ls-files
  if ($LASTEXITCODE -ne 0) { throw "git ls-files çalıştırılamadı." }

  $forbiddenTracked = $trackedFiles | Where-Object {
    $path = ($_ -replace '\\', '/').ToLowerInvariant()

    if ($path -eq ".env.example") { return $false }

    return (
      $path -match '(^|/)\.env($|\.)' -or
      $path -match '\.(pem|key|p12|pfx|db|sqlite|sqlite3)$' -or
      $path -eq 'print-agent/config.json' -or
      $path -eq 'print-proxy/config.json'
    )
  }

  if ($forbiddenTracked) {
    throw "Git tarafından izlenen gizli dosya bulundu:`n$($forbiddenTracked -join "`n")"
  }

  $gitFiles = $files | ForEach-Object { $_ -replace '\\', '/' }
  git add -- $gitFiles
  if ($LASTEXITCODE -ne 0) { throw "git add başarısız oldu." }

  Write-Host ""
  Write-Host "Gönderilecek güvenlik değişiklikleri:" -ForegroundColor Cyan
  git status --short
  git diff --cached --stat

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Yeni değişiklik bulunamadı." -ForegroundColor Yellow
    exit 0
  }

  git commit -m "security: complete auth hardening and DB-based Stripe pricing"
  if ($LASTEXITCODE -ne 0) { throw "Commit oluşturulamadı." }

  $branch = (git branch --show-current).Trim()
  if (!$branch) { throw "Aktif Git branch bulunamadı." }

  git push -u origin $branch
  if ($LASTEXITCODE -ne 0) { throw "Git push başarısız oldu." }

  Write-Host ""
  Write-Host "TÜM GÜVENLİK DEĞİŞİKLİKLERİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
  Write-Host "Branch: $branch" -ForegroundColor Cyan
  Write-Host "Commit: security: complete auth hardening and DB-based Stripe pricing" -ForegroundColor Cyan
}
catch {
  Restore-RepoFiles -ExistingBefore $existingBefore
  Write-Host ""
  Write-Host "BUILD/TEST HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "GitHub klasörü yedekten geri alındı: $backup" -ForegroundColor Yellow
  exit 1
}
