param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [switch]$UnsignedBundles
)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome -or -not (Test-Path -LiteralPath "$JavaHome/bin/java.exe")) { throw 'Set JAVA_HOME to a JDK 17 installation.' }
if (-not $AndroidSdk -or -not (Test-Path -LiteralPath "$AndroidSdk/platforms/android-36")) { throw 'An Android SDK with platform 36 is required.' }
$previousJavaHome = $env:JAVA_HOME
Push-Location $PSScriptRoot
try {
    $env:JAVA_HOME = $JavaHome
    $sdkPath = (Resolve-Path -LiteralPath $AndroidSdk).Path.Replace('\','/')
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'local.properties'), "sdk.dir=$sdkPath`n")
    & ./Test.ps1 -JavaHome $JavaHome
    $tasks = @('assembleDebug','lintCustomerDebug','lintDriverDebug','lintSchnellDebug')
    if ($UnsignedBundles) { $tasks += 'bundleRelease' }
    & ./gradlew.bat --no-daemon @tasks
    if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }
    & ./tests/artifact-smoke.ps1 -Release:$UnsignedBundles
    $artifacts = Join-Path $PSScriptRoot 'build/artifacts'
    New-Item -ItemType Directory -Force $artifacts | Out-Null
    foreach ($flavor in @('customer','driver','schnell')) {
        Copy-Item -LiteralPath "app/build/outputs/apk/$flavor/debug/app-$flavor-debug.apk" -Destination $artifacts
        if ($UnsignedBundles) {
            Copy-Item -LiteralPath "app/build/outputs/bundle/${flavor}Release/app-$flavor-release.aab" -Destination "$artifacts/$flavor-UNSIGNED-NOT-FOR-PLAY.aab"
        }
    }
    Get-ChildItem -LiteralPath $artifacts -File | Get-FileHash -Algorithm SHA256
    Write-Output "Debug APKs: $artifacts. No signing credentials, assetlinks, production settings or Play releases were changed."
} finally {
    $env:JAVA_HOME = $previousJavaHome
    Pop-Location
}
