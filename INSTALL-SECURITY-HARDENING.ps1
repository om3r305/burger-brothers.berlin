$ErrorActionPreference = "Stop"

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = "C:\Web\burger"
$backupRoot = "C:\Web\burger-security-backups"
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

function Test-SecretPresent {
  if ($env:SESSION_SECRET -and $env:SESSION_SECRET.Trim().Length -ge 32) {
    return $true
  }

  foreach ($name in @(".env.local", ".env")) {
    $path = Join-Path $project $name
    if (!(Test-Path -LiteralPath $path)) { continue }

    $match = Select-String `
      -LiteralPath $path `
      -Pattern '^\s*(SESSION_SECRET|AUTH_SECRET)\s*=\s*(.+)\s*$' `
      -ErrorAction SilentlyContinue |
      Select-Object -First 1

    if ($match -and $match.Matches.Count -gt 0) {
      $value = $match.Matches[0].Groups[2].Value.Trim().Trim('"').Trim("'")
      if ($value.Length -ge 32) { return $true }
    }
  }

  return $false
}

function Restore-ProjectFiles {
  param(
    [hashtable]$ExistingBefore,
    [bool]$EnvLocalExisted
  )

  Write-Host ""
  Write-Host "Hata oluştu. Değiştirilen dosyalar geri yükleniyor..." -ForegroundColor Yellow

  foreach ($file in $files) {
    $target = Join-Path $project $file
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

  $envLocal = Join-Path $project ".env.local"
  $envBackup = Join-Path $backup "__local\.env.local"

  if ($EnvLocalExisted) {
    if (Test-Path -LiteralPath $envBackup) {
      Copy-Item -LiteralPath $envBackup -Destination $envLocal -Force
    }
  }
  else {
    Remove-Item -LiteralPath $envLocal -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath (Join-Path $project ".next") -Recurse -Force -ErrorAction SilentlyContinue
}

if (!(Test-Path -LiteralPath $project)) {
  Write-Host "Çalışan proje bulunamadı: $project" -ForegroundColor Red
  exit 1
}

foreach ($file in $files) {
  $source = Join-Path $packageRoot $file
  if (!(Test-Path -LiteralPath $source)) {
    Write-Host "Teslimat dosyası eksik: $source" -ForegroundColor Red
    exit 1
  }
}

$forbiddenPackageFiles = Get-ChildItem -LiteralPath $packageRoot -Recurse -Force -File |
  Where-Object {
    $_.Name -match '^\.env($|\.)' -or
    $_.Extension -match '^\.(pem|key|p12|pfx|db|sqlite|sqlite3)$'
  }

if ($forbiddenPackageFiles) {
  Write-Host "Teslimat içinde yasaklı gizli dosya bulundu:" -ForegroundColor Red
  $forbiddenPackageFiles.FullName | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

New-Item -ItemType Directory -Path $backup -Force | Out-Null
$existingBefore = @{}

$envLocal = Join-Path $project ".env.local"
$envLocalExisted = Test-Path -LiteralPath $envLocal
if ($envLocalExisted) {
  $envBackup = Join-Path $backup "__local\.env.local"
  New-Item -ItemType Directory -Path (Split-Path $envBackup) -Force | Out-Null
  Copy-Item -LiteralPath $envLocal -Destination $envBackup -Force
}

try {
  Write-Host ""
  Write-Host "Burger Brothers güvenlik sertleştirmesi uygulanıyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $source = Join-Path $packageRoot $file
    $target = Join-Path $project $file
    $existingBefore[$file] = Test-Path -LiteralPath $target

    if ($existingBefore[$file]) {
      $saved = Join-Path $backup $file
      New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $saved -Force
    }

    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Kopyalandı: $file" -ForegroundColor Green
  }

  if (!(Test-SecretPresent)) {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $secret = [Convert]::ToBase64String($bytes)

    Add-Content `
      -LiteralPath $envLocal `
      -Value "`r`n# Signed admin / TV / driver sessions`r`nSESSION_SECRET=$secret`r`n"

    $env:SESSION_SECRET = $secret

    Write-Host ""
    Write-Host "Yeni SESSION_SECRET .env.local dosyasına eklendi." -ForegroundColor Green
    Write-Host "Aynı isimle Vercel Environment Variables bölümüne de güvenli bir değer eklemelisin." -ForegroundColor Yellow
  }

  Set-Location $project
  Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

  Invoke-NpmStep -Title "1/4 Bağımlılıklar temiz kuruluyor..." -Arguments @("ci")
  Invoke-NpmStep -Title "2/4 Otomatik güvenlik testleri çalışıyor..." -Arguments @("run", "security:test")
  Invoke-NpmStep -Title "3/4 TypeScript kontrolü çalışıyor..." -Arguments @("run", "typecheck")
  Invoke-NpmStep -Title "4/4 Production build çalışıyor..." -Arguments @("run", "build")

  Write-Host ""
  Write-Host "GÜVENLİK SERTLEŞTİRMESİ BAŞARIYLA KURULDU ✅" -ForegroundColor Green
  Write-Host "Proje: $project" -ForegroundColor Cyan
  Write-Host "Yedek: $backup" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Şimdi bu teslimat klasöründeki GITHUB-PUSH-SECURITY-HARDENING.ps1 dosyasını çalıştırabilirsin." -ForegroundColor Yellow
}
catch {
  Restore-ProjectFiles -ExistingBefore $existingBefore -EnvLocalExisted $envLocalExisted
  Write-Host ""
  Write-Host "KURULUM BAŞARISIZ — Proje dosyaları yedekten geri alındı." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Yedek: $backup" -ForegroundColor Yellow
  exit 1
}
