$ErrorActionPreference = "Stop"

$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stage = Join-Path (Split-Path $project) "burger-secure-release-$timestamp"
$zip = "$stage.zip"
$registry = "https://registry.npmjs.org/"

function Stop-OnExitCode {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
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

  foreach ($segment in $segments) {
    if ($segment -in @(
      ".git", ".next", "node_modules", "data",
      ".burger-brothers-fallback-snapshots"
    )) { return $true }
  }

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

if (!(Test-Path -LiteralPath (Join-Path $project "package.json"))) {
  throw "Project package.json not found: $project"
}

Set-Location $project
$env:NPM_CONFIG_REGISTRY = $registry

Write-Host "1/7 Installing exact dependencies..." -ForegroundColor Cyan
npm.cmd ci --registry=$registry --no-audit --no-fund
Stop-OnExitCode "npm ci"

Write-Host "2/7 Generating Prisma Client..." -ForegroundColor Cyan
npm.cmd run prisma:generate
Stop-OnExitCode "prisma generate"

Write-Host "3/7 Running TypeScript checks..." -ForegroundColor Cyan
npm.cmd run typecheck
Stop-OnExitCode "typecheck"

Write-Host "4/7 Running security tests..." -ForegroundColor Cyan
npm.cmd run security:test
Stop-OnExitCode "security tests"

Write-Host "5/7 Running high/critical audit..." -ForegroundColor Cyan
npm.cmd audit --audit-level=high
Stop-OnExitCode "npm audit"

Write-Host "6/7 Running production build..." -ForegroundColor Cyan
npm.cmd run build
Stop-OnExitCode "production build"

Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$topFiles = @(
  ".env.example", ".gitignore", "middleware.ts", "next.config.mjs",
  "package.json", "package-lock.json", "postcss.config.cjs",
  "tailwind.config.ts", "tailwind.config.js", "tsconfig.json",
  "next-env.d.ts", "server.js"
)

foreach ($relative in $topFiles) {
  $full = Join-Path $project $relative
  if (Test-Path -LiteralPath $full -PathType Leaf) { Copy-AllowedFile $full }
}

$includeDirectories = @(
  "app", "components", "config", "i18n", "lib", "public", "tools",
  "print-agent", "print-proxy", "prisma/migrations"
)

foreach ($relativeDirectory in $includeDirectories) {
  $directory = Join-Path $project ($relativeDirectory -replace "/", "\")
  if (!(Test-Path -LiteralPath $directory -PathType Container)) { continue }

  Get-ChildItem -LiteralPath $directory -Recurse -File -Force |
    ForEach-Object { Copy-AllowedFile $_.FullName }
}

$schema = Join-Path $project "prisma\schema.prisma"
if (Test-Path -LiteralPath $schema -PathType Leaf) { Copy-AllowedFile $schema }

Write-Host "7/7 Scanning staged release..." -ForegroundColor Cyan
node.exe (Join-Path $project "tools\release-security-tests.mjs") $stage
Stop-OnExitCode "release secret scan"

$manifest = @()
Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($stage.Length).TrimStart("\") -replace "\\", "/"
  $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
  $manifest += "$($hash.Hash)  $relative"
}
$manifest | Sort-Object | Set-Content -LiteralPath (Join-Path $stage "SHA256SUMS.txt") -Encoding UTF8

Compress-Archive -Path "$stage\*" -DestinationPath $zip -CompressionLevel Optimal -Force
$zipHash = Get-FileHash -LiteralPath $zip -Algorithm SHA256

Write-Host ""
Write-Host "SECURE RELEASE READY" -ForegroundColor Green
Write-Host "ZIP: $zip" -ForegroundColor Cyan
Write-Host "SHA-256: $($zipHash.Hash)" -ForegroundColor Cyan
Write-Host "Secrets, DB files, private keys, snapshots, .next and node_modules were excluded." -ForegroundColor Green
