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
    $permissions = @($manifest.manifest.'uses-permission' | ForEach-Object { $_.GetAttribute('name',$android) })
    if ($permissions -contains 'android.permission.ACCESS_BACKGROUND_LOCATION') { throw "$flavor requests unrestricted background location" }
    $services = @($app.service | ForEach-Object { $_.GetAttribute('name',$android) })
    if (-not ($services -contains 'berlin.burgerbrothers.shell.BurgerMessagingService')) { throw "$flavor missing native messaging" }
    $hasDriverService = $services -contains 'berlin.burgerbrothers.shell.DriverRouteService'
    if ($hasDriverService -ne ($flavor -eq 'driver')) { throw "$flavor has incorrect route-service scope" }
    if ($Release) {
        $variant = "${flavor}Release"
        $task = 'process' + $variant.Substring(0,1).ToUpperInvariant() + $variant.Substring(1) + 'Manifest'
        [xml]$production = Get-Content -Raw -LiteralPath "$root/app/build/intermediates/merged_manifests/$variant/$task/AndroidManifest.xml"
        $plan = Get-Content -Raw -LiteralPath "$root/play-release-plan.json" | ConvertFrom-Json
        $entry = $plan.applications.$flavor
        if (-not $entry) { throw "Missing release plan for $flavor" }
        if ([int]$production.manifest.GetAttribute('versionCode',$android) -le [int]$entry.observedMaxVersionCode) { throw "$flavor release version is already used" }
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
