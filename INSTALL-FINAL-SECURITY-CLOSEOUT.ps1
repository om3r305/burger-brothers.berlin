$ErrorActionPreference = "Stop"

$project = "C:\Web\burger"
$patchRoot = Join-Path $PSScriptRoot "PATCH"
$changedListPath = Join-Path $PSScriptRoot "CHANGED-FILES.txt"
$deleteListPath = Join-Path $PSScriptRoot "DELETE-FILES.txt"
$hashListPath = Join-Path $PSScriptRoot "PATCH-SHA256SUMS.txt"
$registry = "https://registry.npmjs.org/"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = "C:\Web\burger-security-closeout-backup-$timestamp"
$backupFiles = Join-Path $backupRoot "FILES"

$changedFiles = @()
$deletedFiles = @()
$allTargetFiles = @()
$originallyMissing = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)

function Invoke-ExternalStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host ""
  Write-Host $Name -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed. Exit code: $LASTEXITCODE"
  }
  Write-Host "$Name completed." -ForegroundColor Green
}

function Stop-ProjectNodeProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like "*C:\Web\burger*" -or
        $_.CommandLine -like "*C:\Web\burger-github*"
      )
    } |
    ForEach-Object {
      Write-Host "Stopping Node process: $($_.ProcessId)" -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Load-ProcessEnvironment {
  param([string]$EnvFile)

  if (!(Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    Write-Host ".env.local was not found. Existing process environment will be used." -ForegroundColor Yellow
    return
  }

  $loaded = 0
  foreach ($rawLine in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
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
    $loaded += 1
  }

  Write-Host "Environment values loaded into this process: $loaded" -ForegroundColor Green
}

function Restore-ProjectFiles {
  Write-Host ""
  Write-Host "Restoring project files from backup..." -ForegroundColor Yellow

  foreach ($relative in $allTargetFiles) {
    $windowsRelative = $relative -replace "/", "\"
    $target = Join-Path $project $windowsRelative
    $backup = Join-Path $backupFiles $windowsRelative

    Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue

    if (Test-Path -LiteralPath $backup -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $backup -Destination $target -Force
    }
  }

  Write-Host "Project source rollback completed." -ForegroundColor Green
}

try {
  if (!(Test-Path -LiteralPath $project -PathType Container)) {
    throw "Project folder not found: $project"
  }
  if (!(Test-Path -LiteralPath (Join-Path $project "package.json") -PathType Leaf)) {
    throw "Project package.json not found."
  }
  foreach ($required in @($patchRoot, $changedListPath, $deleteListPath, $hashListPath)) {
    if (!(Test-Path -LiteralPath $required)) {
      throw "Delivery file not found: $required"
    }
  }

  $changedFiles = @(Get-Content -LiteralPath $changedListPath -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $deletedFiles = @(Get-Content -LiteralPath $deleteListPath -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $allTargetFiles = @($changedFiles + $deletedFiles | Sort-Object -Unique)

  if ($changedFiles.Count -eq 0) {
    throw "Changed file manifest is empty."
  }

  $expectedHashes = @{}
  foreach ($line in Get-Content -LiteralPath $hashListPath -Encoding UTF8) {
    if ($line -match '^([A-Fa-f0-9]{64})\s{2}(.+)$') {
      $expectedHashes[$Matches[2]] = $Matches[1].ToUpperInvariant()
    }
  }

  foreach ($relative in $changedFiles) {
    $patchFile = Join-Path $patchRoot ($relative -replace "/", "\")
    if (!(Test-Path -LiteralPath $patchFile -PathType Leaf)) {
      throw "Patch file not found: $relative"
    }
    if (!$expectedHashes.ContainsKey($relative)) {
      throw "Patch hash is missing: $relative"
    }
    $actualHash = (Get-FileHash -LiteralPath $patchFile -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHashes[$relative]) {
      throw "Patch hash mismatch: $relative"
    }
  }

  Stop-ProjectNodeProcesses

  New-Item -ItemType Directory -Path $backupFiles -Force | Out-Null
  foreach ($relative in $allTargetFiles) {
    $windowsRelative = $relative -replace "/", "\"
    $target = Join-Path $project $windowsRelative
    $backup = Join-Path $backupFiles $windowsRelative

    if (Test-Path -LiteralPath $target -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $backup) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $backup -Force
    } else {
      [void]$originallyMissing.Add($relative)
    }
  }

  Write-Host ""
  Write-Host "Applying final security closeout patch..." -ForegroundColor Cyan
  foreach ($relative in $changedFiles) {
    $windowsRelative = $relative -replace "/", "\"
    $source = Join-Path $patchRoot $windowsRelative
    $target = Join-Path $project $windowsRelative
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Applied: $relative" -ForegroundColor Green
  }

  foreach ($relative in $deletedFiles) {
    $target = Join-Path $project ($relative -replace "/", "\")
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
      Write-Host "Removed: $relative" -ForegroundColor Yellow
    }
  }

  Load-ProcessEnvironment -EnvFile (Join-Path $project ".env.local")
  $env:NPM_CONFIG_REGISTRY = $registry
  Set-Location $project

  Remove-Item -LiteralPath (Join-Path $project ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $project "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  Invoke-ExternalStep -Name "1/6 Installing exact dependencies" -Action {
    npm.cmd ci --registry=$registry --no-audit --no-fund
  }
  Invoke-ExternalStep -Name "2/6 Generating Prisma Client" -Action {
    npm.cmd run prisma:generate
  }
  Invoke-ExternalStep -Name "3/6 Running security tests" -Action {
    npm.cmd run security:test
  }
  Invoke-ExternalStep -Name "4/6 Running TypeScript checks" -Action {
    npm.cmd run typecheck
  }
  Invoke-ExternalStep -Name "5/6 Running high and critical npm audit" -Action {
    npm.cmd audit --audit-level=high
  }
  Invoke-ExternalStep -Name "6/6 Running production build" -Action {
    npm.cmd run build
  }

  Write-Host ""
  Write-Host "============================================================" -ForegroundColor DarkGray
  Write-Host "FINAL SECURITY CLOSEOUT INSTALLED SUCCESSFULLY" -ForegroundColor Green
  Write-Host "Changed or added files: $($changedFiles.Count)" -ForegroundColor Cyan
  Write-Host "Deleted files: $($deletedFiles.Count)" -ForegroundColor Cyan
  Write-Host "Backup: $backupRoot" -ForegroundColor Cyan
  Write-Host "Secrets and environment files were not copied." -ForegroundColor Green
}
catch {
  $message = $_.Exception.Message
  try {
    if ($allTargetFiles.Count -gt 0 -and (Test-Path -LiteralPath $backupRoot)) {
      Restore-ProjectFiles
    }
  } catch {
    Write-Host "Automatic rollback also failed: $($_.Exception.Message)" -ForegroundColor Red
  }

  Write-Host ""
  Write-Host "INSTALLATION STOPPED" -ForegroundColor Red
  Write-Host $message -ForegroundColor Red
  Write-Host "No Git operation was performed." -ForegroundColor Yellow
  exit 1
}
