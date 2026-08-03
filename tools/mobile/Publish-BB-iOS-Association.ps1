[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern("^[A-Z0-9]{10}$")][string]$TeamId,
  [string]$ProjectRoot = "C:\Web\burger"
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$details = @(
  [ordered]@{ appIDs=@("$TeamId.berlin.burgerbrothers.app"); components=@([ordered]@{ "/"="/*"; comment="Burger Brothers" }) },
  [ordered]@{ appIDs=@("$TeamId.berlin.burgerbrothers.schnell"); components=@([ordered]@{ "/"="/schnellbestellung/*"; comment="BB Schnell" }) },
  [ordered]@{ appIDs=@("$TeamId.berlin.burgerbrothers.driver"); components=@([ordered]@{ "/"="/driver*"; comment="BB Driver" }) }
)
$data = [ordered]@{ applinks=[ordered]@{ details=$details } }
$dir = Join-Path $ProjectRoot "public\.well-known"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$encoding = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $dir "apple-app-site-association"), ($data | ConvertTo-Json -Depth 20), $encoding)
Write-Host "apple-app-site-association was generated for all three iOS apps." -ForegroundColor Green
