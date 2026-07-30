#requires -Version 5.1
<#
Burger Brothers Berlin
TV güvenli refactor GitHub gönderimi

Bu dosya doğrudan C:\Web\burger içine konulup oradan çalıştırılır.
git init KULLANMAZ.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

try {
    chcp.com 65001 | Out-Null
} catch {}

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"

$files = @(
    "app\tv\page.tsx"
    "app\tv\error.tsx"
    "app\tv\tv.css"
    "components\tv\AcceptOrderOverlay.tsx"
    "components\tv\OrderCard.tsx"
    "components\tv\OrderDetailsModal.tsx"
    "components\tv\PauseBlock.tsx"
    "components\tv\ProductAvailabilityBlock.tsx"
    "components\tv\SummaryGrid.tsx"
    "components\tv\TvConfirmDialog.tsx"
    "components\tv\TvHeader.tsx"
    "components\tv\TvSidebar.tsx"
    "components\tv\TvSoundControls.tsx"
    "components\tv\TvToastViewport.tsx"
    "hooks\tv\use-tv-brian.ts"
    "hooks\tv\use-tv-clock.ts"
    "hooks\tv\use-tv-feedback.ts"
    "hooks\tv\use-tv-orders.ts"
    "hooks\tv\use-tv-pause.ts"
    "hooks\tv\use-tv-print.ts"
    "hooks\tv\use-tv-products.ts"
    "hooks\tv\use-tv-settings.ts"
    "hooks\tv\use-tv-sound.ts"
    "lib\tv\domain.ts"
    "types\tv.ts"
    "tools\tv-refactor-regression-tests.cjs"
    "package.json"
    "docs\tv-refactor-20260722\README.md"
    "docs\tv-refactor-20260722\CHANGED-FILES.txt"
    "docs\tv-refactor-20260722\VERIFY.txt"
)

function Write-Step {
    param([string]$Message)
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

        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()

        if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
            continue
        }

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
        } else {
            if (Test-Path -LiteralPath $destination -PathType Leaf) {
                Remove-Item -LiteralPath $destination -Force
            }
        }
    }
}

$expectedScriptRoot = [System.IO.Path]::GetFullPath($src).TrimEnd("\")
$actualScriptRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd("\")

if ($actualScriptRoot -ne $expectedScriptRoot) {
    throw "Bu script doğrudan C:\Web\burger içine konulup oradan çalıştırılmalıdır. Bulunan: $actualScriptRoot"
}

if (-not (Test-Path -LiteralPath $src -PathType Container)) {
    throw "Kaynak proje bulunamadı: $src"
}

if (-not (Test-Path -LiteralPath $repo -PathType Container)) {
    throw "GitHub repository klasörü bulunamadı: $repo"
}

if (-not (Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
    throw "C:\Web\burger-github geçerli Git repository değil. git init kullanılmayacak."
}

Write-Step "Kaynak dosyalar ve güvenlik politikası kontrol ediliyor"

$blockedNamePatterns = @(
    ".env",
    ".env.*",
    "*.log",
    "*.db",
    "*.sqlite",
    "*.sqlite3",
    "*.pem",
    "*.pfx",
    "*.p12",
    "*.key",
    "*.zip",
    "tsconfig.tsbuildinfo"
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
        throw "Teslimat dosyası kaynak projede bulunamadı: $relativePath"
    }

    $name = [System.IO.Path]::GetFileName($sourcePath)

    foreach ($pattern in $blockedNamePatterns) {
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
            throw "Secret benzeri değer bulundu; işlem durduruldu: $relativePath"
        }
    }
}

Write-Step "Repository temizliği kontrol ediliyor"

$repoStatus = @(& git -C $repo status --porcelain)

if ($LASTEXITCODE -ne 0) {
    throw "git status çalışmadı."
}

if ($repoStatus.Count -gt 0) {
    Write-Host "Repository içinde önceden kalan değişiklikler var:" -ForegroundColor Yellow
    $repoStatus | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    throw "Güvenlik için temiz repository gerekli. Önce mevcut değişiklikleri çöz."
}

$backupRoot = Join-Path $env:TEMP ("burger-tv-refactor-repo-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
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
        } else {
            $existedMap[$relativePath] = $false
        }

        if (-not (Test-Path -LiteralPath $destinationDirectory)) {
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        }

        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }

    Write-Step "Build ortamı için secret değerleri yalnız process içine yükleniyor"

    Import-DotEnvToProcess -Path (Join-Path $src ".env")
    Import-DotEnvToProcess -Path (Join-Path $src ".env.local")

    [Environment]::SetEnvironmentVariable("NEXT_TELEMETRY_DISABLED", "1", "Process")
    [Environment]::SetEnvironmentVariable("CI", "1", "Process")

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
            Invoke-Native -Executable "npm.cmd" -Arguments @("ci") -FailureMessage "npm ci başarısız"
        }

        Write-Step "Prisma client oluşturuluyor"
        Invoke-Native -Executable "npx.cmd" -Arguments @("prisma", "generate") -FailureMessage "prisma generate başarısız"

        Write-Step "TypeScript kontrolü çalıştırılıyor"
        Invoke-Native -Executable "npm.cmd" -Arguments @("run", "typecheck") -FailureMessage "typecheck başarısız"

        Write-Step "TV refactor regresyon testi çalıştırılıyor"
        Invoke-Native -Executable "npm.cmd" -Arguments @("run", "tv:refactor:test") -FailureMessage "TV refactor testi başarısız"

        Write-Step "Tüm güvenlik regresyon testleri çalıştırılıyor"
        Invoke-Native -Executable "npm.cmd" -Arguments @("run", "security:test") -FailureMessage "security:test başarısız"

        Write-Step "Temiz production build çalıştırılıyor"
        Invoke-Native -Executable "npm.cmd" -Arguments @("run", "build") -FailureMessage "production build başarısız"

        Write-Step "Yalnız teslimat dosyaları git add ile ekleniyor"
        & git add -- $files

        if ($LASTEXITCODE -ne 0) {
            throw "git add başarısız."
        }

        Invoke-Native -Executable "git" -Arguments @("diff", "--cached", "--check") -FailureMessage "git diff --cached --check başarısız"

        $hasStagedChanges = $true
        & git diff --cached --quiet

        if ($LASTEXITCODE -eq 0) {
            $hasStagedChanges = $false
        } elseif ($LASTEXITCODE -ne 1) {
            throw "Staged diff kontrolü başarısız."
        }

        if (-not $hasStagedChanges) {
            Write-Host ""
            Write-Host "Gönderilecek yeni değişiklik yok. Commit/push yapılmadı." -ForegroundColor Yellow
            return
        }

        Write-Step "Gönderilecek değişiklik özeti"
        & git diff --cached --stat

        if ($LASTEXITCODE -ne 0) {
            throw "git diff --cached --stat başarısız."
        }

        Write-Step "Commit oluşturuluyor"
        Invoke-Native -Executable "git" -Arguments @(
            "commit",
            "-m",
            "refactor(tv): split page into typed hooks and components"
        ) -FailureMessage "git commit başarısız"

        $commitCreated = $true

        $branch = (& git branch --show-current).Trim()

        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
            throw "Aktif branch belirlenemedi."
        }

        Write-Step "Aktif branch origin'e gönderiliyor: $branch"
        Invoke-Native -Executable "git" -Arguments @("push", "origin", $branch) -FailureMessage "git push başarısız"

        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host "TV REFACTOR GITHUB'A GÖNDERİLDİ" -ForegroundColor Green
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
        try {
            & git -C $repo reset --quiet
        } catch {}

        Restore-RepositoryFiles -BackupRoot $backupRoot -ExistedMap $existedMap
    } else {
        Write-Host ""
        Write-Host "Commit oluşturuldu fakat sonraki işlem başarısız oldu." -ForegroundColor Yellow
        Write-Host "Repository commit'i korunmuştur; hata giderildikten sonra push tekrar denenebilir." -ForegroundColor Yellow
    }

    throw
}
finally {
    if (Test-Path -LiteralPath $backupRoot) {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force
    }
}
