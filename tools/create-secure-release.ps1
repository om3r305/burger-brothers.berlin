$ErrorActionPreference = "Stop"

$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputRoot = Split-Path $project
$stage = Join-Path $outputRoot "burger-secure-release-$timestamp"
$zip = "$stage.zip"
$registry = "https://registry.npmjs.org/"

function Stop-OnExitCode {
  param([string]$Step)

  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
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

function Test-ForbiddenRelativePath {
  param([string]$RelativePath)

  $normalized = ($RelativePath -replace "\\", "/").TrimStart("/")
  $lower = $normalized.ToLowerInvariant()
  $name = [IO.Path]::GetFileName($lower)
  $extension = [IO.Path]::GetExtension($lower)
  $segments = $lower.Split("/")

  if ($name -eq ".env.example") { return $false }

  if (
    $name -eq ".env" -or
    $name.StartsWith(".env.") -or
    $name -eq "bootstrap.json" -or
    $name -eq "secrets.json" -or
    $name.StartsWith("package-lock.json.registry-backup-")
  ) { return $true }

  if ($extension -in @(
    ".pem", ".key", ".crt", ".cer", ".p12", ".pfx",
    ".db", ".sqlite", ".sqlite3", ".zip", ".zipchunk", ".log"
  )) { return $true }

  if ($segments -contains ".git") { return $true }
  if ($segments -contains ".next") { return $true }
  if ($segments -contains "node_modules") { return $true }
  if ($segments -contains ".burger-brothers-fallback-snapshots") { return $true }

  # Only the project-root runtime data folder is private. public/data is required.
  if ($lower -eq "data" -or $lower.StartsWith("data/")) { return $true }

  if (
    $lower -eq "print-agent/config.json" -or
    $lower -eq "print-proxy/config.json" -or
    $lower -eq "print-proxy/.env"
  ) { return $true }

  return $false
}

function Copy-AllowedFile {
  param([string]$SourceFile)

  $relative = $SourceFile.Substring($project.Length).TrimStart("\")
  if (Test-ForbiddenRelativePath $relative) { return }

  $target = Join-Path $stage $relative
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  Copy-Item -LiteralPath $SourceFile -Destination $target -Force
}

function Assert-RequiredFiles {
  param([string]$Root)

  $required = @(
    "package.json",
    "package-lock.json",
    "prisma\schema.prisma",
    "public\data\streets.json",
    "public\data\route_clusters.json",
    "types\qrcode.d.ts",
    "types\r3f-jsx.d.ts",
    "types\react-dom.d.ts",
    "types\react-three-jsx.d.ts",
    "global.d.ts",
    "vercel.json"
  )

  $missing = @()
  foreach ($relative in $required) {
    if (!(Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
      $missing += $relative
    }
  }

  if ($missing.Count -gt 0) {
    throw "Required release files are missing: $($missing -join ', ')"
  }
}

if (!(Test-Path -LiteralPath (Join-Path $project "package.json") -PathType Leaf)) {
  throw "Project package.json not found: $project"
}

Import-LocalEnvironment (Join-Path $project ".env.local")
$env:NPM_CONFIG_REGISTRY = $registry

Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host "1/9 Building allowlisted release stage..." -ForegroundColor Cyan

$topFiles = @(
  ".env.example", ".gitignore", "middleware.ts", "next.config.mjs",
  "next.config.js", "next.config.ts", "package.json", "package-lock.json",
  "postcss.config.cjs", "postcss.config.js", "tailwind.config.ts",
  "tailwind.config.js", "tsconfig.json", "next-env.d.ts", "server.js",
  "global.d.ts", "vercel.json"
)

foreach ($relative in $topFiles) {
  $full = Join-Path $project $relative
  if (Test-Path -LiteralPath $full -PathType Leaf) { Copy-AllowedFile $full }
}

$includeDirectories = @(
  "app", "components", "config", "i18n", "lib", "public", "tools",
  "print-agent", "print-proxy", "prisma/migrations", "styles", "types", "utils"
)

foreach ($relativeDirectory in $includeDirectories) {
  $directory = Join-Path $project ($relativeDirectory -replace "/", "\")
  if (!(Test-Path -LiteralPath $directory -PathType Container)) { continue }

  Get-ChildItem -LiteralPath $directory -Recurse -File -Force |
    ForEach-Object { Copy-AllowedFile $_.FullName }
}

$schema = Join-Path $project "prisma\schema.prisma"
if (Test-Path -LiteralPath $schema -PathType Leaf) { Copy-AllowedFile $schema }

Assert-RequiredFiles $stage

Set-Location $stage

Write-Host "2/9 Installing exact dependencies in staged release..." -ForegroundColor Cyan
npm.cmd ci --registry=$registry --no-audit --no-fund
Stop-OnExitCode "staged npm ci"

Write-Host "3/9 Generating Prisma Client in staged release..." -ForegroundColor Cyan
npm.cmd run prisma:generate
Stop-OnExitCode "staged prisma generate"

Write-Host "4/9 Running staged TypeScript checks..." -ForegroundColor Cyan
npm.cmd run typecheck
Stop-OnExitCode "staged typecheck"

Write-Host "5/9 Running staged security tests..." -ForegroundColor Cyan
npm.cmd run security:test
Stop-OnExitCode "staged security tests"

Write-Host "6/9 Running staged high/critical audit..." -ForegroundColor Cyan
npm.cmd audit --audit-level=high
Stop-OnExitCode "staged npm audit"

Write-Host "7/9 Running staged production build..." -ForegroundColor Cyan
npm.cmd run build
Stop-OnExitCode "staged production build"

Write-Host "8/9 Removing generated dependencies/build output and scanning artifact..." -ForegroundColor Cyan
Remove-Item -LiteralPath (Join-Path $stage "node_modules") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $stage ".next") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $stage "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

Set-Location $project
node.exe (Join-Path $project "tools\release-security-tests.mjs") $stage
Stop-OnExitCode "release security scan"
Assert-RequiredFiles $stage

Write-Host "9/9 Creating verified checksums and ZIP..." -ForegroundColor Cyan
$manifest = @()
Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($stage.Length).TrimStart("\") -replace "\\", "/"
  $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
  $manifest += "$($hash.Hash)  $relative"
}
$manifest | Sort-Object | Set-Content -LiteralPath (Join-Path $stage "SHA256SUMS.txt") -Encoding UTF8

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $stage,
  $zip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
$zipHash = Get-FileHash -LiteralPath $zip -Algorithm SHA256

Write-Host ""
Write-Host "SECURE RELEASE READY" -ForegroundColor Green
Write-Host "Stage: $stage" -ForegroundColor Cyan
Write-Host "ZIP: $zip" -ForegroundColor Cyan
Write-Host "SHA-256: $($zipHash.Hash)" -ForegroundColor Cyan
Write-Host "The staged artifact itself passed install, Prisma, typecheck, tests, audit and build." -ForegroundColor Green
Write-Host "Secrets, root data, DB files, private keys, snapshots, .next and node_modules were excluded." -ForegroundColor Green
