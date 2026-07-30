$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$registry = "https://registry.npmjs.org/"
$commitMessage = "security: finalize release chain legacy driver and coupon generation"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Web\burger-github-backup-final-security-$timestamp"
$commitCreated = $false

$files = @(
  ".env.example",
  ".gitignore",
  "app\admin\coupons\page.tsx",
  "app\api\coupons\route.ts",
  "app\api\payments\session\route.ts",
  "app\api\tv\debug\route.ts",
  "app\driver\[orderId]\page.tsx",
  "app\layout.tsx",
  "lib\orders.ts",
  "middleware.ts",
  "tools\create-secure-release.ps1",
  "tools\middleware-access-tests.cjs",
  "tools\release-security-tests.mjs",
  "tools\security-regression-tests.mjs",
  "tools\security-tests.mjs",
  "public\data\streets.json",
  "public\data\route_clusters.json",
  "types\qrcode.d.ts",
  "types\r3f-jsx.d.ts",
  "types\react-dom.d.ts",
  "types\react-three-jsx.d.ts",
  "global.d.ts",
  "vercel.json",
  "prisma\schema.prisma"
)

$deletes = @(
  "app\DriversSync.tsx"
)

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

function Test-ForbiddenPath {
  param([string]$RelativePath)

  $normalized = ($RelativePath -replace "\\", "/").TrimStart("/")
  $lower = $normalized.ToLowerInvariant()
  $name = [IO.Path]::GetFileName($lower)
  $extension = [IO.Path]::GetExtension($lower)

  if ($name -eq ".env.example") { return $false }
  if ($name -eq ".env" -or $name.StartsWith(".env.")) { return $true }
  if ($name -eq "bootstrap.json" -or $name -eq "secrets.json") { return $true }
  if ($extension -in @(".pem", ".key", ".crt", ".cer", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".zip", ".zipchunk", ".log")) { return $true }
  if ($lower.StartsWith("data/") -or $lower.StartsWith(".burger-brothers-fallback-snapshots/")) { return $true }
  if ($lower.StartsWith(".next/") -or $lower.StartsWith("node_modules/")) { return $true }
  if ($lower -eq "print-agent/config.json" -or $lower -eq "print-proxy/config.json" -or $lower -eq "print-proxy/.env") { return $true }
  return $false
}

function Stop-BurgerNodeProcesses {
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

function Restore-Repo {
  Write-Host ""
  Write-Host "Restoring GitHub working folder..." -ForegroundColor Yellow

  foreach ($relative in $files) {
    $target = Join-Path $repo $relative
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

  foreach ($relative in $deletes) {
    $target = Join-Path $repo $relative
    $saved = Join-Path $backup (Join-Path "deleted" $relative)
    if (Test-Path -LiteralPath $saved -PathType Leaf) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $saved -Destination $target -Force
    }
  }

  Set-Location $repo
  $gitFiles = @($files | ForEach-Object { $_ -replace "\\", "/" })
  $gitDeletes = @($deletes | ForEach-Object { $_ -replace "\\", "/" })
  git reset -- $gitFiles $gitDeletes 2>$null | Out-Null
  Write-Host "GitHub working folder restored." -ForegroundColor Green
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

  foreach ($relative in $files) {
    if (!(Test-Path -LiteralPath (Join-Path $src $relative) -PathType Leaf)) {
      throw "Source file missing: $relative"
    }
    if (Test-ForbiddenPath $relative) {
      throw "Forbidden source path: $relative"
    }
  }

  Set-Location $repo
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Existing staged changes:" -ForegroundColor Red
    $env:GIT_PAGER = "cat"
    git -c core.pager=cat status --short
    throw "The repository already contains staged changes."
  }

  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Stop-BurgerNodeProcesses

  Write-Host ""
  Write-Host "Copying final security and release files..." -ForegroundColor Cyan

  foreach ($relative in $files) {
    $source = Join-Path $src $relative
    $target = Join-Path $repo $relative
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
    Write-Host "Copied: $relative" -ForegroundColor Green
  }

  foreach ($relative in $deletes) {
    $target = Join-Path $repo $relative
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      $saved = Join-Path $backup (Join-Path "deleted" $relative)
      New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $saved -Force
      Remove-Item -LiteralPath $target -Force
      Write-Host "Deleted: $relative" -ForegroundColor Yellow
    }
  }

  Import-LocalEnvironment (Join-Path $src ".env.local")
  $env:NPM_CONFIG_REGISTRY = $registry
  $env:GIT_PAGER = "cat"
  Set-Location $repo

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

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

  $gitFiles = @($files | ForEach-Object { $_ -replace "\\", "/" })
  $gitDeletes = @($deletes | ForEach-Object { $_ -replace "\\", "/" })

$existingGitFiles = @(
  $gitFiles | Where-Object {
    $relative = ($_ -replace "/", "\")
    Test-Path -LiteralPath (Join-Path $repo $relative) -PathType Leaf
  }
)

if ($existingGitFiles.Count -gt 0) {
  git add -- $existingGitFiles

}

$deleteCandidates = @(
  "app/DriversSync.tsx"
)

foreach ($deletePath in $deleteCandidates) {
  git ls-files --error-unmatch -- $deletePath *> $null

  if ($LASTEXITCODE -eq 0) {
    git rm -- $deletePath

    if ($LASTEXITCODE -ne 0) {
      throw "git rm failed for: $deletePath"
    }
  }
  else {
    Write-Host "Delete skipped; path is already absent or untracked: $deletePath" `
      -ForegroundColor DarkGray
  }
}
  if ($LASTEXITCODE -ne 0) { throw "git add failed" }

  $trackedDeletes = @()
  foreach ($relative in $gitDeletes) {
    git ls-files --error-unmatch -- $relative 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $trackedDeletes += $relative }
  }

  if ($trackedDeletes.Count -gt 0) {
    git add -u -- $trackedDeletes
    if ($LASTEXITCODE -ne 0) { throw "git add deletion failed" }
  }

  $stagedFiles = @(git diff --cached --name-only)
  $unsafe = @($stagedFiles | Where-Object { Test-ForbiddenPath $_ })
  if ($unsafe.Count -gt 0) {
    throw "Unsafe staged paths: $($unsafe -join ', ')"
  }

  Invoke-Step "Checking staged file integrity" {
    git diff --cached --check
  }

  Write-Host ""
  Write-Host "Files ready for GitHub:" -ForegroundColor Cyan
  git -c core.pager=cat status --short
  git -c core.pager=cat diff --cached --stat

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "No new changes were found." -ForegroundColor Yellow
    exit 0
  }

  Invoke-Step "Creating Git commit" {
    git commit -m $commitMessage
  }
  $commitCreated = $true

  $branch = (git branch --show-current).Trim()
  if (!$branch) { throw "No active Git branch was found" }

  Invoke-Step "Pushing to GitHub" {
    git push -u origin $branch
  }

  Write-Host ""
  Write-Host "FINAL SECURITY AND RELEASE CLOSEOUT PUSHED TO GITHUB" -ForegroundColor Green
  Write-Host "Branch: $branch" -ForegroundColor Cyan
  Write-Host "Files copied: $($files.Count)" -ForegroundColor Cyan
  Write-Host "Files deleted: $($deletes.Count)" -ForegroundColor Cyan
  Write-Host "Commit: $commitMessage" -ForegroundColor Cyan
  Write-Host "Secrets, environment files, certificates, DB files and runtime data were not pushed." -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "GITHUB PROCESS STOPPED" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red

  if (!$commitCreated -and (Test-Path -LiteralPath $backup -PathType Container)) {
    try { Restore-Repo }
    catch {
      Write-Host "Automatic restore failed: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host "Manual backup: $backup" -ForegroundColor Yellow
    }
  }
  elseif ($commitCreated) {
    Write-Host "The commit is preserved locally. Retry only the push command." -ForegroundColor Yellow
  }

  exit 1
}
