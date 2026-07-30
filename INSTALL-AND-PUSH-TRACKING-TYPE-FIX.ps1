$ErrorActionPreference = "Stop"

$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$relativeFile = "app\api\track\[session]\route.ts"
$patchFile = Join-Path $patchRoot $relativeFile
$sourceFile = Join-Path $src $relativeFile
$repoFile = Join-Path $repo $relativeFile
$manifest = Join-Path $src "CHANGED-FILES.txt"
$commitMessage = "security: close legacy APIs and fix tracking types"

function Run-Step {
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

function Is-ForbiddenPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $normalized = ($Path -replace "\\", "/").TrimStart("/")
  $lower = $normalized.ToLowerInvariant()
  $name = [System.IO.Path]::GetFileName($lower)
  $extension = [System.IO.Path]::GetExtension($lower)

  if ($name -eq ".env.example") { return $false }

  return (
    $name -eq ".env" -or
    $name.StartsWith(".env.") -or
    $name -eq "bootstrap.json" -or
    $extension -in @(".pem", ".key", ".crt", ".cer", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".zip", ".zipchunk", ".log") -or
    $lower.StartsWith("data/") -or
    $lower.StartsWith(".next/") -or
    $lower.StartsWith("node_modules/") -or
    $lower.StartsWith(".burger-brothers-fallback-snapshots/") -or
    $lower -eq "print-agent/config.json" -or
    $lower -eq "print-proxy/config.json" -or
    $lower -eq "print-proxy/.env"
  )
}

try {
  if (!(Test-Path -LiteralPath $patchFile -PathType Leaf)) {
    throw "Patch file not found: $patchFile"
  }

  if (!(Test-Path -LiteralPath $src -PathType Container)) {
    throw "Source project not found: $src"
  }

  if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
    throw "Git repository not found: $repo"
  }

  if (!(Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Changed-files manifest not found: $manifest"
  }

  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like "*C:\Web\burger*" -or
        $_.CommandLine -like "*C:\Web\burger-github*"
      )
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  New-Item -ItemType Directory -Path (Split-Path $sourceFile) -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path $repoFile) -Force | Out-Null

  Copy-Item -LiteralPath $patchFile -Destination $sourceFile -Force
  Copy-Item -LiteralPath $patchFile -Destination $repoFile -Force

  Write-Host "Tracking route fixed in source and GitHub folders." -ForegroundColor Green

  $envFile = Join-Path $src ".env.local"
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    foreach ($rawLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
      $line = $rawLine.Trim()
      if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { continue }

      $parts = $line -split "=", 2
      $name = $parts[0].Trim()
      $value = $parts[1].Trim()
      if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") { continue }

      if ((($value.StartsWith('"')) -and ($value.EndsWith('"'))) -or (($value.StartsWith("'")) -and ($value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }

  $env:NPM_CONFIG_REGISTRY = "https://registry.npmjs.org/"
  Set-Location $repo

  Remove-Item -LiteralPath (Join-Path $repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

  Run-Step "1/5 Generating Prisma Client" { npm.cmd run prisma:generate }
  Run-Step "2/5 Running security tests" { npm.cmd run security:test }
  Run-Step "3/5 Running TypeScript checks" { npm.cmd run typecheck }
  Run-Step "4/5 Running npm audit" { npm.cmd audit --audit-level=high }
  Run-Step "5/5 Running production build" { npm.cmd run build }

  $files = @(
    Get-Content -LiteralPath $manifest -Encoding UTF8 |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -and !(Is-ForbiddenPath $_) }
  )

  if ($files.Count -eq 0) {
    throw "No safe changed files were found in the manifest."
  }

  $missing = @(
    $files | Where-Object {
      !(Test-Path -LiteralPath (Join-Path $repo ($_ -replace "/", "\")) -PathType Leaf)
    }
  )

  if ($missing.Count -gt 0) {
    Write-Host "Missing manifest files:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "One or more manifest files are missing."
  }

  git reset | Out-Null
  git add -- $files
  if ($LASTEXITCODE -ne 0) { throw "git add failed." }

  $staged = @(git diff --cached --name-only)
  $unsafe = @($staged | Where-Object { Is-ForbiddenPath $_ })
  if ($unsafe.Count -gt 0) {
    git reset | Out-Null
    throw "Unsafe file detected in staging area: $($unsafe -join ', ')"
  }

  Run-Step "Checking staged changes" { git diff --cached --check }

  Write-Host ""
  Write-Host "Files ready for GitHub:" -ForegroundColor Cyan
  git status --short
  git diff --cached --stat

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "No new changes found." -ForegroundColor Yellow
    exit 0
  }

  Run-Step "Creating commit" { git commit -m $commitMessage }

  $branch = (git branch --show-current).Trim()
  if (!$branch) { throw "No active Git branch found." }

  Run-Step "Pushing to GitHub" { git push -u origin $branch }

  Write-Host ""
  Write-Host "SECURITY CHANGES PUSHED TO GITHUB" -ForegroundColor Green
  Write-Host "Branch: $branch" -ForegroundColor Cyan
  Write-Host "File count: $($files.Count)" -ForegroundColor Cyan
}
catch {
  Write-Host ""
  Write-Host "PROCESS STOPPED" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Commit and push were not performed." -ForegroundColor Yellow
  exit 1
}
