# Capture native stderr as diagnostics, and use the native exit code for success.
# Windows PowerShell 5.1 otherwise turns benign JVM notices into NativeCommandError
# under ErrorActionPreference=Stop, before certificate verification can run.
function Invoke-AndroidJdkTool {
    param([string]$Executable,[string[]]$Arguments)
    if(-not(Test-Path -LiteralPath $Executable -PathType Leaf)){throw 'JDK tool not found.'}
    $previousPreference=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        $output=& $Executable @Arguments 2>&1
        $exitCode=$LASTEXITCODE
    }finally{
        $ErrorActionPreference=$previousPreference
    }
    return [pscustomobject]@{ExitCode=$exitCode;Output=($output|Out-String)}
}
