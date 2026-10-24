[CmdletBinding()]
param([string]$ProjectRoot = "")
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
}

function Assert-Check([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FAIL: $Message" }
}
function Read-Links([string]$Path) {
  $parsed = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $parsed
}
function File-Hash([string]$Path) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path))) }
  finally { $sha.Dispose() }
}

# Load only the production functions through the PowerShell AST. Never run the
# build's top-level code (keystore access, Bubblewrap, APK/AAB generation).
$buildPath = Join-Path $ProjectRoot "tools\mobile\Build-BB-Android-Suite.ps1"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($buildPath, [ref]$tokens, [ref]$parseErrors)
Assert-Check ($parseErrors.Count -eq 0) "Build script must parse without errors"
foreach ($name in @("WriteUtf8NoBom", "Update-AndroidAssetLinks")) {
  $functions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  Assert-Check ($functions.Count -eq 1) "Expected one production function: $name"
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
$calls = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "Update-AndroidAssetLinks"
}, $true))
Assert-Check ($calls.Count -eq 1) "Build must call the tested merge function"

$packages = @("berlin.burgerbrothers.app", "berlin.burgerbrothers.schnell", "berlin.burgerbrothers.driver")
$localKey = ((1..32 | ForEach-Object { "AB" }) -join ":")
$playKey = ((1..32 | ForEach-Object { "CD" }) -join ":")
$sourcePath = Join-Path $ProjectRoot "public\.well-known\assetlinks.json"
$sourceHash = File-Hash $sourcePath
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("bb-assetlinks-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  $fixture = Join-Path $testRoot "assetlinks.json"
  Copy-Item -LiteralPath $sourcePath -Destination $fixture
  $before = @(Read-Links $fixture)
  Update-AndroidAssetLinks -Path $fixture -Packages $packages -Fingerprint $localKey
  $after = @(Read-Links $fixture)
  Assert-Check ($after.Count -eq $before.Count) "Existing app relations must not be replaced or duplicated"
  for ($i = 0; $i -lt $before.Count; $i++) {
    foreach ($cert in $before[$i].target.sha256_cert_fingerprints) {
      Assert-Check ($after[$i].target.sha256_cert_fingerprints -contains $cert) "Every existing Play/rotation certificate must survive"
    }
    Assert-Check ($after[$i].target.sha256_cert_fingerprints -contains $localKey) "Local key must be added for each managed app"
  }
  Write-Host "PASS: all existing Play/rotation certificates survive for all three apps"

  $once = Get-Content -LiteralPath $fixture -Raw
  Update-AndroidAssetLinks -Path $fixture -Packages $packages -Fingerprint $localKey.ToLowerInvariant()
  Assert-Check ((Get-Content -LiteralPath $fixture -Raw) -ceq $once) "Repeated merge, including case differences, must be idempotent"
  Write-Host "PASS: repeated builds do not duplicate fingerprints"

  $handle = "delegate_permission/common.handle_all_urls"
  $special = @(
    @{ relation=@("unrelated/relation"); target=@{ namespace="web"; site="https://example.invalid" } },
    @{ relation=@($handle); target=@{ namespace="android_app"; package_name="example.unmanaged"; sha256_cert_fingerprints=@($playKey) } },
    @{ relation=@("delegate_permission/common.get_login_creds"); target=@{ namespace="android_app"; package_name=$packages[0]; sha256_cert_fingerprints=@($playKey) } },
    @{ relation=@($handle, "delegate_permission/common.get_login_creds"); target=@{ namespace="android_app"; package_name=$packages[0]; sha256_cert_fingerprints=@($playKey) } },
    @{ relation=@($handle); target=@{ namespace="android_app"; package_name=$packages[0]; sha256_cert_fingerprints=@($localKey) } }
  )
  WriteUtf8NoBom $fixture (ConvertTo-Json -InputObject $special -Depth 20)
  $originalSpecial = @(Read-Links $fixture)
  Update-AndroidAssetLinks -Path $fixture -Packages $packages -Fingerprint $localKey
  $merged = @(Read-Links $fixture)
  for ($i = 0; $i -lt 3; $i++) {
    Assert-Check ((ConvertTo-Json $originalSpecial[$i] -Depth 20 -Compress) -ceq (ConvertTo-Json $merged[$i] -Depth 20 -Compress)) "Unrelated relation/target must remain unchanged"
  }
  Assert-Check ($merged.Count -eq 7) "Only missing managed handle_all_urls entries should be created"
  Assert-Check ($merged[3].target.sha256_cert_fingerprints -contains $playKey) "Duplicate matching relations retain their original certificates"
  Assert-Check ($merged[3].target.sha256_cert_fingerprints -contains $localKey) "Existing multi-relation entry receives the local key"
  Assert-Check ($merged[3].relation.Count -eq 2) "Additional relations must survive"
  Assert-Check ($merged[4].target.sha256_cert_fingerprints.Count -eq 1) "Existing identical certificate must not be duplicated"
  Write-Host "PASS: unrelated targets, additional relations and duplicate matching entries preserved"

  $newFile = Join-Path $testRoot "new.json"
  Update-AndroidAssetLinks -Path $newFile -Packages $packages -Fingerprint $localKey
  Assert-Check (@(Read-Links $newFile).Count -eq 3) "Missing file must create all managed apps"
  WriteUtf8NoBom $fixture "[]"
  Update-AndroidAssetLinks -Path $fixture -Packages @($packages[0]) -Fingerprint $localKey
  $single = Get-Content -LiteralPath $fixture -Raw
  Assert-Check ($single.TrimStart().StartsWith("[")) "Single app must still serialize as an array"
  Assert-Check (@(Read-Links $fixture).Count -eq 1) "Empty file creates exactly the requested app"
  Write-Host "PASS: missing file, empty array and single-app JSON shape"

  foreach ($invalid in @("{broken", '{"not":"an array"}')) {
    WriteUtf8NoBom $fixture $invalid
    $failed = $false
    try { Update-AndroidAssetLinks -Path $fixture -Packages $packages -Fingerprint $localKey } catch { $failed = $true }
    Assert-Check $failed "Malformed input must fail"
    Assert-Check ((Get-Content -LiteralPath $fixture -Raw) -ceq $invalid) "Malformed input must not be overwritten"
  }
  $newFileBeforeInvalidKey = Get-Content -LiteralPath $newFile -Raw
  $failed = $false
  try { Update-AndroidAssetLinks -Path $newFile -Packages $packages -Fingerprint "not-a-certificate" } catch { $failed = $true }
  Assert-Check $failed "Invalid new SHA-256 must be rejected"
  Assert-Check ((Get-Content -LiteralPath $newFile -Raw) -ceq $newFileBeforeInvalidKey) "Invalid new SHA-256 must leave file byte-for-byte intact"
  Assert-Check ((File-Hash $sourcePath) -eq $sourceHash) "Tests must not modify repository assetlinks.json"
  Write-Host "PASS: invalid input fails without overwriting files; repository file untouched"
} finally {
  Get-ChildItem -LiteralPath $testRoot -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  Remove-Item -LiteralPath $testRoot -Force
}
Write-Host "Android assetlinks certificate preservation regression tests: OK"
