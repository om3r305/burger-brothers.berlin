#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\Web\burger",
    [string]$GitHubRoot = "C:\Web\burger-github"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Manifest = @(
    "components/showcase/ShowcaseStage.module.css",
    "tools/showcase-style-sync-regression-tests.cjs"
)

$ExpectedHashes = @{
    "components/showcase/ShowcaseStage.module.css" = "c760d884484dc1780f06d9c1af522e0d2ed4e1af0ba44379f3af09d937a4893a"
    "tools/showcase-style-sync-regression-tests.cjs" = "e1a3f0afcb34c5700d7d4f4dfdf63df665eced1c9b248fa4043394451595490b"
}

$PayloadBase64 = @'
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
aOFey0zssTXkawn63skxX2cSRXanxHktq9lbZrV0AKDB1Ts1tuosxwynyZ0cT1XmlUOlWrD0zpkeEbJg6J2ZzaUoPfDAiEzaYpO0Jjy7U0KTyoDaCZjxPaqs
4E5ZeE8fQoQpbaF41GHSOzn+SH+tRwhPI2B0d6///E9uDJ6ZAyTyAJIFYeA4TX24Mwt2FdtCnVOOtUd3vCFDz4hOfJ4jsEMB7PcX/wNQSwMEFAAAAAgA8Zn4
XKa/tVqNAgAA+wUAAC4AAAB0b29scy9zaG93Y2FzZS1zdHlsZS1zeW5jLXJlZ3Jlc3Npb24tdGVzdHMuY2pzpVRtT9swEP7eX+FVk0ilKRTGXsQ2aagqGhJs
3bIXoWkqrnNpTRy7nB1Chfrfd3bSkpaifdi3+PFzz/meu4sw2jqWWfaBIdyUEiHqapPCcWa7vXcdEa7n3M0eETzoKQ0HjXHEmaMRYG0sqjRaxwtrR7WED4qv
jdSR579gXWGKudGgne3Syc5MJbgF/50034njU4gLk5YKYlJ6eJb1N/8r7OxdqCIrtXDSaJZxqaKCaqDbHrvvMOazGUoOiAajq9OTs/Nj9vy+4SyvKJytC4c7
6aIDgpadjsxY9CwLmHU2WWgRNVb0enWeq0GSsEmpSs0Lnkov2zCC7A6BddFriY16tsTW7CD30A5yjGQReHoqFbRfRgaVLnu75fIO/lq6FbGahXpQ0kFI9Jvc
6cZzhEKWRSJAUxfa0HABEzRVA1ZAkoCBx2YHm+iwMNeygRBuJVRtvRr5im1MmFK71FS6OU+AjASlYINl5yAkVzugcSW1A9wCZ1wpUwHoLVzMkBpVcFvjH8kO
x6VexSefvvwanCTD8ejb8OLsx8U4+X55Phwnl58H458vx4f9w9f9N4dHRP7jJ9Igi2pDnclBM5O1na1nM0wItS6WWqgyBRsF7sZ8Ub0gnMH9gmMOyCC3MvfT
EahhMpbbrUuarvvm7UlaJfSTsFBgWYamoJr3n1zQvVBszd7R9+ai3eiNi8fN2JR6mJd/uRRe1vIpjOxTTm2tEZ8qrp208gm7vKD3XYGe0h/oPTt61e/362St
1YacCKBTelguLWdRWPAmaslyjjyn+erFbGhzuZ9LlDlLjV1wZhSfSCUxbjXI/4aUmUbd0UmSHLPVm1ljDfM5b4EMoIxIrV6VoThKkp1iScdUxn5Z/wJQSwEC
FAMUAAAACADxmfhc5/g9a40qAACQwwAALAAAAAAAAAAAAAAAgAEAAAAAY29tcG9uZW50cy9zaG93Y2FzZS9TaG93Y2FzZVN0YWdlLm1vZHVsZS5jc3NQSwEC
FAMUAAAACADxmfhcpr+1Wo0CAAD7BQAALgAAAAAAAAAAAAAAgAHXKgAAdG9vbHMvc2hvd2Nhc2Utc3R5bGUtc3luYy1yZWdyZXNzaW9uLXRlc3RzLmNqc1BL
BQYAAAAAAgACALYAAACwLQAAAAA=
'@

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Resolve-ProjectPath([string]$Root, [string]$Relative) {
    Join-Path $Root ($Relative.Replace("/", "\"))
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Restore-ProjectFiles([string]$BackupRoot) {
    foreach ($relative in $Manifest) {
        $backup = Resolve-ProjectPath $BackupRoot $relative
        $target = Resolve-ProjectPath $ProjectRoot $relative

        if (Test-Path -LiteralPath $backup -PathType Leaf) {
            New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
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

$stagePath = Join-Path $ProjectRoot "components\showcase\ShowcaseStage.tsx"
if (-not (Test-Path -LiteralPath $stagePath -PathType Leaf)) {
    throw "ShowcaseStage.tsx bulunamadi."
}

$stageText = Get-Content -LiteralPath $stagePath -Raw
foreach ($token in @("styles.premiumScene", "styles.weatherScene", "styles.specialScene")) {
    if ($stageText.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
        throw "Guncel Final V2 renderer bulunamadi: $token"
    }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workRoot = Join-Path $env:TEMP "burger-showcase-style-sync-$stamp"
$payloadZip = Join-Path $workRoot "payload.zip"
$payloadRoot = Join-Path $workRoot "payload"
$backupRoot = Join-Path $workRoot "project-backup"

New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

try {
    Write-Step "Payload aciliyor ve dogrulaniyor"
    $bytes = [Convert]::FromBase64String(($PayloadBase64 -replace "\s", ""))
    [IO.File]::WriteAllBytes($payloadZip, $bytes)
    Expand-Archive -LiteralPath $payloadZip -DestinationPath $payloadRoot -Force

    foreach ($relative in $Manifest) {
        $source = Resolve-ProjectPath $payloadRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Payload dosyasi eksik: $relative"
        }

        $actual = Get-Sha256 $source
        if ($actual -ne $ExpectedHashes[$relative]) {
            throw "Payload SHA-256 dogrulamasi basarisiz: $relative"
        }
    }

    Write-Step "Mevcut dosyalar yedekleniyor"
    foreach ($relative in $Manifest) {
        $current = Resolve-ProjectPath $ProjectRoot $relative
        $backup = Resolve-ProjectPath $backupRoot $relative

        if (Test-Path -LiteralPath $current -PathType Leaf) {
            New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $current -Destination $backup -Force
        }
    }

    Write-Step "Premium sahne CSS dosyasi uygulanıyor"
    foreach ($relative in $Manifest) {
        $source = Resolve-ProjectPath $payloadRoot $relative
        $target = Resolve-ProjectPath $ProjectRoot $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
        Write-Host "  uygulandi: $relative" -ForegroundColor DarkGray
    }

    Push-Location $ProjectRoot
    try {
        Write-Step "CSS regresyon testi"
        & node "tools\showcase-style-sync-regression-tests.cjs"
        if ($LASTEXITCODE -ne 0) { throw "CSS regresyon testi basarisiz." }

        Write-Step "Temiz production build"
        $nextPath = Join-Path $ProjectRoot ".next"
        if (Test-Path -LiteralPath $nextPath) {
            Remove-Item -LiteralPath $nextPath -Recurse -Force
        }

        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "Production build basarisiz." }
    }
    finally {
        Pop-Location
    }

    Write-Step "Yalniz bu teslimatin dosyalari GitHub klasorune aktariliyor"
    foreach ($relative in $Manifest) {
        $source = Resolve-ProjectPath $ProjectRoot $relative
        $target = Resolve-ProjectPath $GitHubRoot $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
        Write-Host "  senkronlandi: $relative" -ForegroundColor DarkGray
    }

    Push-Location $GitHubRoot
    try {
        Write-Step "main branch kontrolu"
        & git checkout main
        if ($LASTEXITCODE -ne 0) { throw "main branch acilamadi." }

        foreach ($relative in $Manifest) {
            & git add -- $relative
            if ($LASTEXITCODE -ne 0) { throw "git add basarisiz: $relative" }
        }

        $staged = (& git diff --cached --name-only)
        if (-not $staged) {
            throw "GitHub klasorunde staged degisiklik olusmadi. CSS dosyasinin repo ile ayni olup olmadigini kontrol et."
        }

        & git commit -m "fix(showcase): restore premium scene styles"
        if ($LASTEXITCODE -ne 0) { throw "git commit basarisiz." }

        & git push origin main
        if ($LASTEXITCODE -ne 0) { throw "git push basarisiz." }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "TAMAMLANDI KANKAM :)" -ForegroundColor Green
    Write-Host "Premium hava durumu, özel gün, geri sayim, yorum ve bestseller stilleri GitHub'a gonderildi." -ForegroundColor Green
    Write-Host "Vercel deploy bittikten sonra Showcase sayfasinda Ctrl+F5 yap." -ForegroundColor Yellow
}
catch {
    Write-Host ""
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Kaynak proje dosyalari geri yukleniyor..." -ForegroundColor Yellow
    Restore-ProjectFiles $backupRoot
    throw
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
