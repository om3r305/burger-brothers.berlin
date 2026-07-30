$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$packageRoot = $PSScriptRoot
$fileListPath = Join-Path $packageRoot "CHANGED-FILES.txt"
$backupRoot = "C:\Web\burger-github-security-backups"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $backupRoot "complete-security-$timestamp"
$registry = "https://registry.npmjs.org/"
$commitMessage = "security: close legacy APIs, tracking and operational exposure"
$existingFiles = New-Object System.Collections.Generic.List[string]
$newFiles = New-Object System.Collections.Generic.List[string]
$copiedFiles = New-Object System.Collections.Generic.List[string]
$commitCreated = $false

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

function Restore-RepoFiles {
  Write-Host ""
  Write-Host "GitHub çalışma klasörü geri yükleniyor..." -ForegroundColor Yellow

  Set-Location $repo
  & git reset | Out-Null

  foreach ($file in $existingFiles) {
    $saved = Join-Path $backup $file
    $target = Join-Path $repo $file

    if (Test-Path -LiteralPath $saved -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $saved -Destination $target -Force
    }
  }

  foreach ($file in $newFiles) {
    Remove-Item -LiteralPath (Join-Path $repo $file) -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  Write-Host "Repo dosyaları geri yüklendi. Yedek: $backup" -ForegroundColor Yellow
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

function Test-SourceForSecrets {
  param([string]$FilePath, [string]$RelativePath)

  $extension = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
  if ($extension -notin @(".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".ps1", ".yml", ".yaml")) {
    return
  }

  $content = Get-Content -LiteralPath $FilePath -Raw -ErrorAction SilentlyContinue
  if (!$content) { return }

  if (
    $content -match "-----BEGIN [A-Z ]*PRIVATE KEY-----" -or
    $content -match "\bsk_live_[A-Za-z0-9]{16,}\b" -or
    $content -match "\b\d{8,12}:[A-Za-z0-9_-]{30,}\b"
  ) {
    throw "Muhtemel gerçek secret/private key bulundu: $RelativePath"
  }
}

try {
  Write-Host ""
  Write-Host "BURGER BROTHERS — KAPSAMLI GÜVENLİK GITHUB PUSH" -ForegroundColor Cyan
  Write-Host "==================================================" -ForegroundColor DarkGray

  if (!(Test-Path -LiteralPath $src -PathType Container)) {
    throw "Çalışan proje bulunamadı: $src"
  }

  if (!(Test-Path -LiteralPath $repo -PathType Container)) {
    throw "GitHub klasörü bulunamadı: $repo"
  }

  if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
    throw "Mevcut Git repository bulunamadı: $repo. git init çalıştırılmadı."
  }

  if (!(Test-Path -LiteralPath $fileListPath -PathType Leaf)) {
    throw "CHANGED-FILES.txt bulunamadı."
  }

  $nodeVersionText = (& node --version).Trim().TrimStart("v")
  if ($LASTEXITCODE -ne 0) { throw "Node.js bulunamadı." }
  $nodeMajor = [int]($nodeVersionText.Split(".")[0])
  if ($nodeMajor -lt 20) { throw "Node.js 20 veya üzeri gerekli. Mevcut: $nodeVersionText" }

  $files = Get-Content -LiteralPath $fileListPath -Encoding UTF8 |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }

  if (!$files -or $files.Count -eq 0) { throw "Dosya listesi boş." }

  foreach ($file in $files) {
    if (Test-ForbiddenRelativePath $file) {
      throw "GitHub listesinde yasak yol bulundu: $file"
    }

    $source = Join-Path $src $file
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "Çalışan projede güvenlik dosyası eksik: $file"
    }

    Test-SourceForSecrets -FilePath $source -RelativePath $file
  }

  New-Item -ItemType Directory -Path $backup -Force | Out-Null

  Set-Location $repo
  & git reset | Out-Null

  Write-Step "Güvenlik dosyaları çalışan projeden GitHub klasörüne aktarılıyor..."
  foreach ($file in $files) {
    $source = Join-Path $src $file
    $target = Join-Path $repo $file

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
    Write-Host "Kopyalandı: $file" -ForegroundColor Green
  }

  # Daha önce yanlışlıkla takip edilmiş hassas dosyaları Git geçmişinin yeni commit'inden çıkar.
  $tracked = @(& git ls-files)
  if ($LASTEXITCODE -ne 0) { throw "git ls-files çalışmadı." }

  $trackedForbidden = $tracked | Where-Object { Test-ForbiddenRelativePath $_ }
  foreach ($file in $trackedForbidden) {
    & git rm --cached --ignore-unmatch -- $file | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Hassas dosya Git index'inden çıkarılamadı: $file" }
    Write-Host "Git takibinden çıkarıldı: $file" -ForegroundColor Yellow
  }

  $loadedEnvCount = Import-LocalEnvironment -Path (Join-Path $src ".env.local")
  Write-Host "$loadedEnvCount local environment değişkeni yalnızca build sürecine yüklendi; repo'ya kopyalanmadı ✅" -ForegroundColor Green

  $env:NPM_CONFIG_REGISTRY = $registry

  if (Select-String -LiteralPath (Join-Path $repo "package-lock.json") -Pattern "internal.api.openai.org", "applied-caas-gateway", "ace-research.openai.org" -SimpleMatch -Quiet) {
    throw "package-lock.json içinde erişilemez internal npm registry adresi bulundu."
  }

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

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

  $gitFiles = $files | ForEach-Object { $_ -replace "\\", "/" }
  & git add -- $gitFiles
  if ($LASTEXITCODE -ne 0) { throw "git add başarısız oldu." }

  $stagedLines = @(& git diff --cached --name-status)
  if ($LASTEXITCODE -ne 0) { throw "Stage alanı okunamadı." }

  foreach ($line in $stagedLines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split "`t"
    $status = $parts[0]
    $path = $parts[$parts.Count - 1]

    if ((Test-ForbiddenRelativePath $path) -and !$status.StartsWith("D")) {
      throw "Gizli/yasak dosya stage alanında eklenecek durumda: $path"
    }

    if (!$status.StartsWith("D")) {
      Test-SourceForSecrets -FilePath (Join-Path $repo $path) -RelativePath $path
    }
  }

  Write-Step "GitHub'a gönderilecek değişiklikler:"
  & git status --short
  & git diff --cached --stat

  & git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Gönderilecek yeni değişiklik bulunamadı." -ForegroundColor Yellow
    exit 0
  }

  & git commit -m $commitMessage
  if ($LASTEXITCODE -ne 0) { throw "Commit oluşturulamadı." }
  $commitCreated = $true

  $branch = (& git branch --show-current).Trim()
  if ([string]::IsNullOrWhiteSpace($branch)) { throw "Aktif Git branch bulunamadı." }

  & git push -u origin $branch
  if ($LASTEXITCODE -ne 0) {
    throw "Git push başarısız oldu. Commit yerel repoda korunuyor."
  }

  Write-Host ""
  Write-Host "==================================================" -ForegroundColor DarkGray
  Write-Host "KAPSAMLI GÜVENLİK DEĞİŞİKLİKLERİ GITHUB'A GİTTİ ✅" -ForegroundColor Green
  Write-Host "Branch: $branch" -ForegroundColor Cyan
  Write-Host "Commit: $commitMessage" -ForegroundColor Cyan
  Write-Host "Güvenlik dosyası: $($files.Count)" -ForegroundColor Cyan
  Write-Host "SESSION_SECRET, env, PEM, DB, snapshot ve local print config gönderilmedi ✅" -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "İŞLEM DURDU ❌" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red

  if (!$commitCreated -and $copiedFiles.Count -gt 0) {
    Restore-RepoFiles
    Write-Host "Commit ve push yapılmadı." -ForegroundColor Yellow
  }
  elseif ($commitCreated) {
    Write-Host "Commit yerel repoda oluşturuldu fakat push tamamlanmadı." -ForegroundColor Yellow
    Write-Host "Bağlantı düzeldikten sonra repo klasöründe git push çalıştırabilirsiniz." -ForegroundColor Yellow
  }

  exit 1
}
