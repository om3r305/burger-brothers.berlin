$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 / VS Code terminali için UTF-8.
chcp 65001 > $null
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$requiredFiles = @(
  # Takip tokeninin query parametresinden okunması
  "lib\server\public-order.ts",

  # Aynı hatanın tekrar oluşmasını engelleyen test
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

$gitPaths = New-Object System.Collections.Generic.List[string]

Set-Location $repo

Write-Host ""
Write-Host "GitHub repository güncelleniyor..." -ForegroundColor Cyan

git pull --ff-only

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "git pull başarısız oldu. Commit ve push yapılmadı." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Online takip düzeltmesi aktarılıyor..." -ForegroundColor Cyan

foreach ($file in $requiredFiles) {
  $sourceFile = Join-Path $src $file
  $targetFile = Join-Path $repo $file

  if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    Write-Host "ZORUNLU DOSYA BULUNAMADI: $sourceFile" -ForegroundColor Red
    exit 1
  }

  New-Item `
    -ItemType Directory `
    -Path (Split-Path -Parent $targetFile) `
    -Force | Out-Null

  Copy-Item `
    -LiteralPath $sourceFile `
    -Destination $targetFile `
    -Force

  $gitPaths.Add(($file -replace "\\", "/"))
  Write-Host "Kopyalandı: $file" -ForegroundColor Green
}

# Secret dosyaları GitHub'a kopyalanmaz.
# Yalnız build işlemi için process ortamına yüklenir.
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

    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) {
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

$uniqueGitPaths = $gitPaths | Sort-Object -Unique

foreach ($path in $uniqueGitPaths) {
  git add -- $path

  if ($LASTEXITCODE -ne 0) {
    Write-Host "Git add başarısız: $path" -ForegroundColor Red
    exit 1
  }
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

git commit -m "Fix tracking token extraction from public query"

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
Write-Host "ONLINE SİPARİŞ TAKİP DÜZELTMESİ GITHUB'A GÖNDERİLDİ ✅" -ForegroundColor Green
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host ""
Write-Host "Gönderilen dosyalar:" -ForegroundColor Cyan

foreach ($file in $requiredFiles) {
  Write-Host " - $file" -ForegroundColor Green
}
