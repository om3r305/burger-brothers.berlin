$ErrorActionPreference = "Stop"

$project = "C:\Web\burger"
$payload = $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Web\burger-backups\tv-pin-fix-$timestamp"

$files = @(
  "app\api\tv\login\route.ts",
  "tools\security-tests.mjs"
)

function Restore-ChangedFiles {
  param(
    [string]$ProjectPath,
    [string]$BackupPath,
    [string[]]$ChangedFiles
  )

  Write-Host "" 
  Write-Host "Hata oluştu. Değiştirilen dosyalar geri alınıyor..." -ForegroundColor Yellow

  foreach ($file in $ChangedFiles) {
    $backupFile = Join-Path $BackupPath $file
    $targetFile = Join-Path $ProjectPath $file
    $missingMarker = "$backupFile.__MISSING__"

    if (Test-Path -LiteralPath $backupFile) {
      New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
      Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
      Write-Host "Geri alındı: $file" -ForegroundColor Green
    }
    elseif (Test-Path -LiteralPath $missingMarker) {
      Remove-Item -LiteralPath $targetFile -Force -ErrorAction SilentlyContinue
      Write-Host "Yeni eklenen dosya kaldırıldı: $file" -ForegroundColor Green
    }
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

if (!(Test-Path -LiteralPath $project)) {
  Write-Host "Çalışan proje bulunamadı: $project" -ForegroundColor Red
  exit 1
}

foreach ($file in $files) {
  $payloadFile = Join-Path $payload $file

  if (!(Test-Path -LiteralPath $payloadFile)) {
    Write-Host "Teslimat dosyası eksik: $payloadFile" -ForegroundColor Red
    exit 1
  }
}

New-Item -ItemType Directory -Path $backup -Force | Out-Null

try {
  Write-Host ""
  Write-Host "TV PIN düzeltmesi için yedek alınıyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $sourceFile = Join-Path $project $file
    $backupFile = Join-Path $backup $file

    New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null

    if (Test-Path -LiteralPath $sourceFile) {
      Copy-Item -LiteralPath $sourceFile -Destination $backupFile -Force
      Write-Host "Yedeklendi: $file" -ForegroundColor Green
    }
    else {
      New-Item -ItemType File -Path "$backupFile.__MISSING__" -Force | Out-Null
      Write-Host "Yeni dosya olarak işaretlendi: $file" -ForegroundColor Yellow
    }
  }

  Write-Host ""
  Write-Host "TV PIN düzeltmesi uygulanıyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $payloadFile = Join-Path $payload $file
    $targetFile = Join-Path $project $file

    New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
    Copy-Item -LiteralPath $payloadFile -Destination $targetFile -Force

    Write-Host "Uygulandı: $file" -ForegroundColor Green
  }

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
  Write-Host "TV PIN DÜZELTMESİ BAŞARILI ✅" -ForegroundColor Green
  Write-Host "Yerel geliştirmede PIN: 19051905" -ForegroundColor Cyan
  Write-Host "Yedek: $backup" -ForegroundColor DarkCyan
  Write-Host ""
  Write-Host "Açık npm dev terminalini CTRL+C ile kapatıp npm.cmd run dev ile yeniden başlat." -ForegroundColor Yellow
}
catch {
  Restore-ChangedFiles -ProjectPath $project -BackupPath $backup -ChangedFiles $files

  Write-Host ""
  Write-Host "KURULUM BAŞARISIZ — Değişiklikler geri alındı." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
