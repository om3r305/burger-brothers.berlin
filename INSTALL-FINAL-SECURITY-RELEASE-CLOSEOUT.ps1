$ErrorActionPreference = "Stop"

$delivery = Split-Path -Parent $MyInvocation.MyCommand.Path
$patch = Join-Path $delivery "PATCH"
$filesList = Join-Path $delivery "CHANGED-FILES.txt"
$deleteList = Join-Path $delivery "DELETE-FILES.txt"
$project = "C:\Web\burger"
$registry = "https://registry.npmjs.org/"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Web\burger-backup-final-security-$timestamp"
$installed = $false

function Invoke-Step {
  param([string]$Name, [scriptblock]$Action)

  Write-Host ""
  Write-Host $Name -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed. Exit code: $LASTEXITCODE"
  }
  Write-Host "$Name completed." -ForegroundColor Green
}

function Import-LocalEnvironment {
  param([string]$File)

  if (!(Test-Path -LiteralPath $File -PathType Leaf)) { return }

  foreach ($rawLine in Get-Content -LiteralPath $File -Encoding UTF8) {
    $line = $rawLine.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { continue }

    $parts = $line -split "=", 2
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") { continue }

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Stop-BurgerNodeProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and $_.CommandLine -like "*C:\Web\burger*"
    } |
    ForEach-Object {
      Write-Host "Stopping Node process: $($_.ProcessId)" -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Restore-Project {
  param([string[]]$Files, [string[]]$Deletes)

  Write-Host ""
  Write-Host "Restoring project files..." -ForegroundColor Yellow

  foreach ($relative in $Files) {
    $target = Join-Path $project $relative
    $saved = Join-Path $backup (Join-Path "files" $relative)
    $absentMarker = "$saved.absent"

    if (Test-Path -LiteralPath $saved -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $saved -Destination $target -Force
    }
    elseif (Test-Path -LiteralPath $absentMarker -PathType Leaf) {
      Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    }
  }

  foreach ($relative in $Deletes) {
    $target = Join-Path $project $relative
    $saved = Join-Path $backup (Join-Path "deleted" $relative)
    if (Test-Path -LiteralPath $saved -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $saved -Destination $target -Force
    }
  }

  Write-Host "Project restored." -ForegroundColor Green
}

try {
  if (!(Test-Path -LiteralPath $project -PathType Container)) {
    throw "Project not found: $project"
  }
  if (!(Test-Path -LiteralPath $patch -PathType Container)) {
    throw "PATCH folder not found: $patch"
  }
  if (!(Test-Path -LiteralPath $filesList -PathType Leaf)) {
    throw "CHANGED-FILES.txt not found"
  }

  $files = @(Get-Content -LiteralPath $filesList -Encoding UTF8 | Where-Object { $_.Trim() })
  $deletes = @()
  if (Test-Path -LiteralPath $deleteList -PathType Leaf) {
    $deletes = @(Get-Content -LiteralPath $deleteList -Encoding UTF8 | Where-Object { $_.Trim() })
  }

  foreach ($relative in $files) {
    if (!(Test-Path -LiteralPath (Join-Path $patch $relative) -PathType Leaf)) {
      throw "Patch file missing: $relative"
    }
  }

  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Stop-BurgerNodeProcesses

  Write-Host ""
  Write-Host "Installing final security and release closeout..." -ForegroundColor Cyan
  Write-Host "Files: $($files.Count)" -ForegroundColor Cyan
  Write-Host "Deletes: $($deletes.Count)" -ForegroundColor Cyan

  foreach ($relative in $files) {
    $source = Join-Path $patch $relative
    $target = Join-Path $project $relative
    $saved = Join-Path $backup (Join-Path "files" $relative)

    New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      Copy-Item -LiteralPath $target -Destination $saved -Force
    }
    else {
      New-Item -ItemType File -Path "$saved.absent" -Force | Out-Null
    }

    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Installed: $relative" -ForegroundColor Green
  }

  foreach ($relative in $deletes) {
    $target = Join-Path $project $relative
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      $saved = Join-Path $backup (Join-Path "deleted" $relative)
      New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $saved -Force
      Remove-Item -LiteralPath $target -Force
      Write-Host "Deleted: $relative" -ForegroundColor Yellow
    }
  }

  Import-LocalEnvironment (Join-Path $project ".env.local")
  $env:NPM_CONFIG_REGISTRY = $registry
  Set-Location $project

  Remove-Item -LiteralPath (Join-Path $project ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $project "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  Invoke-Step "1/6 Installing exact dependencies" {
    npm.cmd ci --registry=$registry --no-audit --no-fund
  }
  Invoke-Step "2/6 Generating Prisma Client" {
    npm.cmd run prisma:generate
  }
  Invoke-Step "3/6 Running TypeScript checks" {
    npm.cmd run typecheck
  }
  Invoke-Step "4/6 Running security tests" {
    npm.cmd run security:test
  }
  Invoke-Step "5/6 Running high/critical dependency audit" {
    npm.cmd audit --audit-level=high
  }
  Invoke-Step "6/6 Running production build" {
    npm.cmd run build
  }

  $installed = $true
  Write-Host ""
  Write-Host "FINAL SECURITY AND RELEASE CLOSEOUT INSTALLED" -ForegroundColor Green
  Write-Host "Backup: $backup" -ForegroundColor Cyan
  Write-Host "Run npm.cmd run dev and complete the smoke test before GitHub push." -ForegroundColor Cyan
}
catch {
  Write-Host ""
  Write-Host "INSTALLATION STOPPED" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red

  if (Test-Path -LiteralPath $backup -PathType Container) {
    try {
      $files = @(Get-Content -LiteralPath $filesList -Encoding UTF8 | Where-Object { $_.Trim() })
      $deletes = @()
      if (Test-Path -LiteralPath $deleteList -PathType Leaf) {
        $deletes = @(Get-Content -LiteralPath $deleteList -Encoding UTF8 | Where-Object { $_.Trim() })
      }
      Restore-Project $files $deletes
    }
    catch {
      Write-Host "Automatic restore failed: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host "Manual backup: $backup" -ForegroundColor Yellow
    }
  }

  exit 1
}
