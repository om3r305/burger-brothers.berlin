$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$patchRoot = Join-Path $PSScriptRoot "PATCH"
$changedListPath = Join-Path $PSScriptRoot "CHANGED-FILES.txt"
$deleteListPath = Join-Path $PSScriptRoot "DELETE-FILES.txt"
$hashListPath = Join-Path $PSScriptRoot "PATCH-SHA256SUMS.txt"
$registry = "https://registry.npmjs.org/"
$commitMessage = "security: finalize middleware payments sessions and release hardening"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = "C:\Web\burger-github-security-closeout-backup-$timestamp"
$backupFiles = Join-Path $backupRoot "FILES"

$changedFiles = @()
$deletedFiles = @()
$allTargetFiles = @()
$commitCreated = $false

$env:GIT_PAGER = "cat"
$env:PAGER = "cat"

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

function Test-ForbiddenGitPath {
  param([string]$RelativePath)

  $normalized = ($RelativePath -replace "\\", "/").TrimStart("/")
  $lower = $normalized.ToLowerInvariant()
  $name = [IO.Path]::GetFileName($lower)
  $extension = [IO.Path]::GetExtension($lower)

  if ($name -eq ".env.example") { return $false }
  if ($name -eq ".env" -or $name.StartsWith(".env.") -or $name -eq "bootstrap.json" -or $name -eq "secrets.json") { return $true }
  if ($extension -in @(".pem", ".key", ".crt", ".cer", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".zip", ".zipchunk", ".log")) { return $true }
  if (
    $lower.StartsWith(".next/") -or
    $lower.StartsWith("node_modules/") -or
    $lower.StartsWith("data/") -or
    $lower.StartsWith(".burger-brothers-fallback-snapshots/") -or
    $lower -eq "print-agent/config.json" -or
    $lower -eq "print-proxy/config.json" -or
    $lower -eq "print-proxy/.env"
  ) { return $true }

  return $false
}

function Restore-RepoFiles {
  Write-Host ""
  Write-Host "Restoring GitHub working tree files from backup..." -ForegroundColor Yellow

  foreach ($relative in $allTargetFiles) {
    $windowsRelative = $relative -replace "/", "\"
    $target = Join-Path $repo $windowsRelative
    $backup = Join-Path $backupFiles $windowsRelative

    Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue

    if (Test-Path -LiteralPath $backup -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $backup -Destination $target -Force
    }
  }

  Set-Location $repo
  git reset | Out-Null
  Write-Host "GitHub working tree rollback completed." -ForegroundColor Green
}

try {
  if (!(Test-Path -LiteralPath $src -PathType Container)) {
    throw "Source project not found: $src"
  }
  if (!(Test-Path -LiteralPath $repo -PathType Container)) {
    throw "GitHub folder not found: $repo"
  }
  if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
    throw "Git repository not found. Git init was not executed."
  }
  foreach ($required in @($patchRoot, $changedListPath, $deleteListPath, $hashListPath)) {
    if (!(Test-Path -LiteralPath $required)) {
      throw "Delivery file not found: $required"
    }
  }

  $changedFiles = @(Get-Content -LiteralPath $changedListPath -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $deletedFiles = @(Get-Content -LiteralPath $deleteListPath -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $allTargetFiles = @($changedFiles + $deletedFiles | Sort-Object -Unique)

  $expectedHashes = @{}
  foreach ($line in Get-Content -LiteralPath $hashListPath -Encoding UTF8) {
    if ($line -match '^([A-Fa-f0-9]{64})\s{2}(.+)$') {
      $expectedHashes[$Matches[2]] = $Matches[1].ToUpperInvariant()
    }
  }

  foreach ($relative in $changedFiles) {
    $sourceFile = Join-Path $src ($relative -replace "/", "\")
    if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
      throw "Installed source file not found: $relative"
    }
    if (!$expectedHashes.ContainsKey($relative)) {
      throw "Expected hash not found: $relative"
    }
    $actualHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHashes[$relative]) {
      throw "Source does not match the installed final patch: $relative. Run the installer first."
    }
  }

  Set-Location $repo
  $preStaged = @(git diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the Git staging area." }
  if ($preStaged.Count -gt 0) {
    Write-Host "Files already staged before this operation:" -ForegroundColor Red
    $preStaged | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "Clear or commit the existing staging area first."
  }

  Stop-ProjectNodeProcesses

  New-Item -ItemType Directory -Path $backupFiles -Force | Out-Null
  foreach ($relative in $allTargetFiles) {
    $windowsRelative = $relative -replace "/", "\"
    $target = Join-Path $repo $windowsRelative
    $backup = Join-Path $backupFiles $windowsRelative

    if (Test-Path -LiteralPath $target -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $backup) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $backup -Force
    }
  }

  Write-Host ""
  Write-Host "Copying final security closeout files to the GitHub folder..." -ForegroundColor Cyan
  foreach ($relative in $changedFiles) {
    $windowsRelative = $relative -replace "/", "\"
    $source = Join-Path $src $windowsRelative
    $target = Join-Path $repo $windowsRelative
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Copied: $relative" -ForegroundColor Green
  }

  foreach ($relative in $deletedFiles) {
    $target = Join-Path $repo ($relative -replace "/", "\")
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
      Write-Host "Removed: $relative" -ForegroundColor Yellow
    }
  }

  Load-ProcessEnvironment -EnvFile (Join-Path $src ".env.local")
  $env:NPM_CONFIG_REGISTRY = $registry
  Set-Location $repo

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

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

  git reset | Out-Null
  $gitPaths = @($allTargetFiles)
  $gitAddArgs = @("add", "-A", "--") + $gitPaths
  & git @gitAddArgs
  if ($LASTEXITCODE -ne 0) { throw "git add failed." }

  $allowed = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($relative in $allTargetFiles) { [void]$allowed.Add(($relative -replace "\\", "/")) }

  $stagedFiles = @(git diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect staged files." }

  foreach ($relative in $stagedFiles) {
    $normalized = $relative -replace "\\", "/"
    if (!$allowed.Contains($normalized)) {
      throw "Unexpected staged file: $normalized"
    }
    if (Test-ForbiddenGitPath $normalized) {
      throw "Forbidden staged file: $normalized"
    }
  }

  Invoke-ExternalStep -Name "Checking staged file integrity" -Action {
    git diff --cached --check
  }

  Write-Host ""
  Write-Host "Files ready for GitHub:" -ForegroundColor Cyan
  git -c core.pager=cat status --short
  git -c core.pager=cat diff --cached --stat

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "No new Git changes were found." -ForegroundColor Yellow
    exit 0
  }

  Invoke-ExternalStep -Name "Creating Git commit" -Action {
    git commit -m $commitMessage
  }
  $commitCreated = $true

  $branch = (git branch --show-current).Trim()
  if (!$branch) { throw "No active Git branch was found." }

  Invoke-ExternalStep -Name "Pushing to GitHub" -Action {
    git push -u origin $branch
  }

  Write-Host ""
  Write-Host "============================================================" -ForegroundColor DarkGray
  Write-Host "FINAL SECURITY CLOSEOUT PUSHED TO GITHUB" -ForegroundColor Green
  Write-Host "Branch: $branch" -ForegroundColor Cyan
  Write-Host "Changed or added files: $($changedFiles.Count)" -ForegroundColor Cyan
  Write-Host "Deleted files: $($deletedFiles.Count)" -ForegroundColor Cyan
  Write-Host "Commit: $commitMessage" -ForegroundColor Cyan
  Write-Host "Secrets, environment files, keys and databases were not pushed." -ForegroundColor Green
}
catch {
  $message = $_.Exception.Message

  if (!$commitCreated) {
    try {
      if ($allTargetFiles.Count -gt 0 -and (Test-Path -LiteralPath $backupRoot)) {
        Restore-RepoFiles
      }
    } catch {
      Write-Host "Automatic GitHub-folder rollback also failed: $($_.Exception.Message)" -ForegroundColor Red
    }
  }

  Write-Host ""
  Write-Host "GITHUB PROCESS STOPPED" -ForegroundColor Red
  Write-Host $message -ForegroundColor Red

  if ($commitCreated) {
    $branch = (git branch --show-current).Trim()
    Write-Host "The commit is preserved locally. Retry with:" -ForegroundColor Yellow
    Write-Host "cd `"$repo`"" -ForegroundColor White
    Write-Host "git push -u origin $branch" -ForegroundColor White
  } else {
    Write-Host "Commit and push were not performed." -ForegroundColor Yellow
  }

  exit 1
}
