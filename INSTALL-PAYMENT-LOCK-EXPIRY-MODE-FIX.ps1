$ErrorActionPreference = "Stop"

function Install-BurgerPaymentLockExpiryModeFix {
  $projectRoot = "C:\Web\burger"
  $packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupRoot = "C:\Web\burger-payment-lock-expiry-mode-backup-$timestamp"
  $logRoot = "C:\Web\burger-payment-lock-expiry-mode-logs-$timestamp"

  $files = @(
    "app\checkout\page.tsx",
    "app\payment\return\page.tsx",
    "app\api\payments\prepare\route.ts",
    "app\api\payments\session\route.ts",
    "lib\server\payment-finalize.ts",
    "lib\server\payment-recovery-token.ts",
    "tools\payment-closeout-tests.cjs"
  )

  $originalState = @{}
  $copied = $false

  function Load-LocalEnvironment {
    $envFile = Join-Path $projectRoot ".env.local"

    if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) {
      Write-Host ".env.local bulunamadi; mevcut process environment kullanilacak." `
        -ForegroundColor Yellow
      return
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

    Write-Host "Local environment sadece bu PowerShell processine yuklendi." `
      -ForegroundColor DarkGray
  }

  function Invoke-CmdStep {
    param(
      [Parameter(Mandatory = $true)]
      [string]$Command,

      [Parameter(Mandatory = $true)]
      [string]$Label,

      [Parameter(Mandatory = $true)]
      [string]$LogFile
    )

    Remove-Item `
      -LiteralPath $LogFile `
      -Force `
      -ErrorAction SilentlyContinue

    $cmdLine = $Command + ' > "' + $LogFile + '" 2>&1'

    & cmd.exe /d /s /c $cmdLine
    $exitCode = $LASTEXITCODE

    if (Test-Path -LiteralPath $LogFile -PathType Leaf) {
      Get-Content -LiteralPath $LogFile -Encoding UTF8
    }

    if ($exitCode -ne 0) {
      throw "$Label basarisiz oldu. Exit code: $exitCode"
    }

    Write-Host "$Label basarili." -ForegroundColor Green
  }

  function Restore-OriginalFiles {
    foreach ($entry in $originalState.GetEnumerator()) {
      $relativePath = [string]$entry.Key
      $targetFile = Join-Path $projectRoot $relativePath

      if ([bool]$entry.Value) {
        $backupFile = Join-Path $backupRoot $relativePath

        if (Test-Path -LiteralPath $backupFile -PathType Leaf) {
          New-Item `
            -ItemType Directory `
            -Path (Split-Path -Parent $targetFile) `
            -Force | Out-Null

          Copy-Item `
            -LiteralPath $backupFile `
            -Destination $targetFile `
            -Force
        }
      }
      else {
        Remove-Item `
          -LiteralPath $targetFile `
          -Force `
          -ErrorAction SilentlyContinue
      }
    }

    Remove-Item `
      -LiteralPath (Join-Path $projectRoot ".next") `
      -Recurse `
      -Force `
      -ErrorAction SilentlyContinue

    Remove-Item `
      -LiteralPath (Join-Path $projectRoot "tsconfig.tsbuildinfo") `
      -Force `
      -ErrorAction SilentlyContinue

    Write-Host "Proje dosyalari eski haline geri getirildi." `
      -ForegroundColor Yellow
  }

  try {
    if (!(Test-Path -LiteralPath $projectRoot -PathType Container)) {
      throw "Proje klasoru bulunamadi: $projectRoot"
    }

    foreach ($relativePath in $files) {
      $sourceFile = Join-Path $packageRoot $relativePath

      if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Paket dosyasi eksik: $sourceFile"
      }
    }

    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

    Write-Host ""
    Write-Host "Mevcut dosyalar yedekleniyor..." -ForegroundColor Cyan

    foreach ($relativePath in $files) {
      $targetFile = Join-Path $projectRoot $relativePath
      $exists = Test-Path -LiteralPath $targetFile -PathType Leaf
      $originalState[$relativePath] = $exists

      if ($exists) {
        $backupFile = Join-Path $backupRoot $relativePath

        New-Item `
          -ItemType Directory `
          -Path (Split-Path -Parent $backupFile) `
          -Force | Out-Null

        Copy-Item `
          -LiteralPath $targetFile `
          -Destination $backupFile `
          -Force
      }
    }

    Write-Host ""
    Write-Host "7 guncel dosya C:\Web\burger icine kopyalaniyor..." `
      -ForegroundColor Cyan

    foreach ($relativePath in $files) {
      $sourceFile = Join-Path $packageRoot $relativePath
      $targetFile = Join-Path $projectRoot $relativePath

      New-Item `
        -ItemType Directory `
        -Path (Split-Path -Parent $targetFile) `
        -Force | Out-Null

      Copy-Item `
        -LiteralPath $sourceFile `
        -Destination $targetFile `
        -Force

      Write-Host "Kopyalandi: $relativePath" -ForegroundColor Green
    }

    $copied = $true

    Set-Location $projectRoot
    $env:NEXT_TELEMETRY_DISABLED = "1"
    $env:NPM_CONFIG_REGISTRY = "https://registry.npmjs.org/"

    Load-LocalEnvironment

    Remove-Item `
      -LiteralPath (Join-Path $projectRoot ".next") `
      -Recurse `
      -Force `
      -ErrorAction SilentlyContinue

    Remove-Item `
      -LiteralPath (Join-Path $projectRoot "tsconfig.tsbuildinfo") `
      -Force `
      -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "Prisma Client uretiliyor..." -ForegroundColor Cyan

    Invoke-CmdStep `
      -Command "npx.cmd prisma generate" `
      -Label "Prisma generate" `
      -LogFile (Join-Path $logRoot "prisma-generate.log")

    Write-Host ""
    Write-Host "TypeScript, guvenlik testleri ve production build calisiyor..." `
      -ForegroundColor Cyan

    Invoke-CmdStep `
      -Command "npm.cmd run verify" `
      -Label "npm run verify" `
      -LogFile (Join-Path $logRoot "verify.log")

    Write-Host ""
    Write-Host "============================================================" `
      -ForegroundColor DarkGray
    Write-Host "PAYMENT LOCK, EXPIRY VE MODE FIX KURULDU" `
      -ForegroundColor Green
    Write-Host "Yedek: $backupRoot" -ForegroundColor Cyan
    Write-Host "Loglar: $logRoot" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Simdi local testleri yap. GitHub'a henuz bir sey gonderilmedi." `
      -ForegroundColor Yellow
  }
  catch {
    Write-Host ""
    Write-Host "KURULUM DURDU" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red

    if ($copied -and $originalState.Count -gt 0) {
      Restore-OriginalFiles
    }

    Write-Host "GitHub'a veya Vercel'e hicbir sey gonderilmedi." `
      -ForegroundColor Yellow

    throw
  }
}

Install-BurgerPaymentLockExpiryModeFix
