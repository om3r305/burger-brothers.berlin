param([string]$JavaHome=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'JdkTools.ps1')
$previousOptions=$env:JAVA_TOOL_OPTIONS
try {
    # Harmless, non-secret fixture: both real JDK tools print a stderr notice.
    $env:JAVA_TOOL_OPTIONS='-Dbb.regression.fixture=true'
    foreach($tool in @('keytool','jarsigner')){
        $result=Invoke-AndroidJdkTool -Executable "$JavaHome/bin/$tool.exe" -Arguments @('-J-Duser.language=en','-help')
        if($result.ExitCode -ne 0){throw "$tool help unexpectedly failed"}
        if($result.Output -notmatch 'Picked up JAVA_TOOL_OPTIONS'){throw "$tool did not exercise stderr notice"}
        if($ErrorActionPreference -ne 'Stop'){throw 'ErrorActionPreference was not restored'}
        Write-Output "$tool benign stderr with Stop: PASS"
    }
    $result=Invoke-AndroidJdkTool -Executable "$JavaHome/bin/keytool.exe" -Arguments @('-J-Duser.language=en','-bb-invalid-fixture-command')
    if($result.ExitCode -eq 0){throw 'Real native errors must retain a failing exit code'}
    if($ErrorActionPreference -ne 'Stop'){throw 'ErrorActionPreference was not restored after failure'}
    Write-Output 'JDK output regression: PASS (real stderr notice, native failure exit retained, preference restored; no key read or signing)'
}finally{$env:JAVA_TOOL_OPTIONS=$previousOptions}
