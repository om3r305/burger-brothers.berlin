$ErrorActionPreference = "Stop"

$project = "C:\Web\burger"
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$relativeFile = "app\api\tv\login\route.ts"
$sourceFile = Join-Path $packageRoot ("files\" + $relativeFile)
$targetFile = Join-Path $project $relativeFile
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = "C:\Web\burger-security-backups\tv-pin-single-file-$timestamp"
$backupFile = Join-Path $backupRoot $relativeFile

if (!(Test-Path -LiteralPath $project -PathType Container)) {
  Write-Host "Çalışan proje bulunamadı: $project" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
  Write-Host "Paket dosyası bulunamadı: $sourceFile" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath $targetFile -PathType Leaf)) {
  Write-Host "Mevcut TV login route bulunamadı: $targetFile" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null
Copy-Item -LiteralPath $targetFile -Destination $backupFile -Force

Write-Host "Yedek alındı: $backupFile" -ForegroundColor Cyan

try {
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
  Write-Host "Güncellendi: $relativeFile" -ForegroundColor Green

  Set-Location $project
  Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host "" 
  Write-Host "Temiz production build çalıştırılıyor..." -ForegroundColor Cyan
  npm.cmd run build

  if ($LASTEXITCODE -ne 0) {
    throw "BUILD_FAILED"
  }

  Write-Host ""
  Write-Host "TV PIN TEK DOSYA DÜZELTMESİ KURULDU ✅" -ForegroundColor Green
  Write-Host "Şimdi çalışan dev server'ı Ctrl+C ile kapatıp yeniden başlat." -ForegroundColor Yellow
  Write-Host "PIN: 19051905" -ForegroundColor Cyan
}
catch {
  Write-Host ""
  Write-Host "Kurulum veya build başarısız. Eski dosya geri yükleniyor..." -ForegroundColor Red

  Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
  Remove-Item -LiteralPath (Join-Path $project ".next") -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host "Eski dosya geri yüklendi." -ForegroundColor Yellow
  Write-Host "Hata: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
