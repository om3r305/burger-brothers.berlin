$ErrorActionPreference = "Stop"

$SourceRoot = $PSScriptRoot
$TargetRoot = "C:\Web\burger"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $TargetRoot ".menu-image-standard-backups\$Timestamp"

$Files = @(
    "app\menu\page.tsx",
    "components\menu\ProductCard.tsx"
)

if (-not (Test-Path (Join-Path $TargetRoot "package.json"))) {
    throw "Burger Brothers projesi bulunamadı: $TargetRoot"
}

foreach ($RelativePath in $Files) {
    $Source = Join-Path $SourceRoot $RelativePath
    if (-not (Test-Path $Source)) {
        throw "Teslimat dosyası eksik: $Source"
    }
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

Write-Host "Mevcut dosyalar yedekleniyor..." -ForegroundColor Cyan
foreach ($RelativePath in $Files) {
    $Current = Join-Path $TargetRoot $RelativePath
    $Backup = Join-Path $BackupRoot $RelativePath
    $BackupParent = Split-Path $Backup -Parent
    New-Item -ItemType Directory -Path $BackupParent -Force | Out-Null

    if (Test-Path $Current) {
        Copy-Item $Current $Backup -Force
    }
}

try {
    Write-Host "Yalnızca menü görsel dosyaları uygulanıyor..." -ForegroundColor Cyan

    foreach ($RelativePath in $Files) {
        $Source = Join-Path $SourceRoot $RelativePath
        $Destination = Join-Path $TargetRoot $RelativePath
        $DestinationParent = Split-Path $Destination -Parent
        New-Item -ItemType Directory -Path $DestinationParent -Force | Out-Null
        Copy-Item $Source $Destination -Force
        Write-Host "Güncellendi: $RelativePath" -ForegroundColor Green
    }

    Push-Location $TargetRoot
    try {
        if (Test-Path ".next") {
            Remove-Item ".next" -Recurse -Force
        }

        Write-Host "TypeScript kontrolü çalışıyor..." -ForegroundColor Cyan
        & npm.cmd run typecheck
        if ($LASTEXITCODE -ne 0) {
            throw "TypeScript kontrolü başarısız oldu."
        }

        Write-Host "Temiz production build çalışıyor..." -ForegroundColor Cyan
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            throw "Production build başarısız oldu."
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "Menü görsel standardı başarıyla uygulandı." -ForegroundColor Green
    Write-Host "Yedek: $BackupRoot" -ForegroundColor Yellow
}
catch {
    Write-Host "Hata oluştu; eski dosyalar geri yükleniyor..." -ForegroundColor Red

    foreach ($RelativePath in $Files) {
        $Backup = Join-Path $BackupRoot $RelativePath
        $Destination = Join-Path $TargetRoot $RelativePath
        if (Test-Path $Backup) {
            Copy-Item $Backup $Destination -Force
        }
    }

    throw
}
