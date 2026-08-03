[CmdletBinding()]
param(
  [string]$ProjectRoot = "C:\Web\burger",
  [string]$WorkspaceRoot = "C:\Web\burger-mobile-build",
  [string]$KeyStorePath = "$env:USERPROFILE\BurgerBrothersKeys\burger-brothers-mobile-release.keystore",
  [string]$KeyAlias = "burger-brothers-mobile",
  [string]$VersionName = "1.0.0",
  [int]$VersionCode = 1,
  [ValidateSet("all", "burger-brothers", "bb-schnell", "bb-driver")]
  [string]$App = "all",
  [string]$BubblewrapVersion = "1.24.1",
  [switch]$SkipBubblewrapInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Plain([Security.SecureString]$Value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Require([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Required command not found: $Name" }
  return $cmd.Source
}
function RequireCmdShim([string]$Name) {
  $cmd = Get-Command "$Name.cmd" -ErrorAction SilentlyContinue
  if (-not $cmd) { $cmd = Get-Command "$Name.exe" -ErrorAction SilentlyContinue }
  if (-not $cmd) { throw "Required Windows command shim not found: $Name.cmd" }
  return $cmd.Source
}
function KeytoolPath {
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if ($env:JAVA_HOME) {
    $candidate = Join-Path $env:JAVA_HOME "bin\keytool.exe"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "keytool was not found. Install JDK 17, restart PowerShell, then run this script again."
}
function Fingerprint([string]$Keytool, [string]$Store, [string]$Alias, [string]$Password) {
  $output = & $Keytool -list -v -keystore $Store -alias $Alias -storepass $Password 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Could not read keystore. Check alias and password.`n$output" }
  $match = [regex]::Match(($output | Out-String), "SHA256:\s*([0-9A-Fa-f:]{95})")
  if (-not $match.Success) { throw "SHA-256 certificate fingerprint was not found." }
  return $match.Groups[1].Value.ToUpperInvariant()
}
function WriteUtf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Text, $encoding)
}
function Set-GradleLowMemoryConfig([string]$Workspace) {
  $propertiesPath = Join-Path $Workspace "gradle.properties"
  $managed = [ordered]@{
    "org.gradle.jvmargs" = "-Xmx768m -XX:MaxMetaspaceSize=384m -Dfile.encoding=UTF-8"
    "org.gradle.daemon" = "false"
    "org.gradle.parallel" = "false"
    "org.gradle.workers.max" = "1"
    "kotlin.daemon.jvmargs" = "-Xmx256m"
  }

  $kept = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $propertiesPath) {
    foreach ($line in Get-Content -LiteralPath $propertiesPath) {
      $trimmed = $line.Trim()
      $isManaged = $false
      foreach ($key in $managed.Keys) {
        if ($trimmed -match ("^" + [regex]::Escape($key) + "\s*=")) {
          $isManaged = $true
          break
        }
      }
      if (-not $isManaged) { $kept.Add($line) }
    }
  }

  if ($kept.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($kept[$kept.Count - 1])) {
    $kept.Add("")
  }
  $kept.Add("# Burger Brothers low-memory Windows build settings")
  foreach ($entry in $managed.GetEnumerator()) {
    $kept.Add("$($entry.Key)=$($entry.Value)")
  }
  WriteUtf8NoBom $propertiesPath (($kept -join "`r`n") + "`r`n")
  Write-Host "Gradle memory limited to 768 MB for this build." -ForegroundColor Yellow
}

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$WorkspaceRoot = [IO.Path]::GetFullPath($WorkspaceRoot)
$KeyStorePath = [IO.Path]::GetFullPath($KeyStorePath)

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json"))) {
  throw "Burger Brothers project was not found: $ProjectRoot"
}

Step "Checking Node, npm and Java"
Require "node" | Out-Null
$npmCommand = RequireCmdShim "npm"
$keytool = KeytoolPath

if (-not (Get-Command bubblewrap -ErrorAction SilentlyContinue)) {
  if ($SkipBubblewrapInstall) { throw "Bubblewrap is not installed." }
  Step "Installing Bubblewrap $BubblewrapVersion"
  & $npmCommand install --global "@bubblewrap/cli@$BubblewrapVersion"
  $npmExitCode = $LASTEXITCODE
  if ($npmExitCode -ne 0) { throw "Bubblewrap installation failed with exit code $npmExitCode." }
}
$bubblewrapCommand = RequireCmdShim "bubblewrap"

Step "Preparing permanent signing key"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KeyStorePath) | Out-Null
$storePassword = $env:BUBBLEWRAP_KEYSTORE_PASSWORD
$keyPassword = $env:BUBBLEWRAP_KEY_PASSWORD
if ([string]::IsNullOrWhiteSpace($storePassword)) {
  $storePassword = Plain (Read-Host "Permanent keystore password" -AsSecureString)
}
if ([string]::IsNullOrWhiteSpace($keyPassword)) { $keyPassword = $storePassword }
if ($storePassword.Length -lt 8) { throw "Keystore password must contain at least 8 characters." }

if (-not (Test-Path -LiteralPath $KeyStorePath)) {
  & $keytool -genkeypair -v -keystore $KeyStorePath -storepass $storePassword -keypass $keyPassword `
    -alias $KeyAlias -keyalg RSA -keysize 4096 -validity 10000 `
    -dname "CN=Burger Brothers Berlin, OU=Mobile, O=Burger Brothers Berlin, L=Berlin, ST=Berlin, C=DE"
  if ($LASTEXITCODE -ne 0) { throw "Keystore creation failed." }
}

$fingerprint = Fingerprint $keytool $KeyStorePath $KeyAlias $storePassword
Write-Host "Certificate SHA-256: $fingerprint" -ForegroundColor Green

$definitions = @(
  [ordered]@{ slug="burger-brothers"; packageId="berlin.burgerbrothers.app"; apk="burger-brothers.apk" },
  [ordered]@{ slug="bb-schnell"; packageId="berlin.burgerbrothers.schnell"; apk="bb-schnell.apk" },
  [ordered]@{ slug="bb-driver"; packageId="berlin.burgerbrothers.driver"; apk="bb-driver.apk" }
)
if ($App -ne "all") { $definitions = @($definitions | Where-Object { $_.slug -eq $App }) }

$env:BUBBLEWRAP_KEYSTORE_PASSWORD = $storePassword
$env:BUBBLEWRAP_KEY_PASSWORD = $keyPassword
try {
  foreach ($definition in $definitions) {
    $slug = [string]$definition.slug
    Step "Building $slug"
    $templatePath = Join-Path $ProjectRoot "mobile\android\$slug\twa-manifest.template.json"
    if (-not (Test-Path -LiteralPath $templatePath)) { throw "Template not found: $templatePath" }

    $workspace = Join-Path $WorkspaceRoot $slug
    New-Item -ItemType Directory -Force -Path $workspace | Out-Null
    $manifestPath = Join-Path $workspace "twa-manifest.json"

    $manifest = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json
    $manifest.signingKey.path = $KeyStorePath
    $manifest.signingKey.alias = $KeyAlias
    $manifest.appVersionName = $VersionName
    $manifest.appVersion = $VersionName
    $manifest.appVersionCode = $VersionCode
    $manifest.fingerprints = @([ordered]@{ name="Burger Brothers sideload release"; value=$fingerprint })
    WriteUtf8NoBom $manifestPath ($manifest | ConvertTo-Json -Depth 30)

    Push-Location $workspace
    try {
      & $bubblewrapCommand update --skipVersionUpgrade --manifest $manifestPath
      if ($LASTEXITCODE -ne 0) {
        throw "Bubblewrap update failed for $slug. Complete any JDK/Android SDK setup prompts and run again."
      }

      # Bubblewrap defaults to a 1536 MB Gradle heap. Some shop/office Windows
      # machines have a smaller commit limit or disabled page file, causing the
      # JVM to fail before Gradle can even start. This TWA build is small, so a
      # bounded heap and one worker are sufficient and much more reliable.
      Set-GradleLowMemoryConfig $workspace

      & $bubblewrapCommand build --skipPwaValidation --manifest $manifestPath `
        --signingKeyPath $KeyStorePath --signingKeyAlias $KeyAlias
      if ($LASTEXITCODE -ne 0) { throw "Bubblewrap build failed for $slug." }
    }
    finally { Pop-Location }

    $builtApk = Get-ChildItem -LiteralPath $workspace -Recurse -File -Filter "app-release-signed.apk" |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $builtApk) { throw "Signed APK was not found for $slug." }
    $builtAab = Get-ChildItem -LiteralPath $workspace -Recurse -File -Filter "app-release-bundle.aab" |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1

    $downloadDir = Join-Path $ProjectRoot "public\downloads"
    $releaseDir = Join-Path $ProjectRoot "mobile\android\$slug\releases"
    New-Item -ItemType Directory -Force -Path $downloadDir, $releaseDir | Out-Null
    $publishedApk = Join-Path $downloadDir ([string]$definition.apk)
    Copy-Item -LiteralPath $builtApk.FullName -Destination $publishedApk -Force
    Copy-Item -LiteralPath $builtApk.FullName -Destination (Join-Path $releaseDir "$slug-$VersionName.apk") -Force
    if ($builtAab) { Copy-Item -LiteralPath $builtAab.FullName -Destination (Join-Path $releaseDir "$slug-$VersionName.aab") -Force }

    $hash = (Get-FileHash -LiteralPath $publishedApk -Algorithm SHA256).Hash.ToUpperInvariant()
    $item = Get-Item -LiteralPath $publishedApk
    $release = [ordered]@{
      available=$true; version=$VersionName; versionCode=$VersionCode;
      apkUrl="/downloads/$([string]$definition.apk)"; sha256=$hash; sizeBytes=$item.Length;
      publishedAt=[DateTime]::UtcNow.ToString("o"); minimumAndroid=8; packageId=[string]$definition.packageId
    }
    WriteUtf8NoBom (Join-Path $downloadDir "$slug-version.json") ($release | ConvertTo-Json -Depth 10)
    Write-Host "Published: $publishedApk" -ForegroundColor Green
  }

  Step "Writing Digital Asset Links for all three Android apps"
  $managedPackages = @(
    "berlin.burgerbrothers.app",
    "berlin.burgerbrothers.schnell",
    "berlin.burgerbrothers.driver"
  )
  $wellKnown = Join-Path $ProjectRoot "public\.well-known"
  New-Item -ItemType Directory -Force -Path $wellKnown | Out-Null
  $assetLinksPath = Join-Path $wellKnown "assetlinks.json"
  $relations = @()
  if (Test-Path -LiteralPath $assetLinksPath) {
    try {
      $existing = @(Get-Content -LiteralPath $assetLinksPath -Raw | ConvertFrom-Json)
      $relations += @($existing | Where-Object {
        $packageName = [string]$_.target.package_name
        [string]::IsNullOrWhiteSpace($packageName) -or $managedPackages -notcontains $packageName
      })
    } catch {
      throw "Existing assetlinks.json is invalid JSON. It was not overwritten."
    }
  }
  foreach ($packageId in $managedPackages) {
    $relations += [ordered]@{
      relation=@("delegate_permission/common.handle_all_urls")
      target=[ordered]@{ namespace="android_app"; package_name=$packageId; sha256_cert_fingerprints=@($fingerprint) }
    }
  }
  WriteUtf8NoBom $assetLinksPath ($relations | ConvertTo-Json -Depth 20)

  if ($App -eq "all") {
    $postBuildTest = Join-Path $ProjectRoot "tools\mobile\Test-BB-Mobile-Suite.ps1"
    if (-not (Test-Path -LiteralPath $postBuildTest)) {
      throw "Post-build test script was not found: $postBuildTest"
    }
    & $postBuildTest -ProjectRoot $ProjectRoot -RequirePublishedApks
  }

  Step "Done"
  Write-Host "APK files: $ProjectRoot\public\downloads" -ForegroundColor Green
  Write-Host "Keystore (outside repo): $KeyStorePath" -ForegroundColor Yellow
  Write-Host "Back up the keystore and password. They are required for every future update." -ForegroundColor Yellow
}
finally {
  Remove-Item Env:BUBBLEWRAP_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BUBBLEWRAP_KEY_PASSWORD -ErrorAction SilentlyContinue
  $storePassword = $null
  $keyPassword = $null
}
