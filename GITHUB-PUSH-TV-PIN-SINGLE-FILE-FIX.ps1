$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$files = @(
  "app\api\tv\login\route.ts"
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

$backupRoot = Join-Path $env:TEMP ("burger-github-tv-pin-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

try {
  foreach ($file in $files) {
    $sourceFile = Join-Path $src $file
    $targetFile = Join-Path $repo $file
    $backupFile = Join-Path $backupRoot $file

    if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
      throw "DOSYA BULUNAMADI: $sourceFile"
    }

    if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null
      Copy-Item -LiteralPath $targetFile -Destination $backupFile -Force
    }

    New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force

    Write-Host "Kopyalandı: $file" -ForegroundColor Green
  }

  Set-Location $repo
  Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "Temiz production build çalıştırılıyor..." -ForegroundColor Cyan
  npm.cmd run build

  if ($LASTEXITCODE -ne 0) {
    throw "BUILD_FAILED"
  }

  Write-Host "Build başarılı ✅" -ForegroundColor Green

  $gitFiles = $files | ForEach-Object { $_ -replace "\\", "/" }
  git add -- $gitFiles

  Write-Host ""
  Write-Host "Gönderilecek değişiklikler:" -ForegroundColor Cyan
  git status --short -- $gitFiles
  git diff --cached --stat -- $gitFiles

  git diff --cached --quiet -- $gitFiles

  if ($LASTEXITCODE -eq 0) {
    Write-Host "Yeni değişiklik bulunamadı." -ForegroundColor Yellow
    exit 0
  }

  git commit -m "Fix localhost TV PIN login"

  if ($LASTEXITCODE -ne 0) {
    throw "COMMIT_FAILED"
  }

  $branch = (git branch --show-current).Trim()

  if (!$branch) {
    $branch = "main"
  }

  git push -u origin $branch

  if ($LASTEXITCODE -ne 0) {
    throw "PUSH_FAILED"
  }

  Write-Host ""
  Write-Host "TV PIN DÜZELTMESİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
  Write-Host "Branch: $branch" -ForegroundColor Cyan
}
catch {
  Write-Host ""
  Write-Host "İşlem başarısız. GitHub çalışma dosyası geri yükleniyor..." -ForegroundColor Red

  foreach ($file in $files) {
    $targetFile = Join-Path $repo $file
    $backupFile = Join-Path $backupRoot $file

    if (Test-Path -LiteralPath $backupFile -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
      Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
    }
  }

  Set-Location $repo
  git reset -- $files 2>$null
  Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host "Hata: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Commit veya push tamamlanmadı." -ForegroundColor Yellow
  exit 1
}
finally {
  Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
}
