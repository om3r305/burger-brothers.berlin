$ErrorActionPreference = "Stop"

$project = "C:\Web\burger"
$payload = $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Web\burger-backups\tv-login-localhost-fix-$timestamp"

$files = @(
  "app\api\tv\login\route.ts",
  "lib\server\tv-pin-policy.ts",
  "tools\security-tests.mjs",
  "tools\session-security-tests.cjs",
  "tools\tv-login-route-tests.cjs",
  "package.json"
)

$envLocal = Join-Path $project ".env.local"
$envBackup = Join-Path $backup "local-secret-backup\.env.local"
$envMissingMarker = "$envBackup.__MISSING__"

function Restore-ChangedFiles {
  param(
    [string]$ProjectPath,
    [string]$BackupPath,
    [string[]]$ChangedFiles
  )

  Write-Host ""
  Write-Host "Hata oluştu. Kod dosyaları geri alınıyor..." -ForegroundColor Yellow

  foreach ($file in $ChangedFiles) {
    $backupFile = Join-Path $BackupPath $file
    $targetFile = Join-Path $ProjectPath $file
    $missingMarker = "$backupFile.__MISSING__"

    if (Test-Path -LiteralPath $backupFile -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
      Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
      Write-Host "Geri alındı: $file" -ForegroundColor Green
    }
    elseif (Test-Path -LiteralPath $missingMarker -PathType Leaf) {
      Remove-Item -LiteralPath $targetFile -Force -ErrorAction SilentlyContinue
      Write-Host "Yeni eklenen dosya kaldırıldı: $file" -ForegroundColor Green
    }
  }
}

function Restore-LocalEnv {
  if (Test-Path -LiteralPath $envBackup -PathType Leaf) {
    Copy-Item -LiteralPath $envBackup -Destination $envLocal -Force
    Write-Host ".env.local geri alındı." -ForegroundColor Green
  }
  elseif (Test-Path -LiteralPath $envMissingMarker -PathType Leaf) {
    Remove-Item -LiteralPath $envLocal -Force -ErrorAction SilentlyContinue
    Write-Host "Kurulumun oluşturduğu .env.local kaldırıldı." -ForegroundColor Green
  }
}

function Run-Step {
  param(
    [string]$Title,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host $Title -ForegroundColor Cyan
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "$Title başarısız oldu. Hata kodu: $LASTEXITCODE"
  }
}

function Read-EnvFileValue {
  param(
    [string]$Content,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Content)) {
    return ""
  }

  $pattern = "(?m)^\s*" + [regex]::Escape($Name) + "\s*=\s*(.*?)\s*$"
  $match = [regex]::Match($Content, $pattern)

  if (!$match.Success) {
    return ""
  }

  $value = $match.Groups[1].Value.Trim()

  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  return $value.Trim()
}

function New-SecureSessionSecret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

  try {
    $rng.GetBytes($bytes)
  }
  finally {
    $rng.Dispose()
  }

  return [Convert]::ToBase64String($bytes)
}

function Ensure-LocalSessionSecret {
  $existingContent = ""

  if (Test-Path -LiteralPath $envLocal -PathType Leaf) {
    $existingContent = Get-Content -LiteralPath $envLocal -Raw -Encoding UTF8
  }

  $fileSecret = Read-EnvFileValue -Content $existingContent -Name "SESSION_SECRET"
  $processSecret = [string]$env:SESSION_SECRET

  if (![string]::IsNullOrWhiteSpace($processSecret) -and $processSecret.Trim().Length -lt 32) {
    Write-Host ""
    Write-Host "UYARI: Mevcut PowerShell SESSION_SECRET değeri 32 karakterden kısa." -ForegroundColor Yellow
    Write-Host "Bu terminal kapatılmalı; kurulumdan sonra yeni PowerShell açılmalıdır." -ForegroundColor Yellow
  }

  if (![string]::IsNullOrWhiteSpace($fileSecret) -and $fileSecret.Length -ge 32) {
    Write-Host "Yerel SESSION_SECRET zaten güvenli uzunlukta; değiştirilmedi." -ForegroundColor Green
    return $false
  }

  $newSecret = New-SecureSessionSecret
  $line = "SESSION_SECRET=$newSecret"
  $pattern = "(?m)^\s*SESSION_SECRET\s*=.*$"

  if ([regex]::IsMatch($existingContent, $pattern)) {
    $regex = New-Object System.Text.RegularExpressions.Regex($pattern)
    $newContent = $regex.Replace($existingContent, $line, 1)
  }
  else {
    $separator = if ([string]::IsNullOrEmpty($existingContent) -or $existingContent.EndsWith("`n")) { "" } else { "`r`n" }
    $newContent = "$existingContent$separator$line`r`n"
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($envLocal, $newContent, $utf8NoBom)

  # Yalnızca bu kurulum sürecindeki build/test için de geçerli olsun.
  $env:SESSION_SECRET = $newSecret

  Write-Host "Güçlü yerel SESSION_SECRET .env.local içine eklendi/güncellendi." -ForegroundColor Green
  Write-Host "Secret değeri ekrana yazdırılmadı ve GitHub dosyalarına alınmadı." -ForegroundColor DarkGray

  return $true
}

if (!(Test-Path -LiteralPath $project -PathType Container)) {
  Write-Host "Çalışan proje bulunamadı: $project" -ForegroundColor Red
  exit 1
}

foreach ($file in $files) {
  $payloadFile = Join-Path $payload $file

  if (!(Test-Path -LiteralPath $payloadFile -PathType Leaf)) {
    Write-Host "Teslimat dosyası eksik: $payloadFile" -ForegroundColor Red
    exit 1
  }
}

New-Item -ItemType Directory -Path $backup -Force | Out-Null

try {
  Write-Host ""
  Write-Host "TV login düzeltmesi için yedek alınıyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $sourceFile = Join-Path $project $file
    $backupFile = Join-Path $backup $file

    New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null

    if (Test-Path -LiteralPath $sourceFile -PathType Leaf) {
      Copy-Item -LiteralPath $sourceFile -Destination $backupFile -Force
      Write-Host "Yedeklendi: $file" -ForegroundColor Green
    }
    else {
      New-Item -ItemType File -Path "$backupFile.__MISSING__" -Force | Out-Null
      Write-Host "Yeni dosya olarak işaretlendi: $file" -ForegroundColor Yellow
    }
  }

  New-Item -ItemType Directory -Path (Split-Path $envBackup) -Force | Out-Null

  if (Test-Path -LiteralPath $envLocal -PathType Leaf) {
    Copy-Item -LiteralPath $envLocal -Destination $envBackup -Force
    Write-Host "Yerel secret dosyası güvenli yedek klasörüne alındı." -ForegroundColor Green
  }
  else {
    New-Item -ItemType File -Path $envMissingMarker -Force | Out-Null
    Write-Host ".env.local yeni dosya olarak işaretlendi." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "TV login localhost düzeltmesi uygulanıyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $payloadFile = Join-Path $payload $file
    $targetFile = Join-Path $project $file

    New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
    Copy-Item -LiteralPath $payloadFile -Destination $targetFile -Force

    Write-Host "Uygulandı: $file" -ForegroundColor Green
  }

  Ensure-LocalSessionSecret | Out-Null

  Set-Location $project
  Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

  Run-Step "Otomatik güvenlik testleri çalıştırılıyor..." {
    npm.cmd run security:test
  }

  Run-Step "TypeScript kontrolü çalıştırılıyor..." {
    npm.cmd run typecheck
  }

  Run-Step "Production build çalıştırılıyor..." {
    npm.cmd run build
  }

  Write-Host ""
  Write-Host "TV LOGIN LOCALHOST DÜZELTMESİ BAŞARILI ✅" -ForegroundColor Green
  Write-Host "Localhost PIN: 19051905" -ForegroundColor Cyan
  Write-Host "Gerçek domain/Vercel fallback: KAPALI" -ForegroundColor Cyan
  Write-Host "Yedek: $backup" -ForegroundColor DarkCyan
  Write-Host ""
  Write-Host "Şimdi çalışan dev terminalini CTRL+C ile tamamen kapat." -ForegroundColor Yellow
  Write-Host "Yeni PowerShell açıp şu komutları çalıştır:" -ForegroundColor Yellow
  Write-Host 'cd "C:\Web\burger"' -ForegroundColor White
  Write-Host "npm.cmd run dev" -ForegroundColor White
}
catch {
  Restore-ChangedFiles -ProjectPath $project -BackupPath $backup -ChangedFiles $files
  Restore-LocalEnv

  Write-Host ""
  Write-Host "KURULUM BAŞARISIZ — Kod ve yerel env değişiklikleri geri alındı." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
