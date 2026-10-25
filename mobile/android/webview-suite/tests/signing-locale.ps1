param([string]$JavaHome=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(-not $JavaHome -or -not(Test-Path -LiteralPath "$JavaHome/bin/java.exe")){throw 'Set JavaHome to JDK 17.'}
$previous=@{}
function Set-TestEnvironment([string]$Name,[string]$Value){
    if(-not $previous.ContainsKey($Name)){$previous[$Name]=[Environment]::GetEnvironmentVariable($Name,'Process')}
    [Environment]::SetEnvironmentVariable($Name,$Value,'Process')
}
Push-Location $root
try {
    New-Item -ItemType Directory -Force build | Out-Null
    Set-TestEnvironment 'JAVA_HOME' $JavaHome
    # This test must pass without either locale workaround. Restore both on exit.
    Set-TestEnvironment 'JAVA_TOOL_OPTIONS' $null
    Set-TestEnvironment 'JDK_JAVA_OPTIONS' $null
    foreach($kind in @('customer','driver','schnell')){
        $prefix='BB_'+$kind.ToUpperInvariant()+'_'
        Set-TestEnvironment ($prefix+'KEYSTORE_PATH') (Join-Path $root "build/fixture-$kind-NOT-A-KEYSTORE")
        Set-TestEnvironment ($prefix+'KEY_ALIAS') ("fixture-"+$kind)
        Set-TestEnvironment ($prefix+'KEYSTORE_PASSWORD') 'fixture-password-not-real'
        Set-TestEnvironment ($prefix+'KEY_PASSWORD') 'fixture-key-password-not-real'
    }
    $init=Join-Path $root 'build/signing-locale-regression.init.gradle'
    @'
import java.util.Locale

gradle.projectsEvaluated {
    rootProject.tasks.register('verifySigningLocale') {
        doLast {
            assert Locale.getDefault().language == System.getenv('BB_TEST_LANGUAGE')
            def android = rootProject.project(':app').extensions.getByName('android')
            ['customer','driver','schnell'].each { kind ->
                def signing = android.signingConfigs.getByName(kind+'Play')
                assert signing.keyAlias == 'fixture-'+kind
                assert signing.storeFile.name == 'fixture-'+kind+'-NOT-A-KEYSTORE'
                assert signing.storePassword == 'fixture-password-not-real'
                assert signing.keyPassword == 'fixture-key-password-not-real'
                assert android.productFlavors.getByName(kind).signingConfig.name == kind+'Play'
            }
            println 'Signing config locale: PASS ('+Locale.getDefault()+', three flavors, configuration only)'
        }
    }
}
'@ | ForEach-Object { [IO.File]::WriteAllText($init,$_,(New-Object Text.UTF8Encoding $false)) }
    foreach($language in @('en','tr')){
        Set-TestEnvironment 'BB_TEST_LANGUAGE' $language
        $country=if($language -eq 'tr'){'TR'}else{'US'}
        $jvm="-Dorg.gradle.jvmargs=-Xmx2g -Duser.language=$language -Duser.country=$country"
        $log=Join-Path $root "build/signing-locale-$language.log"
        $previousPreference=$ErrorActionPreference
        try {
        $ErrorActionPreference='Continue'
        & ./gradlew.bat --no-daemon $jvm "-Duser.language=$language" "-Duser.country=$country" '-PbbSignRelease=true' --init-script $init verifySigningLocale *> $log
        $exitCode=$LASTEXITCODE
        }finally{$ErrorActionPreference=$previousPreference}
        if($exitCode -ne 0){Get-Content -LiteralPath $log -Tail 22;throw "Signing configuration regression failed for $language; no signing tasks were run."}
        $result=Select-String -LiteralPath $log -SimpleMatch 'Signing config locale: PASS'
        if(-not $result){throw "Missing locale assertion result: $language"}
        $result.Line
    }
    Write-Output 'Signing locale regression: PASS. Dummy credentials only; no keystore read, bundle built or publication attempted.'
}finally{
    foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
    Pop-Location
}
