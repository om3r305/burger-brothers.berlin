$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path $root "DELIVERY-SHA256SUMS.txt"

if (!(Test-Path -LiteralPath $manifest -PathType Leaf)) {
  throw "DELIVERY-SHA256SUMS.txt not found"
}

$failures = @()
foreach ($line in Get-Content -LiteralPath $manifest -Encoding UTF8) {
  $clean = $line.Trim()
  if (!$clean) { continue }

  $parts = $clean -split "\s{2,}", 2
  if ($parts.Count -ne 2) {
    $failures += "Invalid manifest line: $clean"
    continue
  }

  $expected = $parts[0].Trim().ToUpperInvariant()
  $relative = $parts[1].Trim() -replace "/", "\"
  $file = Join-Path $root $relative

  if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
    $failures += "Missing: $relative"
    continue
  }

  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actual -ne $expected) {
    $failures += "Hash mismatch: $relative"
  }
}

if ($failures.Count -gt 0) {
  Write-Host "DELIVERY VERIFICATION FAILED" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "DELIVERY VERIFICATION PASSED" -ForegroundColor Green
