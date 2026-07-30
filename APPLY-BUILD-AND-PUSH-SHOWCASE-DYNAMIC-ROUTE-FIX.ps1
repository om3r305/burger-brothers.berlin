#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\Web\burger",
    [string]$GitHubRoot = "C:\Web\burger-github"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Manifest = @(
  "app/showcase/[screen]/page.tsx"
  "app/showcase/page.tsx"
  "app/showcase/layout.tsx"
  "tools/showcase-route-regression-tests.cjs"
)

$ExpectedHashes = @{
  "app/showcase/[screen]/page.tsx" = "5cee09475f56223d26822763c2a00d919857918aa9b92c4bbfa7d2b6d2c70df7"
  "app/showcase/page.tsx" = "9a200ee59ac0f9314d8644e901d5fabe9a1c5755f6a025286ea6a70a525711dc"
  "app/showcase/layout.tsx" = "84a2a24711c0c2e6da7a8d1301e6cb91e68fc1349347cc2c189e08a42f3c4a3d"
  "tools/showcase-route-regression-tests.cjs" = "1fae40d0b339e1933d8da5508a33f043614f5869a99f022783ce55bbc0fd5797"
}

$PayloadBase64 = @'
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
'@

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Resolve-File([string]$Root, [string]$Relative) {
    return [IO.Path]::Combine($Root, $Relative.Replace("/", [IO.Path]::DirectorySeparatorChar))
}

function Ensure-Parent([string]$FilePath) {
    $parent = [IO.Path]::GetDirectoryName($FilePath)
    if ($parent) {
        [IO.Directory]::CreateDirectory($parent) | Out-Null
    }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Restore-Project([string]$BackupRoot) {
    foreach ($relative in $Manifest) {
        $backup = Resolve-File $BackupRoot $relative
        $target = Resolve-File $ProjectRoot $relative

        if (Test-Path -LiteralPath $backup -PathType Leaf) {
            Ensure-Parent $target
            Copy-Item -LiteralPath $backup -Destination $target -Force
        } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
            Remove-Item -LiteralPath $target -Force
        }
    }
}

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")
$GitHubRoot = [IO.Path]::GetFullPath($GitHubRoot).TrimEnd("\")

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Kaynak proje bulunamadi: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json") -PathType Leaf)) {
    throw "package.json bulunamadi: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $GitHubRoot ".git") -PathType Container)) {
    throw "GitHub repo klasoru bulunamadi: $GitHubRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "components\showcase\ShowcasePlayer.tsx") -PathType Leaf)) {
    throw "ShowcasePlayer.tsx bulunamadi. Final V2 kurulumu eksik olabilir."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workRoot = Join-Path $env:TEMP "burger-showcase-route-fix-$stamp"
$payloadZip = Join-Path $workRoot "payload.zip"
$payloadRoot = Join-Path $workRoot "payload"
$backupRoot = Join-Path $workRoot "backup"

[IO.Directory]::CreateDirectory($payloadRoot) | Out-Null
[IO.Directory]::CreateDirectory($backupRoot) | Out-Null

try {
    Write-Step "Route duzeltme payload'i aciliyor"
    $bytes = [Convert]::FromBase64String(($PayloadBase64 -replace "\s", ""))
    [IO.File]::WriteAllBytes($payloadZip, $bytes)
    Expand-Archive -LiteralPath $payloadZip -DestinationPath $payloadRoot -Force

    foreach ($relative in $Manifest) {
        $source = Resolve-File $payloadRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Payload dosyasi eksik: $relative"
        }
        if ((Get-Sha256 $source) -ne $ExpectedHashes[$relative]) {
            throw "SHA-256 dogrulamasi basarisiz: $relative"
        }
    }

    Write-Step "Mevcut route dosyalari yedekleniyor"
    foreach ($relative in $Manifest) {
        $current = Resolve-File $ProjectRoot $relative
        $backup = Resolve-File $backupRoot $relative
        if (Test-Path -LiteralPath $current -PathType Leaf) {
            Ensure-Parent $backup
            Copy-Item -LiteralPath $current -Destination $backup -Force
        }
    }

    Write-Step "/showcase/main dinamik route'u uygulanıyor"
    foreach ($relative in $Manifest) {
        $source = Resolve-File $payloadRoot $relative
        $target = Resolve-File $ProjectRoot $relative
        Ensure-Parent $target
        Copy-Item -LiteralPath $source -Destination $target -Force
        Write-Host "  uygulandi: $relative" -ForegroundColor DarkGray
    }

    Push-Location $ProjectRoot
    try {
        Write-Step "Route regresyon testi"
        & node "tools\showcase-route-regression-tests.cjs"
        if ($LASTEXITCODE -ne 0) {
            throw "Showcase route regresyon testi basarisiz."
        }

        Write-Step "Temiz production build"
        $nextPath = Join-Path $ProjectRoot ".next"
        if (Test-Path -LiteralPath $nextPath) {
            Remove-Item -LiteralPath $nextPath -Recurse -Force
        }

        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            throw "Production build basarisiz."
        }
    }
    finally {
        Pop-Location
    }

    Write-Step "Route dosyalari GitHub repo klasorune aktariliyor"
    foreach ($relative in $Manifest) {
        $source = Resolve-File $ProjectRoot $relative
        $target = Resolve-File $GitHubRoot $relative
        Ensure-Parent $target
        Copy-Item -LiteralPath $source -Destination $target -Force
        Write-Host "  senkronlandi: $relative" -ForegroundColor DarkGray
    }

    Push-Location $GitHubRoot
    try {
        Write-Step "main branch kontrolu"
        & git.exe checkout main
        if ($LASTEXITCODE -ne 0) {
            throw "main branch acilamadi."
        }

        $addArgs = @("add", "--") + $Manifest
        & git.exe @addArgs
        if ($LASTEXITCODE -ne 0) {
            throw "git add basarisiz."
        }

        $staged = @(& git.exe diff --cached --name-only)
        if ($staged.Count -eq 0) {
            throw "Stage edilecek route degisikligi bulunamadi."
        }

        & git.exe commit -m "fix(showcase): deploy dynamic screen routes"
        if ($LASTEXITCODE -ne 0) {
            throw "git commit basarisiz."
        }

        & git.exe push origin main
        if ($LASTEXITCODE -ne 0) {
            throw "git push basarisiz."
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "TAMAMLANDI KANKAM :)" -ForegroundColor Green
    Write-Host "/showcase/main ve diger ekran route'lari GitHub'a gonderildi." -ForegroundColor Green
    Write-Host "Vercel deploy bittikten sonra Ctrl+F5 yap." -ForegroundColor Yellow
}
catch {
    Write-Host ""
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Kaynak proje geri yukleniyor..." -ForegroundColor Yellow
    Restore-Project $backupRoot
    throw
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
