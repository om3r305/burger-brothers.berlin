param([string]$JavaHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome -or -not (Test-Path -LiteralPath "$JavaHome/bin/javac.exe")) { throw 'Set JAVA_HOME to a JDK 17 installation.' }
Push-Location $PSScriptRoot
try {
    $output = Join-Path $PSScriptRoot 'build/policy-tests'
    New-Item -ItemType Directory -Force $output | Out-Null
    & "$JavaHome/bin/javac.exe" -d $output app/src/main/java/berlin/burgerbrothers/shell/NavigationPolicy.java tests/NavigationPolicyTest.java
    if ($LASTEXITCODE -ne 0) { throw 'Navigation test compilation failed.' }
    & "$JavaHome/bin/java.exe" -cp $output berlin.burgerbrothers.shell.NavigationPolicyTest
    if ($LASTEXITCODE -ne 0) { throw 'Navigation policy test failed.' }
} finally { Pop-Location }
