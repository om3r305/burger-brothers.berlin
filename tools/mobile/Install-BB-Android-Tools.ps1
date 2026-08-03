[CmdletBinding()]
param([string]$BubblewrapVersion = "1.24.1")
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed." }
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { $npmCommand = Get-Command npm.exe -ErrorAction SilentlyContinue }
if (-not $npmCommand) { throw "npm.cmd is not installed or is not available in PATH." }

if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "JDK 17/keytool is missing and winget is unavailable. Install JDK 17 manually."
  }
  Write-Host "Installing Temurin JDK 17..." -ForegroundColor Cyan
  & winget install --id EclipseAdoptium.Temurin.17.JDK -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "JDK 17 installation failed." }
  Write-Host "JDK installed. Close and reopen PowerShell before building." -ForegroundColor Yellow
}

Write-Host "Installing Bubblewrap $BubblewrapVersion..." -ForegroundColor Cyan
& $npmCommand.Source install --global "@bubblewrap/cli@$BubblewrapVersion"
$npmExitCode = $LASTEXITCODE
if ($npmExitCode -ne 0) { throw "Bubblewrap installation failed with exit code $npmExitCode." }

Write-Host "Tool preparation completed. Bubblewrap may download Android SDK components during the first build." -ForegroundColor Green
