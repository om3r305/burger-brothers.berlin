#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ProjectRoot = "C:\Web\burger",
  [string]$GitRoot = "C:\Web\burger-github"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Files = @(
  "app/admin/showcase/page.tsx"
  "app/api/admin/showcase/route.ts"
  "components/showcase/ShowcaseStage.tsx"
  "components/showcase/ShowcaseStage.module.css"
  "components/showcase/ShowcasePlayer.tsx"
  "components/showcase/ShowcaseErrorBoundary.tsx"
  "lib/showcase/config.ts"
  "lib/showcase/types.ts"
  "tools/showcase-final-hardening-regression-tests.cjs"
)

function Step([string]$Text) {
  Write-Host ""
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Run([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$File basarisiz oldu. ExitCode=$($process.ExitCode)"
  }
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
  throw "Proje klasoru bulunamadi: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $GitRoot -PathType Container)) {
  throw "GitHub klasoru bulunamadi: $GitRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $GitRoot ".git") -PathType Container)) {
  throw "GitHub klasorunde .git bulunamadi. git init KULLANILMADI."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $ProjectRoot "_delivery-backups\showcase-final-hardening-$stamp"

Step "Degisen mevcut dosyalar yedekleniyor"
foreach ($relative in $Files) {
  $source = Join-Path $ProjectRoot $relative
  if (Test-Path -LiteralPath $source -PathType Leaf) {
    $target = Join-Path $backup $relative
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
}

Step "Regression testleri"
Run "node.exe" @("tools/showcase-final-hardening-regression-tests.cjs") $ProjectRoot

Step "Temiz production build"
$nextDir = Join-Path $ProjectRoot ".next"
if (Test-Path -LiteralPath $nextDir) {
  Remove-Item -LiteralPath $nextDir -Recurse -Force
}
Run "npm.cmd" @("run","build") $ProjectRoot

Step "Yalniz bu teslimattaki dosyalar GitHub klasorune kopyalaniyor"
foreach ($relative in $Files) {
  $source = Join-Path $ProjectRoot $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Teslimat dosyasi bulunamadi: $source"
  }
  $target = Join-Path $GitRoot $relative
  New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

Step "Git durumu kontrol ediliyor"
Run "git.exe" @("checkout","main") $GitRoot
Run "git.exe" @("pull","--ff-only","origin","main") $GitRoot

foreach ($relative in $Files) {
  Run "git.exe" @("add","--",$relative.Replace("\","/")) $GitRoot
}

$changes = & git.exe -C $GitRoot diff --cached --name-only
if (-not $changes) {
  Write-Host "GitHub tarafinda yeni degisiklik yok. Build ve test basarili." -ForegroundColor Yellow
  exit 0
}

Step "Commit ve push"
Run "git.exe" @("commit","-m","Harden multi-screen showcase and special-day scenes") $GitRoot
Run "git.exe" @("push","origin","main") $GitRoot

Write-Host ""
Write-Host "TAMAMLANDI KANKAM :)" -ForegroundColor Green
Write-Host "Backup: $backup" -ForegroundColor Yellow
Write-Host "Build, test, commit ve push basarili." -ForegroundColor Green
