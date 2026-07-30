$ErrorActionPreference = "Stop"

$project = "C:\Web\burger"
$package = Split-Path -Parent $MyInvocation.MyCommand.Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Web\burger-saved-payment-backup-$timestamp"

$files = @(
  "app\checkout\page.tsx",
  "app\api\payments\prepare\route.ts",
  "app\api\payments\profile\route.ts",
  "lib\server\payment-checkout.ts"
)

if (!(Test-Path -LiteralPath $project -PathType Container)) {
  throw "Proje bulunamadi: $project"
}

New-Item -ItemType Directory -Path $backup -Force | Out-Null

foreach ($file in $files) {
  $sourceFile = Join-Path $package $file
  $targetFile = Join-Path $project $file
  $backupFile = Join-Path $backup $file

  if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Paket dosyasi eksik: $sourceFile"
  }

  if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
    Copy-Item -LiteralPath $targetFile -Destination $backupFile -Force
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force

  Write-Host "Kopyalandi: $file" -ForegroundColor Green
}

Set-Location $project
Remove-Item ".next" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "tsconfig.tsbuildinfo" -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Prisma Client uretiliyor..." -ForegroundColor Cyan
& cmd.exe /d /s /c "npx.cmd prisma generate"
if ($LASTEXITCODE -ne 0) {
  throw "Prisma generate basarisiz oldu."
}

Write-Host ""
Write-Host "Verify calisiyor..." -ForegroundColor Cyan
& cmd.exe /d /s /c "npm.cmd run verify"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Verify basarisiz. Yedek klasoru: $backup" -ForegroundColor Red
  throw "npm run verify basarisiz oldu."
}

Write-Host ""
Write-Host "KURULUM VE VERIFY TAMAMLANDI" -ForegroundColor Green
Write-Host "Yedek: $backup" -ForegroundColor Cyan
