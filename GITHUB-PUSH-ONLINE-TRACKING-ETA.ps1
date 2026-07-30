$ErrorActionPreference = "Stop"

# Türkçe karakterlerin terminalde bozulmaması için UTF-8.
chcp 65001 > $null
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$requiredFiles = @(
  # Checkout ve ödeme başarı ekranları
  "app\checkout\page.tsx",
  "app\payment\return\page.tsx",
  "app\pay\[token]\page.tsx",

  # Sipariş takip ekranı
  "app\track\page.tsx",
  "components\ui\TrackPanel.tsx",
  "lib\customer-tracking.ts",

  # Online ve Getrennt zahlen sonuç bilgileri
  "app\api\payments\session\route.ts",
  "app\api\payments\share\route.ts",

  # Güncel ödeme testi
  "tools\payment-closeout-tests.cjs"
)

if (!(Test-Path -LiteralPath $src -PathType Container)) {
  Write-Host "Çalışan proje bulunamadı: $src" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
  Write-Host "GitHub repo bulunamadı: $repo" -ForegroundColor Red
  exit 1
}

foreach ($file in $requiredFiles) {
  $sourceFile = Join-Path $src $file

  if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    Write-Host "ZORUNLU DOSYA BULUNAMADI: $sourceFile" -ForegroundColor Red
    exit 1
  }
}

Set-Location $repo

$gitPaths = @(
  $requiredFiles | ForEach-Object { $_ -replace "\\", "/" }
)

# Başka bir çalışmadan kalan dosyalara dokunma.
$allowedPaths = @{}

foreach ($path in $gitPaths) {
  $allowedPaths[$path.ToLowerInvariant()] = $true
}

$unexpectedChanges = New-Object System.Collections.Generic.List[string]
$statusLines = @(git status --porcelain=v1)

if ($LASTEXITCODE -ne 0) {
  Write-Host "git status çalıştırılamadı." -ForegroundColor Red
  exit 1
}

foreach ($line in $statusLines) {
  if ($line.Length -lt 4) {
    continue
  }

  $path = $line.Substring(3).Trim()

  if ($path.Contains(" -> ")) {
    $path = ($path -split " -> ", 2)[1].Trim()
  }

  $normalized = ($path -replace "\\", "/").Trim('"').ToLowerInvariant()

  if (!$allowedPaths.ContainsKey($normalized)) {
    $unexpectedChanges.Add($line)
  }
}

if ($unexpectedChanges.Count -gt 0) {
  Write-Host ""
  Write-Host "GitHub klasöründe bu güncelleme dışında değişiklikler var:" -ForegroundColor Yellow
  $unexpectedChanges | ForEach-Object { Write-Host $_ }
  Write-Host ""
  Write-Host "Güvenlik için işlem durduruldu; diğer dosyalara dokunulmadı." -ForegroundColor Red
  exit 1
}

# Önceki yarım kalmış denemeden yalnız bu güncellemeye ait dosyaları temizle.
git restore --staged --worktree -- $gitPaths 2>$null

foreach ($path in $gitPaths) {
  git ls-files --error-unmatch -- $path *> $null

  if ($LASTEXITCODE -ne 0) {
    $untrackedTarget = Join-Path $repo ($path -replace "/", "\")

    if (Test-Path -LiteralPath $untrackedTarget -PathType Leaf) {
      Remove-Item -LiteralPath $untrackedTarget -Force
    }
  }
}

Write-Host ""
Write-Host "GitHub repository güncelleniyor..." -ForegroundColor Cyan

git pull --ff-only

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "git pull başarısız oldu. Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Güncel ödeme, süre ve takip dosyaları aktarılıyor..." -ForegroundColor Cyan

foreach ($file in $requiredFiles) {
  $sourceFile = Join-Path $src $file
  $targetFile = Join-Path $repo $file

  New-Item `
    -ItemType Directory `
    -Path (Split-Path -Parent $targetFile) `
    -Force | Out-Null

  Copy-Item `
    -LiteralPath $sourceFile `
    -Destination $targetFile `
    -Force

  Write-Host "Kopyalandı: $file" -ForegroundColor Green
}

# Secret dosyaları GitHub'a kopyalanmaz.
# Yalnız production build processine geçici olarak yüklenir.
$envFiles = @(
  (Join-Path $src ".env"),
  (Join-Path $src ".env.local")
)

foreach ($envFile in $envFiles) {
  if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) {
    continue
  }

  foreach ($rawLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $line = $rawLine.Trim()

    if (
      !$line -or
      $line.StartsWith("#") -or
      !$line.Contains("=")
    ) {
      continue
    }

    $parts = $line -split "=", 2
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
      continue
    }

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      if ($value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$env:NEXT_TELEMETRY_DISABLED = "1"
$env:GIT_PAGER = "cat"
$env:PAGER = "cat"

Write-Host ""
Write-Host "Temiz production build başlatılıyor..." -ForegroundColor Cyan

Remove-Item `
  -LiteralPath (Join-Path $repo ".next") `
  -Recurse `
  -Force `
  -ErrorAction SilentlyContinue

Remove-Item `
  -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") `
  -Force `
  -ErrorAction SilentlyContinue

npx.cmd prisma generate

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "PRISMA GENERATE HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

npm.cmd run build

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "BUILD HATALI — Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Build başarılı ✅" -ForegroundColor Green

foreach ($path in $gitPaths) {
  git add -- $path

  if ($LASTEXITCODE -ne 0) {
    Write-Host "Git add başarısız: $path" -ForegroundColor Red
    exit 1
  }
}

git diff --cached --check

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Stage edilen dosyalarda diff hatası bulundu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Gönderilecek bütün değişiklikler:" -ForegroundColor Cyan

git status --short
git -c core.pager=cat diff --cached --stat

git diff --cached --quiet

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Yeni değişiklik bulunamadı; dosyalar GitHub klasöründe zaten aynı." -ForegroundColor Yellow
  exit 0
}

git commit -m "Fix online order tracking and show ETA for every payment"

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Commit oluşturulamadı." -ForegroundColor Red
  exit 1
}

$branch = (git branch --show-current).Trim()

if (!$branch) {
  $branch = "main"
}

git push -u origin $branch

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Git push başarısız oldu." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "ONLINE TAKİP VE SÜRE GÜNCELLEMESİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Gönderilen dosyalar:" -ForegroundColor Cyan

foreach ($file in $requiredFiles) {
  Write-Host " - $file" -ForegroundColor Green
}
