$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$repoBackup = Join-Path $env:TEMP "burger-tv-login-github-$timestamp"

$files = @(
  "app\api\tv\login\route.ts",
  "lib\server\tv-pin-policy.ts",
  "tools\security-tests.mjs",
  "tools\session-security-tests.cjs",
  "tools\tv-login-route-tests.cjs",
  "package.json"
)

function Restore-RepoFiles {
  Write-Host ""
  Write-Host "GitHub çalışma klasörü geri alınıyor..." -ForegroundColor Yellow

  Set-Location $repo

  $gitFiles = $files | ForEach-Object { $_ -replace "\\", "/" }
  git reset -- $gitFiles 2>$null | Out-Null

  foreach ($file in $files) {
    $backupFile = Join-Path $repoBackup $file
    $targetFile = Join-Path $repo $file
    $missingMarker = "$backupFile.__MISSING__"

    if (Test-Path -LiteralPath $backupFile -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
      Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
      Write-Host "Geri alındı: $file" -ForegroundColor Green
    }
    elseif (Test-Path -LiteralPath $missingMarker -PathType Leaf) {
      Remove-Item -LiteralPath $targetFile -Force -ErrorAction SilentlyContinue
      Write-Host "Yeni dosya kaldırıldı: $file" -ForegroundColor Green
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

if (!(Test-Path -LiteralPath $src -PathType Container)) {
  Write-Host "Çalışan proje bulunamadı: $src" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
  Write-Host "GitHub repo bulunamadı: $repo" -ForegroundColor Red
  Write-Host "Git init yapılmadı." -ForegroundColor Yellow
  exit 1
}

foreach ($file in $files) {
  $sourceFile = Join-Path $src $file

  if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    Write-Host "DOSYA BULUNAMADI: $sourceFile" -ForegroundColor Red
    exit 1
  }
}

New-Item -ItemType Directory -Path $repoBackup -Force | Out-Null

try {
  Write-Host ""
  Write-Host "GitHub çalışma klasöründeki hedef dosyalar yedekleniyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $repoFile = Join-Path $repo $file
    $backupFile = Join-Path $repoBackup $file

    New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null

    if (Test-Path -LiteralPath $repoFile -PathType Leaf) {
      Copy-Item -LiteralPath $repoFile -Destination $backupFile -Force
      Write-Host "Yedeklendi: $file" -ForegroundColor Green
    }
    else {
      New-Item -ItemType File -Path "$backupFile.__MISSING__" -Force | Out-Null
      Write-Host "Yeni repo dosyası olarak işaretlendi: $file" -ForegroundColor Yellow
    }
  }

  Write-Host ""
  Write-Host "TV login localhost düzeltmesi GitHub klasörüne aktarılıyor..." -ForegroundColor Cyan

  foreach ($file in $files) {
    $sourceFile = Join-Path $src $file
    $targetFile = Join-Path $repo $file

    New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force

    Write-Host "Kopyalandı: $file" -ForegroundColor Green
  }

  Set-Location $repo

  $forbiddenTracked = git ls-files -- ".env" ".env.*" "*.pem" "*.key" "*.p12" "*.pfx" "*.db" "*.sqlite" "*.sqlite3" "print-agent/config.json" "print-proxy/config.json"

  if ($LASTEXITCODE -ne 0) {
    throw "Git takip kontrolü çalıştırılamadı."
  }

  if ($forbiddenTracked) {
    Write-Host ""
    Write-Host "Git deposunda takip edilen gizli dosya tespit edildi:" -ForegroundColor Red
    $forbiddenTracked | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "Gizli dosya güvenlik kontrolü başarısız."
  }

  Remove-Item -LiteralPath ".next" -Recurse -Force -ErrorAction SilentlyContinue

  Run-Step "Otomatik güvenlik testleri çalıştırılıyor..." {
    npm.cmd run security:test
  }

  Run-Step "TypeScript kontrolü çalıştırılıyor..." {
    npm.cmd run typecheck
  }

  Run-Step "Temiz production build çalıştırılıyor..." {
    npm.cmd run build
  }

  $gitFiles = $files | ForEach-Object { $_ -replace "\\", "/" }

  git add -- $gitFiles

  if ($LASTEXITCODE -ne 0) {
    throw "Dosyalar git stage alanına eklenemedi."
  }

  $stagedForbidden = git diff --cached --name-only | Where-Object {
    $_ -match "(?i)(^|/)\.env($|\.)" -or
    $_ -match "(?i)\.(pem|key|p12|pfx|db|sqlite|sqlite3)$" -or
    $_ -match "(?i)(print-agent|print-proxy)/config\.json$"
  }

  if ($stagedForbidden) {
    Write-Host ""
    Write-Host "Stage alanında gizli/yasak dosya tespit edildi:" -ForegroundColor Red
    $stagedForbidden | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "Stage güvenlik kontrolü başarısız."
  }

  Write-Host ""
  Write-Host "Gönderilecek değişiklikler:" -ForegroundColor Cyan
  git status --short
  git diff --cached --stat

  git diff --cached --quiet

  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Yeni değişiklik bulunamadı." -ForegroundColor Yellow
    Remove-Item -LiteralPath $repoBackup -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }

  git commit -m "Fix secure TV PIN login on localhost production runtime"

  if ($LASTEXITCODE -ne 0) {
    throw "Commit oluşturulamadı."
  }

  $branch = (git branch --show-current).Trim()

  if (!$branch) {
    throw "Aktif Git branch bulunamadı."
  }

  git push -u origin $branch

  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Commit oluşturuldu fakat Git push başarısız oldu." -ForegroundColor Red
    Write-Host "Commit yerel repoda korundu; kod dosyaları geri alınmadı." -ForegroundColor Yellow
    exit 1
  }

  Remove-Item -LiteralPath $repoBackup -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "TV LOGIN LOCALHOST DÜZELTMESİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
  Write-Host "Branch: $branch" -ForegroundColor Cyan
}
catch {
  Restore-RepoFiles

  Write-Host ""
  Write-Host "BUILD/TEST/COMMIT ÖNCESİ HATA — Commit ve push yapılmadı." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
