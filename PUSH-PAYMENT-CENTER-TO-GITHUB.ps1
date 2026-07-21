#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
try { chcp 65001 | Out-Null } catch {}

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$commitMessage = "feat: add payment and split centers"

$deliveryFiles = @(
  "app/api/payments/prepare/route.ts",
  "app/api/payments/session/route.ts",
  "app/api/payments/share/route.ts",
  "app/api/stripe/webhook/route.ts",
  "app/checkout/page.tsx",
  "app/pay/[token]/page.tsx",
  "app/payment/action/page.tsx",
  "app/payment/center/page.tsx",
  "app/payment/return/page.tsx",
  "app/payment/split/page.tsx",
  "lib/server/payment-checkout.ts",
  "lib/server/payment-finalize.ts",
  "lib/server/payment-intent.ts",
  "lib/server/payment-mutation-lock.ts",
  "lib/server/payment-recovery-token.ts",
  "lib/server/stripe-client.ts",
  "package.json",
  "tools/payment-center-architecture-tests.cjs",
  "tools/payment-closeout-tests.cjs",
  "README-PAYMENT-CENTER.md",
  "CHANGED-FILES.txt",
  "VERIFY-PAYMENT-CENTER.txt",
  "PUSH-PAYMENT-CENTER-TO-GITHUB.ps1"
)

$forbiddenPathPattern = '(^|/)(\.env($|\.)|node_modules($|/)|\.next($|/)|.*\.db$|.*\.sqlite3?$|tsconfig\.tsbuildinfo$)|(^|/)(secrets?|tokens?)(/|$)'
$backupRoot = Join-Path $env:TEMP ("bb-payment-center-backup-" + [Guid]::NewGuid().ToString("N"))
$backupManifest = New-Object System.Collections.Generic.List[object]
$commitCreated = $false
$copied = $false

function Assert-LastExitCode([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step başarısız oldu. ExitCode=$LASTEXITCODE"
  }
}

function Invoke-NativeStep([string]$Title, [scriptblock]$Command) {
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
  & $Command
  Assert-LastExitCode $Title
}

function Import-DotEnvFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $line = [string]$rawLine
    $line = $line.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    if ($line.StartsWith("export ")) { $line = $line.Substring(7).Trim() }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { continue }
    $name = $matches[1]
    $value = $matches[2].Trim()
    if ($value.Length -ge 2) {
      $first = $value.Substring(0, 1)
      $last = $value.Substring($value.Length - 1, 1)
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Get-StatusPath([string]$Line) {
  if ([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -lt 4) { return "" }
  $path = $Line.Substring(3).Trim()
  if ($path.Contains(" -> ")) { $path = ($path -split ' -> ')[-1].Trim() }
  return $path.Trim('"').Replace('\', '/')
}

function Restore-DeliveryFiles {
  if (-not $copied) { return }
  Write-Host "Teslimat dosyaları geri alınıyor..." -ForegroundColor Yellow
  foreach ($entry in $backupManifest) {
    $dest = [string]$entry.Destination
    if ([bool]$entry.Existed) {
      $backup = [string]$entry.Backup
      $parent = Split-Path -Parent $dest
      if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
      }
      Copy-Item -LiteralPath $backup -Destination $dest -Force
    } else {
      if (Test-Path -LiteralPath $dest -PathType Leaf) {
        Remove-Item -LiteralPath $dest -Force
      }
    }
  }
  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue
}

try {
  if ((Resolve-Path -LiteralPath (Get-Location).Path).Path -ne (Resolve-Path -LiteralPath $src).Path) {
    throw "Bu script ZIP/fix klasöründen çalıştırılamaz. Dosyayı C:\Web\burger içine koyup oradan çalıştırın."
  }
  if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "Kaynak klasör bulunamadı: $src" }
  if (-not (Test-Path -LiteralPath $repo -PathType Container)) { throw "GitHub repository klasörü bulunamadı: $repo" }
  if (-not (Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
    throw "C:\Web\burger-github geçerli bir Git repository değil. Güvenlik nedeniyle git init çalıştırılmayacak."
  }

  foreach ($rel in $deliveryFiles) {
    $normalized = $rel.Replace('\', '/')
    if ($normalized -match $forbiddenPathPattern) { throw "Yasaklı teslimat yolu: $rel" }
    $sourceFile = Join-Path $src ($rel.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Kaynak dosya eksik: $sourceFile" }
  }

  $branch = (& git -C $repo branch --show-current).Trim()
  Assert-LastExitCode "Aktif branch kontrolü"
  if (-not $branch) { throw "Repository detached HEAD durumunda; push yapılmayacak." }

  $initialStatus = @(& git -C $repo status --porcelain=v1 --untracked-files=all)
  Assert-LastExitCode "Git durum kontrolü"
  if ($initialStatus.Count -gt 0) {
    Write-Host "Repository içinde teslimat dışı veya henüz kaydedilmemiş değişiklikler var:" -ForegroundColor Yellow
    $initialStatus | ForEach-Object { Write-Host "  $_" }
    throw "Önce C:\Web\burger-github klasörünü temiz duruma getirin. Mevcut çalışma üzerine yazılmadı."
  }

  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  foreach ($rel in $deliveryFiles) {
    $relativeWindows = $rel.Replace('/', '\')
    $sourceFile = Join-Path $src $relativeWindows
    $destinationFile = Join-Path $repo $relativeWindows
    $backupFile = Join-Path $backupRoot $relativeWindows
    $existed = Test-Path -LiteralPath $destinationFile -PathType Leaf
    if ($existed) {
      $backupParent = Split-Path -Parent $backupFile
      New-Item -ItemType Directory -Force -Path $backupParent | Out-Null
      Copy-Item -LiteralPath $destinationFile -Destination $backupFile -Force
    }
    $backupManifest.Add([pscustomobject]@{
      Destination = $destinationFile
      Backup = $backupFile
      Existed = $existed
    }) | Out-Null

    $destinationParent = Split-Path -Parent $destinationFile
    New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $destinationFile -Force
  }
  $copied = $true

  # Secret dosyaları repository içine kopyalanmaz. Yalnız build child process'i için belleğe yüklenir.
  @(".env", ".env.production", ".env.local", ".env.production.local") |
    ForEach-Object { Import-DotEnvFile (Join-Path $src $_) }

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  Push-Location $repo
  try {
    Invoke-NativeStep "Prisma generate" { & npx.cmd prisma generate }
    Invoke-NativeStep "TypeScript / Next typecheck" { & npm.cmd run typecheck }
    Invoke-NativeStep "Security regression tests" { & npm.cmd run security:test }
    Invoke-NativeStep "Production build" { & npm.cmd run build }
  } finally {
    Pop-Location
  }

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  $allowed = @{}
  foreach ($rel in $deliveryFiles) { $allowed[$rel.Replace('\', '/')] = $true }
  $statusAfterBuild = @(& git -C $repo status --porcelain=v1 --untracked-files=all)
  Assert-LastExitCode "Build sonrası Git durum kontrolü"
  foreach ($line in $statusAfterBuild) {
    $path = Get-StatusPath $line
    if ($path -and -not $allowed.ContainsKey($path)) {
      throw "Build/test teslimat dışı bir dosyayı değiştirdi: $path"
    }
  }

  Push-Location $repo
  try {
    & git add -- @deliveryFiles
    Assert-LastExitCode "git add"

    $stagedFiles = @(& git diff --cached --name-only)
    Assert-LastExitCode "Staged dosya kontrolü"
    if ($stagedFiles.Count -eq 0) {
      Write-Host "Gönderilecek yeni değişiklik yok. Commit/push yapılmadı." -ForegroundColor Yellow
      exit 0
    }

    foreach ($staged in $stagedFiles) {
      $normalized = ([string]$staged).Replace('\', '/')
      if (-not $allowed.ContainsKey($normalized)) { throw "Teslimat dışı dosya stage edildi: $normalized" }
      if ($normalized -match $forbiddenPathPattern) { throw "Yasaklı dosya stage edildi: $normalized" }
    }

    Write-Host ""
    Write-Host "=== git diff --cached --stat ===" -ForegroundColor Cyan
    & git diff --cached --stat
    Assert-LastExitCode "git diff --cached --stat"

    & git commit -m $commitMessage
    Assert-LastExitCode "git commit"
    $commitCreated = $true

    & git push origin $branch
    Assert-LastExitCode "git push"
  } finally {
    Pop-Location
  }

  Write-Host ""
  Write-Host "Başarıyla GitHub'a gönderildi. Branch: $branch" -ForegroundColor Green
  Write-Host "Gönderilen dosyalar:" -ForegroundColor Green
  foreach ($rel in $deliveryFiles) { Write-Host "  - $rel" }
}
catch {
  Write-Host ""
  Write-Host ("HATA: " + $_.Exception.Message) -ForegroundColor Red
  if (-not $commitCreated) {
    try {
      & git -C $repo reset --quiet 2>$null
    } catch {}
    try { Restore-DeliveryFiles } catch {
      Write-Host ("Otomatik geri alma sırasında ek hata: " + $_.Exception.Message) -ForegroundColor Red
    }
    Write-Host "Build/test başarısız olduğu için commit veya push yapılmadı." -ForegroundColor Yellow
  } else {
    Write-Host "Commit oluşturuldu ancak push tamamlanamadı. Commit yerel repository içinde bırakıldı; dosyalar geri alınmadı." -ForegroundColor Yellow
  }
  exit 1
}
finally {
  Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
}
