#requires -Version 5.1
<#
Burger Brothers Berlin
Tracking Token + TV Cookie Fix GitHub gönderim scripti

KULLANIM:
1) Bu dosya doğrudan C:\Web\burger içinde bulunmalıdır.
2) Windows PowerShell 5.1 ile çalıştırın:
   Set-ExecutionPolicy -Scope Process Bypass
   cd C:\Web\burger
   .\PUSH-TRACKING-TV-COOKIE-FIX-TO-GITHUB.ps1

Bu script git init çalıştırmaz.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$changedFiles = @(
    "app\api\track\lookup\route.ts",
    "app\api\track\by-order\[orderId]\route.ts",
    "tools\tracking-token-role-regression-tests.cjs",
    "package.json"
)

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host ("==> " + $Message) -ForegroundColor Cyan
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Komut başarısız oldu ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
    }
}

function Import-DotEnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    Write-Host ("Build processine env yükleniyor: " + [System.IO.Path]::GetFileName($Path)) -ForegroundColor DarkGray

    foreach ($rawLine in [System.IO.File]::ReadAllLines($Path)) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            continue
        }

        if ($line.StartsWith("export ")) {
            $line = $line.Substring(7).Trim()
        }

        $separator = $line.IndexOf("=")
        if ($separator -le 0) {
            continue
        }

        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()

        if ($key -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
            continue
        }

        if (
            $value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
}

function Test-TargetIsTracked {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    & git.exe -C $repo ls-files --error-unmatch -- $RelativePath *> $null
    return ($LASTEXITCODE -eq 0)
}

function Restore-TargetFiles {
    Write-Host ""
    Write-Host "Repository hedef dosyaları geri alınıyor..." -ForegroundColor Yellow

    foreach ($relativePath in $changedFiles) {
        $repoPath = Join-Path $repo $relativePath

        if (Test-TargetIsTracked -RelativePath $relativePath) {
            & git.exe -C $repo restore --staged --worktree -- $relativePath *> $null
        } elseif (Test-Path -LiteralPath $repoPath) {
            Remove-Item -LiteralPath $repoPath -Force
        }
    }
}

$scriptRootCandidate = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRootCandidate)) {
    $scriptRootCandidate = (Get-Location).Path
}

$resolvedScriptRoot = [System.IO.Path]::GetFullPath($scriptRootCandidate).TrimEnd("\")
$resolvedSourceRoot = [System.IO.Path]::GetFullPath($src).TrimEnd("\")

if ($resolvedScriptRoot -ne $resolvedSourceRoot) {
    throw "Bu script doğrudan C:\Web\burger içine konulup oradan çalıştırılmalıdır. Bulunan konum: $resolvedScriptRoot"
}

if (-not (Test-Path -LiteralPath $src -PathType Container)) {
    throw "Kaynak proje bulunamadı: $src"
}

if (-not (Test-Path -LiteralPath $repo -PathType Container)) {
    throw "GitHub repository klasörü bulunamadı: $repo"
}

if (-not (Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
    throw "C:\Web\burger-github geçerli bir Git repository değil. git init çalıştırılmayacak."
}

foreach ($relativePath in $changedFiles) {
    $sourcePath = Join-Path $src $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Kaynak dosya eksik: $sourcePath"
    }
}

Write-Step "Aktif Git branch kontrol ediliyor"
$branch = (& git.exe -C $repo rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $branch -or $branch -eq "HEAD") {
    throw "Aktif Git branch belirlenemedi."
}
Write-Host ("Aktif branch: " + $branch) -ForegroundColor Green

Write-Step "Hedef dosyalarda önceden yapılmış değişiklik kontrol ediliyor"
foreach ($relativePath in $changedFiles) {
    $dirty = & git.exe -C $repo status --porcelain -- $relativePath
    if ($LASTEXITCODE -ne 0) {
        throw "Git durum kontrolü başarısız: $relativePath"
    }
    if ($dirty) {
        throw "Repository içinde bu teslimattan önce değişmiş hedef dosya var: $relativePath`nÖnce bu değişikliği commit edin veya güvenli biçimde temizleyin."
    }
}

Write-Step "Yalnız bu teslimattaki dosyalar repository klasörüne kopyalanıyor"
foreach ($relativePath in $changedFiles) {
    $sourcePath = Join-Path $src $relativePath
    $destinationPath = Join-Path $repo $relativePath
    $destinationDirectory = Split-Path -Parent $destinationPath

    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    Write-Host ("Kopyalandı: " + $relativePath) -ForegroundColor DarkGreen
}

Write-Step "Build ortamı hazırlanıyor"
$envFiles = @(
    (Join-Path $src ".env"),
    (Join-Path $src ".env.production"),
    (Join-Path $src ".env.local"),
    (Join-Path $src ".env.production.local")
)
foreach ($envFile in $envFiles) {
    Import-DotEnvFile -Path $envFile
}

[Environment]::SetEnvironmentVariable("CI", "1", "Process")
[Environment]::SetEnvironmentVariable("NODE_ENV", "production", "Process")

$nextPath = Join-Path $repo ".next"
$tsBuildInfoPath = Join-Path $repo "tsconfig.tsbuildinfo"
if (Test-Path -LiteralPath $nextPath) {
    Remove-Item -LiteralPath $nextPath -Recurse -Force
}
if (Test-Path -LiteralPath $tsBuildInfoPath) {
    Remove-Item -LiteralPath $tsBuildInfoPath -Force
}

$validationSucceeded = $false
$locationPushed = $false

try {
    Push-Location $repo
    $locationPushed = $true

    Write-Step "Prisma Client oluşturuluyor"
    Invoke-Native -FilePath "npx.cmd" -Arguments @("prisma", "generate")

    Write-Step "TypeScript/typecheck çalıştırılıyor"
    Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "typecheck")

    Write-Step "Tracking token + TV cookie regresyon testi çalıştırılıyor"
    Invoke-Native -FilePath "node.exe" -Arguments @("tools/tracking-token-role-regression-tests.cjs")

    Write-Step "Payment Center mimari regresyon testi çalıştırılıyor"
    Invoke-Native -FilePath "node.exe" -Arguments @("tools/payment-center-architecture-tests.cjs")

    Write-Step "Tam güvenlik regresyon testleri çalıştırılıyor"
    Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "security:test")

    Write-Step "Temiz production build çalıştırılıyor"
    Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "build")

    $validationSucceeded = $true
}
catch {
    Write-Host ""
    Write-Host "Build/test başarısız. Commit veya push yapılmadı." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Restore-TargetFiles
    throw
}
finally {
    if ($locationPushed) {
        Pop-Location
    }
}

if (-not $validationSucceeded) {
    throw "Doğrulama tamamlanmadı."
}

Write-Step "Yalnız ilgili dosyalar stage ediliyor"
foreach ($relativePath in $changedFiles) {
    Invoke-Native -FilePath "git.exe" -Arguments @("-C", $repo, "add", "--", $relativePath)
}

& git.exe -C $repo diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Gönderilecek yeni Git değişikliği bulunamadı. Commit/push yapılmadı." -ForegroundColor Yellow
    exit 0
}
if ($LASTEXITCODE -ne 1) {
    throw "Staged diff kontrolü başarısız oldu."
}

Write-Step "Staged değişiklik özeti"
Invoke-Native -FilePath "git.exe" -Arguments @("-C", $repo, "diff", "--cached", "--stat")

Write-Step "Commit oluşturuluyor"
Invoke-Native -FilePath "git.exe" -Arguments @(
    "-C", $repo,
    "commit",
    "-m", "fix: prioritize customer tracking tokens over session roles"
)

Write-Step "Aktif branch GitHub'a gönderiliyor"
Invoke-Native -FilePath "git.exe" -Arguments @("-C", $repo, "push", "origin", $branch)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "GITHUB GÖNDERİMİ TAMAMLANDI" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ("Branch: " + $branch) -ForegroundColor White
Write-Host "Gönderilen dosyalar:" -ForegroundColor White
foreach ($relativePath in $changedFiles) {
    Write-Host (" - " + $relativePath) -ForegroundColor White
}
Write-Host ""
