#requires -Version 5.1
<#
Burger Brothers Berlin
Driver rotasını şoförün güncel konumundan başlatma — GitHub gönderimi

Bu dosya doğrudan C:\Web\burger içine konulup oradan çalıştırılır.
Kaynak: C:\Web\burger
Repository: C:\Web\burger-github

ZIP/fix klasörüne bağlı değildir.
git init KULLANMAZ.
Test/build başarısızsa commit veya push YAPMAZ.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

try { chcp.com 65001 | Out-Null } catch {}

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$files = @(
    "app\driver\page.tsx"
    "hooks\driver\use-driver-route.ts"
    "lib\driver\domain.ts"
    "tools\driver-refactor-regression-tests.cjs"
    "docs\driver-route-current-location-20260722\README.md"
    "docs\driver-route-current-location-20260722\CHANGED-FILES.txt"
    "docs\driver-route-current-location-20260722\VERIFY.txt"
)

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ""
    Write-Host ("==> " + $Message) -ForegroundColor Cyan
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (ExitCode=$LASTEXITCODE)"
    }
}

function Import-DotEnvToProcess {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    foreach ($rawLine in [System.IO.File]::ReadAllLines($Path)) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) { continue }

        if ($line.StartsWith("export ")) {
            $line = $line.Substring(7).Trim()
        }

        $separator = $line.IndexOf("=")
        if ($separator -le 0) { continue }

        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()

        if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") { continue }

        if (
            $value.Length -ge 2 -and
            (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            )
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Normalize-TextFileEnding {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Dosya bulunamadı: $Path"
    }

    $content = [System.IO.File]::ReadAllText($Path)
    $normalized = $content.TrimEnd([char[]]@("`r", "`n", " ", "`t")) + "`r`n"

    if ($content -ne $normalized) {
        [System.IO.File]::WriteAllText($Path, $normalized, $Utf8NoBom)
    }
}

function Restore-RepositoryFiles {
    param(
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][hashtable]$ExistedMap
    )

    foreach ($relativePath in $files) {
        $destination = Join-Path $repo $relativePath

        if ($ExistedMap[$relativePath] -eq $true) {
            $backupPath = Join-Path $BackupRoot $relativePath
            $destinationDirectory = Split-Path -Parent $destination

            if (-not (Test-Path -LiteralPath $destinationDirectory)) {
                New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
            }

            Copy-Item -LiteralPath $backupPath -Destination $destination -Force
        }
        elseif (Test-Path -LiteralPath $destination -PathType Leaf) {
            Remove-Item -LiteralPath $destination -Force
        }
    }
}

$expectedRoot = [System.IO.Path]::GetFullPath($src).TrimEnd("\")
$rootCandidate = $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($rootCandidate)) {
    $rootCandidate = (Get-Location).Path
}

if ([string]::IsNullOrWhiteSpace($rootCandidate)) {
    throw "Script çalışma klasörü belirlenemedi."
}

$actualRoot = [System.IO.Path]::GetFullPath($rootCandidate).TrimEnd("\")

if ($actualRoot -ne $expectedRoot) {
    throw "Script doğrudan C:\Web\burger içine konulup oradan çalıştırılmalıdır. Bulunan: $actualRoot"
}

if (-not (Test-Path -LiteralPath $src -PathType Container)) {
    throw "Kaynak proje bulunamadı: $src"
}

if (-not (Test-Path -LiteralPath $repo -PathType Container)) {
    throw "Repository klasörü bulunamadı: $repo"
}

if (-not (Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
    throw "C:\Web\burger-github geçerli Git repository değil. git init kullanılmayacak."
}

Write-Step "Teslimat kaynakları doğrulanıyor"

$blockedPatterns = @(
    ".env", ".env.*", "*.log", "*.db", "*.sqlite", "*.sqlite3",
    "*.pem", "*.pfx", "*.p12", "*.key", "*.zip", "tsconfig.tsbuildinfo"
)

$secretPatterns = @(
    "sk_(live|test)_[A-Za-z0-9]{16,}",
    "rk_(live|test)_[A-Za-z0-9]{16,}",
    "whsec_[A-Za-z0-9]{16,}",
    "postgres(ql)?://[^:\s]+:[^@\s]+@",
    "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"
)

foreach ($relativePath in $files) {
    $sourcePath = Join-Path $src $relativePath

    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Teslimat dosyası bulunamadı: $relativePath"
    }

    Normalize-TextFileEnding -Path $sourcePath

    $name = [System.IO.Path]::GetFileName($sourcePath)
    foreach ($pattern in $blockedPatterns) {
        if ($name -like $pattern) {
            throw "Yasaklı dosya teslimat listesinde: $relativePath"
        }
    }

    $content = [System.IO.File]::ReadAllText($sourcePath)
    foreach ($secretPattern in $secretPatterns) {
        if ([System.Text.RegularExpressions.Regex]::IsMatch(
            $content,
            $secretPattern,
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )) {
            throw "Secret benzeri değer bulundu: $relativePath"
        }
    }
}

Write-Step "Repository temizliği kontrol ediliyor"

$repoStatus = @(& git -C $repo status --porcelain)
if ($LASTEXITCODE -ne 0) { throw "git status çalışmadı." }

if ($repoStatus.Count -gt 0) {
    Write-Host "Repository içinde önceden kalan değişiklikler var:" -ForegroundColor Yellow
    $repoStatus | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    throw "Güvenlik için temiz repository gerekli."
}

$backupRoot = Join-Path $env:TEMP ("burger-driver-route-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

$existedMap = @{}
$commitCreated = $false

try {
    Write-Step "Yalnız bu teslimattaki dosyalar repository içine kopyalanıyor"

    foreach ($relativePath in $files) {
        $sourcePath = Join-Path $src $relativePath
        $destinationPath = Join-Path $repo $relativePath
        $destinationDirectory = Split-Path -Parent $destinationPath

        if (Test-Path -LiteralPath $destinationPath -PathType Leaf) {
            $existedMap[$relativePath] = $true
            $backupPath = Join-Path $backupRoot $relativePath
            $backupDirectory = Split-Path -Parent $backupPath

            if (-not (Test-Path -LiteralPath $backupDirectory)) {
                New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
            }

            Copy-Item -LiteralPath $destinationPath -Destination $backupPath -Force
        }
        else {
            $existedMap[$relativePath] = $false
        }

        if (-not (Test-Path -LiteralPath $destinationDirectory)) {
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        }

        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }

    Import-DotEnvToProcess -Path (Join-Path $src ".env")
    Import-DotEnvToProcess -Path (Join-Path $src ".env.local")

    [Environment]::SetEnvironmentVariable("NEXT_TELEMETRY_DISABLED", "1", "Process")
    [Environment]::SetEnvironmentVariable("CI", "1", "Process")
    [Environment]::SetEnvironmentVariable("GIT_PAGER", "cat", "Process")
    [Environment]::SetEnvironmentVariable("PAGER", "cat", "Process")

    $nextPath = Join-Path $repo ".next"
    if (Test-Path -LiteralPath $nextPath) {
        Remove-Item -LiteralPath $nextPath -Recurse -Force
    }

    $tsBuildInfo = Join-Path $repo "tsconfig.tsbuildinfo"
    if (Test-Path -LiteralPath $tsBuildInfo) {
        Remove-Item -LiteralPath $tsBuildInfo -Force
    }

    Push-Location $repo

    try {
        if (-not (Test-Path -LiteralPath (Join-Path $repo "node_modules") -PathType Container)) {
            Write-Step "node_modules bulunamadı; npm ci çalıştırılıyor"
            Invoke-Native "npm.cmd" @("ci") "npm ci başarısız"
        }

        Write-Step "Prisma client oluşturuluyor"
        Invoke-Native "npx.cmd" @("prisma", "generate") "prisma generate başarısız"

        Write-Step "TypeScript kontrolü"
        Invoke-Native "npm.cmd" @("run", "typecheck") "typecheck başarısız"

        Write-Step "Driver regresyon testi"
        Invoke-Native "npm.cmd" @("run", "driver:refactor:test") "Driver regresyon testi başarısız"

        Write-Step "Güvenlik regresyon testleri"
        Invoke-Native "npm.cmd" @("run", "security:test") "security:test başarısız"

        Write-Step "Production build"
        Invoke-Native "npm.cmd" @("run", "build") "production build başarısız"

        Write-Step "Yalnız teslimat dosyaları stage ediliyor"
        & git add -- $files
        if ($LASTEXITCODE -ne 0) { throw "git add başarısız." }

        Invoke-Native "git" @("diff", "--cached", "--check") "git diff --cached --check başarısız"

        & git diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Gönderilecek yeni değişiklik yok. Commit/push yapılmadı." -ForegroundColor Yellow
            return
        }
        if ($LASTEXITCODE -ne 1) {
            throw "Staged diff kontrolü başarısız."
        }

        Write-Step "Gönderilecek değişiklik özeti"
        & git -c core.pager=cat diff --cached --stat
        if ($LASTEXITCODE -ne 0) { throw "Diff özeti alınamadı." }

        Write-Step "Commit oluşturuluyor"
        Invoke-Native "git" @(
            "commit",
            "-m",
            "fix(driver): start routes from current location"
        ) "git commit başarısız"

        $commitCreated = $true
        $branch = (& git branch --show-current).Trim()

        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
            throw "Aktif branch belirlenemedi."
        }

        Write-Step "Aktif branch origin'e gönderiliyor: $branch"
        Invoke-Native "git" @("push", "origin", $branch) "git push başarısız"

        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host "DRIVER ROTA DÜZELTMESİ GITHUB'A GÖNDERİLDİ" -ForegroundColor Green
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host ("Branch: " + $branch) -ForegroundColor White
        Write-Host ""
        Write-Host "Gönderilen dosyalar:" -ForegroundColor Cyan

        foreach ($relativePath in $files) {
            Write-Host (" - " + $relativePath) -ForegroundColor White
        }
    }
    finally {
        Pop-Location
    }
}
catch {
    if (-not $commitCreated) {
        try { & git -C $repo reset --quiet } catch {}
        Restore-RepositoryFiles -BackupRoot $backupRoot -ExistedMap $existedMap
    }
    else {
        Write-Host "Commit oluşturuldu fakat push tamamlanamadı. Commit korunmuştur." -ForegroundColor Yellow
    }

    throw
}
finally {
    if (Test-Path -LiteralPath $backupRoot) {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force
    }
}
