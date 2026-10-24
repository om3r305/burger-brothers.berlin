param([switch]$Release)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$android = 'http://schemas.android.com/apk/res/android'
$packages = @{customer='berlin.burgerbrothers.app';driver='berlin.burgerbrothers.driver';schnell='berlin.burgerbrothers.schnell'}
foreach ($flavor in @('customer','driver','schnell')) {
    $variant = "${flavor}Debug"
    $task = 'process' + $variant.Substring(0,1).ToUpperInvariant() + $variant.Substring(1) + 'Manifest'
    [xml]$manifest = Get-Content -Raw -LiteralPath "$root/app/build/intermediates/merged_manifests/$variant/$task/AndroidManifest.xml"
    if ($manifest.manifest.package -ne ($packages[$flavor] + '.webviewdebug')) { throw "$flavor would overwrite a Play app" }
    $app = $manifest.manifest.application
    if ($app.GetAttribute('usesCleartextTraffic',$android) -ne 'false') { throw "$flavor permits HTTP" }
    if ($app.'activity-alias'.GetAttribute('enabled',$android) -ne 'false') { throw "$flavor debug claims production links" }
    if ($Release) {
        $variant = "${flavor}Release"
        $task = 'process' + $variant.Substring(0,1).ToUpperInvariant() + $variant.Substring(1) + 'Manifest'
        [xml]$production = Get-Content -Raw -LiteralPath "$root/app/build/intermediates/merged_manifests/$variant/$task/AndroidManifest.xml"
        if ($production.manifest.package -ne $packages[$flavor]) { throw "$flavor release package changed" }
        if ($production.manifest.application.GetAttribute('debuggable',$android) -eq 'true') { throw "$flavor release is debuggable" }
        if ($flavor -eq 'customer') {
            foreach ($data in $production.manifest.application.'activity-alias'.'intent-filter'.data) {
                if ($data.GetAttribute('pathPrefix',$android) -eq '/') { throw 'Customer release claims Driver/Schnell links' }
            }
        }
    }
    Write-Output "$flavor manifest isolation: PASS"
}
