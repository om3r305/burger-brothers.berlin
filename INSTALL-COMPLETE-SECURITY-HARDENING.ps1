$ErrorActionPreference = "Stop"

$project = "C:\Web\burger"
$packageRoot = $PSScriptRoot
$patchRoot = Join-Path $packageRoot "PATCH"
$fileListPath = Join-Path $packageRoot "CHANGED-FILES.txt"
$hashListPath = Join-Path $packageRoot "PATCH-SHA256SUMS.txt"
$backupRoot = "C:\Web\burger-security-backups"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $backupRoot "complete-security-$timestamp"
$registry = "https://registry.npmjs.org/"
$envFile = Join-Path $project ".env.local"
$envBackup = Join-Path $backup ".env.local"
$envExistedBefore = $false
$copiedFiles = New-Object System.Collections.Generic.List[string]
$newFiles = New-Object System.Collections.Generic.List[string]
$existingFiles = New-Object System.Collections.Generic.List[string]

function Write-Step {
  param([string]$Text)
  Write-Host ""
  Write-Host $Text -ForegroundColor Cyan
}

function Invoke-ExternalStep {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Step $Title
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "$Title başarısız oldu. Exit code: $LASTEXITCODE"
  }

  Write-Host "$Title başarılı ✅" -ForegroundColor Green
}

function Test-ForbiddenRelativePath {
  param([string]$RelativePath)

  $path = ($RelativePath -replace "\\", "/").TrimStart("/").ToLowerInvariant()
  $name = [System.IO.Path]::GetFileName($path)
  $extension = [System.IO.Path]::GetExtension($path)

  if ($name -eq ".env.example") { return $false }

  return (
    $name -eq ".env" -or
    $name.StartsWith(".env.") -or
    $extension -in @(".pem", ".key", ".crt", ".cer", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3") -or
    $path -eq "bootstrap.json" -or
    $path.StartsWith("data/") -or
    $path.StartsWith(".next/") -or
    $path.StartsWith("node_modules/") -or
    $path.StartsWith(".burger-brothers-fallback-snapshots/") -or
    $path -eq "print-agent/config.json" -or
    $path -eq "print-proxy/config.json" -or
    $path -eq "print-proxy/.env"
  )
}

function Restore-ProjectFiles {
  Write-Host ""
  Write-Host "Kurulum geri alınıyor..." -ForegroundColor Yellow

  foreach ($file in $existingFiles) {
    $saved = Join-Path $backup $file
    $target = Join-Path $project $file

    if (Test-Path -LiteralPath $saved -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $saved -Destination $target -Force
    }
  }

  foreach ($file in $newFiles) {
    Remove-Item -LiteralPath (Join-Path $project $file) -Force -ErrorAction SilentlyContinue
  }

  if ($envExistedBefore -and (Test-Path -LiteralPath $envBackup -PathType Leaf)) {
    Copy-Item -LiteralPath $envBackup -Destination $envFile -Force
  }
  elseif (!$envExistedBefore) {
    Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath (Join-Path $project ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $project "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  Write-Host "Kod ve .env.local eski haline getirildi." -ForegroundColor Yellow
  Write-Host "Yedek: $backup" -ForegroundColor DarkYellow
}

function Import-LocalEnvironment {
  param([string]$Path)

  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { return 0 }

  $count = 0
  foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $line = $rawLine.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { continue }

    $parts = $line -split "=", 2
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") { continue }
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      if ($value.Length -ge 2) { $value = $value.Substring(1, $value.Length - 2) }
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
    $count++
  }

  return $count
}

function Ensure-SessionSecret {
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $script:envExistedBefore = $true
    Copy-Item -LiteralPath $envFile -Destination $envBackup -Force
    $content = [System.IO.File]::ReadAllText($envFile)
  }
  else {
    $script:envExistedBefore = $false
    $content = ""
  }

  $pattern = "(?m)^\s*SESSION_SECRET\s*=\s*(.*?)\s*$"
  $match = [regex]::Match($content, $pattern)
  $secret = ""

  if ($match.Success) {
    $secret = $match.Groups[1].Value.Trim().Trim('"').Trim("'")
  }

  if ($secret.Length -lt 32) {
    $processSecret = [Environment]::GetEnvironmentVariable("SESSION_SECRET", "Process")

    if (![string]::IsNullOrWhiteSpace($processSecret) -and $processSecret.Length -ge 32) {
      $secret = $processSecret
    }
    else {
      $bytes = New-Object byte[] 48
      $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
      $secret = [Convert]::ToBase64String($bytes)
    }

    $line = "SESSION_SECRET=$secret"

    if ($match.Success) {
      $content = [regex]::Replace($content, $pattern, $line, 1)
    }
    else {
      if ($content.Length -gt 0 -and !$content.EndsWith("`n")) { $content += "`r`n" }
      $content += "`r`n# Signed Burger Brothers sessions`r`n$line`r`n"
    }

    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($envFile, $content, $utf8)
    Write-Host "Güçlü SESSION_SECRET .env.local içine hazırlandı ✅" -ForegroundColor Green
  }
  else {
    Write-Host "Geçerli SESSION_SECRET mevcut ✅" -ForegroundColor Green
  }

  [Environment]::SetEnvironmentVariable("SESSION_SECRET", $secret, "Process")
}

try {
  Write-Host ""
  Write-Host "BURGER BROTHERS — KAPSAMLI GÜVENLİK KURULUMU" -ForegroundColor Cyan
  Write-Host "================================================" -ForegroundColor DarkGray

  if (!(Test-Path -LiteralPath $project -PathType Container)) {
    throw "Çalışan proje bulunamadı: $project"
  }

  if (!(Test-Path -LiteralPath $patchRoot -PathType Container)) {
    throw "PATCH klasörü bulunamadı: $patchRoot"
  }

  if (!(Test-Path -LiteralPath $fileListPath -PathType Leaf)) {
    throw "CHANGED-FILES.txt bulunamadı."
  }

  if (!(Test-Path -LiteralPath $hashListPath -PathType Leaf)) {
    throw "PATCH-SHA256SUMS.txt bulunamadı."
  }

  $nodeVersionText = (& node --version).Trim().TrimStart("v")
  if ($LASTEXITCODE -ne 0) { throw "Node.js bulunamadı." }
  $nodeMajor = [int]($nodeVersionText.Split(".")[0])
  if ($nodeMajor -lt 20) { throw "Node.js 20 veya üzeri gerekli. Mevcut: $nodeVersionText" }

  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $devServer = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($devServer) {
      throw "localhost:3000 hâlâ çalışıyor. Önce dev server terminalinde CTRL+C yapın ve scripti yeniden çalıştırın."
    }
  }

  $files = Get-Content -LiteralPath $fileListPath -Encoding UTF8 |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }

  if (!$files -or $files.Count -eq 0) { throw "Dosya listesi boş." }

  foreach ($file in $files) {
    if (Test-ForbiddenRelativePath $file) {
      throw "Paket dosya listesinde yasak yol bulundu: $file"
    }

    $source = Join-Path $patchRoot $file
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "PATCH dosyası eksik: $file"
    }
  }

  Write-Step "Paket SHA-256 bütünlüğü doğrulanıyor..."
  foreach ($line in Get-Content -LiteralPath $hashListPath -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split "\s+", 2
    if ($parts.Count -ne 2) { throw "Geçersiz hash satırı: $line" }
    $expected = $parts[0].Trim().ToUpperInvariant()
    $relative = $parts[1].Trim()
    $filePath = Join-Path $patchRoot $relative
    if (!(Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Hash dosyası bulunamadı: $relative" }
    $actual = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actual -ne $expected) { throw "SHA-256 uyuşmazlığı: $relative" }
  }
  Write-Host "Paket bütünlüğü doğrulandı ✅" -ForegroundColor Green

  New-Item -ItemType Directory -Path $backup -Force | Out-Null

  Write-Step "Mevcut dosyalar yedekleniyor ve güvenlik patch'i uygulanıyor..."
  foreach ($file in $files) {
    $source = Join-Path $patchRoot $file
    $target = Join-Path $project $file

    if (Test-Path -LiteralPath $target -PathType Leaf) {
      $existingFiles.Add($file)
      $saved = Join-Path $backup $file
      New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $saved -Force
    }
    else {
      $newFiles.Add($file)
    }

    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    $copiedFiles.Add($file)
    Write-Host "Uygulandı: $file" -ForegroundColor Green
  }

  Ensure-SessionSecret
  $loadedEnvCount = Import-LocalEnvironment -Path $envFile
  Write-Host "$loadedEnvCount local environment değişkeni yalnızca bu sürece yüklendi ✅" -ForegroundColor Green

  $env:NPM_CONFIG_REGISTRY = $registry
  Set-Location $project

  if (Select-String -LiteralPath (Join-Path $project "package-lock.json") -Pattern "internal.api.openai.org", "applied-caas-gateway", "ace-research.openai.org" -SimpleMatch -Quiet) {
    throw "package-lock.json içinde erişilemez internal npm registry adresi bulundu."
  }

  Remove-Item -LiteralPath (Join-Path $project ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $project "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  Invoke-ExternalStep "1/6 Bağımlılıklar temiz kuruluyor..." {
    & npm.cmd ci --registry=$registry --no-audit --no-fund
  }

  Invoke-ExternalStep "2/6 Prisma Client üretiliyor..." {
    & npm.cmd run prisma:generate
  }

  Invoke-ExternalStep "3/6 Otomatik güvenlik testleri çalışıyor..." {
    & npm.cmd run security:test
  }

  Invoke-ExternalStep "4/6 TypeScript kontrolü çalışıyor..." {
    & npm.cmd run typecheck
  }

  Invoke-ExternalStep "5/6 Yüksek/kritik bağımlılık açıkları kontrol ediliyor..." {
    & npm.cmd audit --audit-level=high --registry=$registry
  }

  Invoke-ExternalStep "6/6 Production build çalışıyor..." {
    & npm.cmd run build
  }

  Write-Host ""
  Write-Host "================================================" -ForegroundColor DarkGray
  Write-Host "KAPSAMLI GÜVENLİK KURULUMU TAMAMLANDI ✅" -ForegroundColor Green
  Write-Host "Uygulanan dosya: $($copiedFiles.Count)" -ForegroundColor Cyan
  Write-Host "Yedek: $backup" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Şimdi local Admin, TV, Driver, checkout, ödeme ve takip testlerini yapın." -ForegroundColor Yellow
  Write-Host "Her şey doğruysa GITHUB-PUSH-COMPLETE-SECURITY-HARDENING.ps1 çalıştırın." -ForegroundColor Yellow
}
catch {
  Write-Host ""
  Write-Host "KURULUM DURDU ❌" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red

  if ($copiedFiles.Count -gt 0) {
    Restore-ProjectFiles
  }

  Write-Host "Commit veya push yapılmadı." -ForegroundColor Yellow
  exit 1
}
