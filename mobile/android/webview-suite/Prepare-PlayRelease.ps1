param(
    [string]$JavaHome=$env:JAVA_HOME,
    [string]$AndroidSdk=$env:ANDROID_HOME,
    [string]$KeyDirectory=(Join-Path $env:USERPROFILE 'BurgerBrothersKeys'),
    [switch]$Unsigned
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'JdkTools.ps1')
$plan=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'play-release-plan.json') -Raw | ConvertFrom-Json
$previous=@{}
function Set-TemporaryEnvironment([string]$Name,[string]$Value){
    if(-not $previous.ContainsKey($Name)){$previous[$Name]=[Environment]::GetEnvironmentVariable($Name,'Process')}
    [Environment]::SetEnvironmentVariable($Name,$Value,'Process')
}
function Read-SecretText([string]$Prompt){
    $secret=Read-Host $Prompt -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
}
Push-Location $PSScriptRoot
try {
    if(-not $Unsigned){
        foreach($kind in @('customer','driver','schnell')){
            $app=$plan.applications.$kind
            if($app.uploadSha256 -notmatch '^([0-9A-F]{2}:){31}[0-9A-F]{2}$'){throw "Verify the Play upload certificate for $kind before signing."}
            $store=Join-Path $KeyDirectory $app.keyFile
            if(-not(Test-Path -LiteralPath $store)){throw "Existing upload keystore missing: $kind. No key will be generated."}
            $prefix='BB_'+$kind.ToUpperInvariant()+'_'
            $storePassword=[Environment]::GetEnvironmentVariable($prefix+'KEYSTORE_PASSWORD')
            if(-not $storePassword){$storePassword=Read-SecretText "$kind upload keystore password (never enter in chat)"}
            $keyPassword=[Environment]::GetEnvironmentVariable($prefix+'KEY_PASSWORD')
            if(-not $keyPassword){$keyPassword=$storePassword}
            Set-TemporaryEnvironment ($prefix+'KEYSTORE_PATH') $store
            Set-TemporaryEnvironment ($prefix+'KEY_ALIAS') $app.keyAlias
            Set-TemporaryEnvironment ($prefix+'KEYSTORE_PASSWORD') $storePassword
            Set-TemporaryEnvironment ($prefix+'KEY_PASSWORD') $keyPassword
            $certificate=Invoke-AndroidJdkTool -Executable "$JavaHome/bin/keytool.exe" -Arguments @('-J-Duser.language=en','-list','-v','-keystore',$store,'-alias',$app.keyAlias,'-storepass:env',($prefix+'KEYSTORE_PASSWORD'))
            if($certificate.ExitCode -ne 0){throw "Could not unlock $kind upload keystore."}
            $match=[regex]::Match($certificate.Output,'SHA256:\s*([0-9A-Fa-f:]{95})')
            if(-not $match.Success -or $match.Groups[1].Value.ToUpperInvariant() -ne $app.uploadSha256){throw "Upload certificate mismatch: $kind. Signing stopped."}
            $storePassword=$null;$keyPassword=$null;$certificate=$null
        }
    }
    & ./Build.ps1 -JavaHome $JavaHome -AndroidSdk $AndroidSdk -UnsignedBundles
    if(-not $Unsigned){
        Set-TemporaryEnvironment 'JAVA_HOME' $JavaHome
        & ./gradlew.bat --no-daemon '-PbbSignRelease=true' bundleRelease
        if($LASTEXITCODE -ne 0){throw 'Signed release build failed.'}
    }
    $destination=Join-Path $PSScriptRoot 'build/play-candidates'
    New-Item -ItemType Directory -Force $destination|Out-Null
    foreach($kind in @('customer','driver','schnell')){
        $app=$plan.applications.$kind
        $source="app/build/outputs/bundle/${kind}Release/app-$kind-release.aab"
        $suffix=if($Unsigned){'UNSIGNED'}else{'SIGNED'}
        $target=Join-Path $destination ("bb-$kind-v$($app.candidateVersionCode)-$suffix.aab")
        Copy-Item -LiteralPath $source -Destination $target
        if(-not $Unsigned){
            $verify=Invoke-AndroidJdkTool -Executable "$JavaHome/bin/jarsigner.exe" -Arguments @('-J-Duser.language=en','-verify',$target)
            if($verify.ExitCode -ne 0 -or $verify.Output -notmatch 'jar verified'){throw "Signature verification failed: $kind"}
            $certificate=Invoke-AndroidJdkTool -Executable "$JavaHome/bin/keytool.exe" -Arguments @('-J-Duser.language=en','-printcert','-jarfile',$target)
            if($certificate.ExitCode -ne 0 -or $certificate.Output -notmatch [regex]::Escape($app.uploadSha256)){throw "AAB upload certificate mismatch: $kind"}
        }
        Get-FileHash -LiteralPath $target -Algorithm SHA256
    }
    Write-Output 'Candidates built locally. No Play upload or production deployment was performed. Runtime/device release checks still apply.'
}finally{
    foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
    Pop-Location
}
