[CmdletBinding()]
param(
  [string]$ProjectRoot = "C:\Web\burger",
  [string]$RepoRoot = "C:\Web\burger-github",
  [string]$CommitMessage = "feat: add digital showcase dashboard"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$Text) {
  Write-Host "`n==> $Text" -ForegroundColor Cyan
}

$ChangedFiles = @(
  "app\showcase\page.tsx",
  "app\showcase\layout.tsx",
  "app\admin\showcase\page.tsx",
  "app\api\showcase\route.ts",
  "app\api\admin\showcase\route.ts",
  "app\api\admin\showcase\media\route.ts",
  "components\showcase\ShowcasePlayer.tsx",
  "components\showcase\ShowcaseStage.tsx",
  "components\showcase\ShowcaseStage.module.css",
  "lib\showcase\types.ts",
  "lib\showcase\config.ts",
  "lib\showcase\server.ts",
  "lib\server\r2.ts",
  "app\admin\AdminShell.tsx",
  "app\admin\ClientLayout.tsx",
  "components\AdminSidebar.tsx",
  "middleware.ts",
  "package.json",
  "tools\showcase-regression-tests.cjs",
  "docs\SHOWCASE-R2-SETUP.md",
  "SHOWCASE-R2-ENV-EXAMPLE.txt"
)

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
  throw "Project folder not found: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
  throw "GitHub repo folder not found: $RepoRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git") -PathType Container)) {
  throw "The target is not an existing Git repository. git init will not be used: $RepoRoot"
}

Step "Checking source files"
foreach ($Relative in $ChangedFiles) {
  $Source = Join-Path $ProjectRoot $Relative
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Missing source file: $Source"
  }
  if ($Relative -match "(^|\\)(\.env|node_modules|\.next|\.git)(\\|$)") {
    throw "Forbidden path in copy list: $Relative"
  }
}

Step "Copying only Showcase delivery files to the GitHub repo"
foreach ($Relative in $ChangedFiles) {
  $Source = Join-Path $ProjectRoot $Relative
  $Destination = Join-Path $RepoRoot $Relative
  $DestinationDirectory = Split-Path -Parent $Destination
  if (-not (Test-Path -LiteralPath $DestinationDirectory)) {
    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
  Write-Host "  copied $Relative" -ForegroundColor DarkGray
}

Step "Verifying repository and branch"
Push-Location $RepoRoot
try {
  $Branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not read the current Git branch." }
  if ($Branch -ne "main") {
    throw "Current branch is '$Branch'. Expected branch: main"
  }

  if (Test-Path -LiteralPath (Join-Path $RepoRoot ".next")) {
    Remove-Item -LiteralPath (Join-Path $RepoRoot ".next") -Recurse -Force
  }

  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "node_modules"))) {
    Step "Installing locked dependencies"
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
  }

  Step "Running Showcase regression tests"
  & npm.cmd run showcase:test
  if ($LASTEXITCODE -ne 0) { throw "Showcase regression tests failed." }

  Step "Running TypeScript checks"
  & npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed." }

  Step "Running clean production build"
  if (Test-Path -LiteralPath (Join-Path $RepoRoot ".next")) {
    Remove-Item -LiteralPath (Join-Path $RepoRoot ".next") -Recurse -Force
  }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed." }

  Step "Staging only Showcase delivery files"
  & git add -- $ChangedFiles
  if ($LASTEXITCODE -ne 0) { throw "git add failed." }

  & git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host "No staged changes. Nothing to commit." -ForegroundColor Yellow
    exit 0
  }

  Step "Creating commit"
  & git commit -m $CommitMessage
  if ($LASTEXITCODE -ne 0) { throw "git commit failed." }

  Step "Pushing to origin/main"
  & git push origin main
  if ($LASTEXITCODE -ne 0) { throw "git push failed." }

  Write-Host "`nShowcase integration was built, committed and pushed successfully." -ForegroundColor Green
}
finally {
  Pop-Location
}
