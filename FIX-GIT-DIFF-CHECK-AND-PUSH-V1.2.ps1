param(
    [string]$SourceRoot = "C:\Web\burger",
    [string]$RepoRoot = "C:\Web\burger-github",
    [string]$Branch = "main"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Step {
    param([string]$Text)
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Run-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Komut basarisiz oldu ($LASTEXITCODE): $Command $($Arguments -join ' ')"
    }
}

function Normalize-TextFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    $binaryExtensions = @(
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
        ".zip", ".pdf", ".woff", ".woff2", ".ttf", ".eot"
    )

    if ($binaryExtensions -contains $extension) {
        return
    }

    $content = [System.IO.File]::ReadAllText($Path)
    $content = $content -replace "`r`n", "`n"
    $content = $content -replace "`r", "`n"

    $lines = $content -split "`n", -1
    $normalizedLines = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        [void]$normalizedLines.Add($line.TrimEnd(" ", "`t"))
    }

    while (
        $normalizedLines.Count -gt 0 -and
        [string]::IsNullOrWhiteSpace($normalizedLines[$normalizedLines.Count - 1])
    ) {
        $normalizedLines.RemoveAt($normalizedLines.Count - 1)
    }

    $normalized = ($normalizedLines -join "`n") + "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $normalized, $utf8NoBom)
}

$changedListPath = Join-Path $PSScriptRoot "CHANGED-FILES-GENERAL-NOTIFICATIONS-V1.2.txt"

try {
    Step "Klasorler ve GitHub deposu kontrol ediliyor"

    if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
        throw "Canli proje bulunamadi: $SourceRoot"
    }

    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
        throw "GitHub klonu bulunamadi: $RepoRoot"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git") -PathType Container)) {
        throw "C:\Web\burger-github bir Git deposu degil. git init calistirilmadi."
    }

    if (-not (Test-Path -LiteralPath $changedListPath -PathType Leaf)) {
        throw "Degisen dosya listesi bulunamadi."
    }

    $changedFiles = Get-Content -LiteralPath $changedListPath |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith("#") }

    $allowed = @{}
    foreach ($relative in $changedFiles) {
        $allowed[$relative.Replace("\", "/")] = $true
    }

    Push-Location $RepoRoot
    try {
        $remote = (& git remote get-url origin).Trim()
        if ($LASTEXITCODE -ne 0 -or $remote -notmatch "om3r305/burger-brothers\.berlin") {
            throw "Beklenen GitHub remote bulunamadi. Mevcut origin: $remote"
        }

        Run-Checked "git" "fetch" "origin" $Branch

        $counts = (& git rev-list --left-right --count "HEAD...origin/$Branch").Trim() -split "\s+"
        if ($counts.Count -ge 2) {
            $ahead = [int]$counts[0]
            $behind = [int]$counts[1]

            if ($ahead -ne 0 -or $behind -ne 0) {
                throw "GitHub klonu origin/$Branch ile ayni noktada degil. Ahead=$ahead Behind=$behind"
            }
        }

        $dirtyLines = & git status --porcelain
        if ($LASTEXITCODE -ne 0) {
            throw "git status calismadi."
        }

        foreach ($line in $dirtyLines) {
            if ($line.Length -lt 4) {
                continue
            }

            $path = $line.Substring(3).Trim().Replace("\", "/")
            if ($path -match " -> ") {
                $path = ($path -split " -> ")[-1].Trim()
            }

            if (-not $allowed.ContainsKey($path)) {
                throw "GitHub klonunda bu calismaya ait olmayan degisiklik var: $path"
            }
        }
    }
    finally {
        Pop-Location
    }

    Step "Kaynak dosyalardaki Git bosluk problemi duzeltiliyor"

    foreach ($relative in $changedFiles) {
        $source = Join-Path $SourceRoot ($relative -replace "/", "\")
        Normalize-TextFile -Path $source
    }

    Step "qr-scanner kurulumu kontrol ediliyor"

    Push-Location $SourceRoot
    try {
        & npm.cmd ls qr-scanner --depth=0 *> $null
        if ($LASTEXITCODE -ne 0) {
            Run-Checked "npm.cmd" "install" "qr-scanner@1.4.2" "--save-exact" "--no-audit" "--no-fund"
        }

        Run-Checked "npm.cmd" "ls" "qr-scanner" "--depth=0"

        Step "TypeScript kontrolu calistiriliyor"
        Run-Checked "npm.cmd" "run" "typecheck"

        Step "Production build calistiriliyor"
        Run-Checked "npm.cmd" "run" "build"
    }
    finally {
        Pop-Location
    }

    Step "Dosyalar GitHub klonuna yeniden kopyalaniyor"

    foreach ($relative in $changedFiles) {
        if ($relative -match '(^|/)(\.env|node_modules|\.next|\.git)(/|$)') {
            throw "Yasakli yol listede: $relative"
        }

        $source = Join-Path $SourceRoot ($relative -replace "/", "\")
        $target = Join-Path $RepoRoot ($relative -replace "/", "\")

        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Canli kaynak dosyasi eksik: $relative"
        }

        $targetDirectory = Split-Path -Parent $target
        New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
        Normalize-TextFile -Path $target
    }

    Step "Git diff --check yeniden calistiriliyor"

    Push-Location $RepoRoot
    try {
        Run-Checked "git" "diff" "--check"

        & git add -- $changedFiles
        if ($LASTEXITCODE -ne 0) {
            throw "git add basarisiz."
        }

        Run-Checked "git" "diff" "--cached" "--check"

        $staged = & git diff --cached --name-only
        if (-not $staged) {
            Write-Host "Yeni GitHub degisikligi bulunmadi." -ForegroundColor Yellow
            exit 0
        }

        Write-Host ""
        & git diff --cached --stat
        Write-Host ""

        $answer = Read-Host "Degisiklikler GitHub'a gonderilsin mi? Devam icin EVET yaz"

        if ($answer.Trim().ToUpperInvariant() -ne "EVET") {
            & git reset | Out-Null
            Write-Host "Commit iptal edildi. Dosyalar GitHub klonunda staged olmadan birakildi." -ForegroundColor Yellow
            exit 2
        }

        Run-Checked "git" "commit" "-m" "feat: add general web push notification system"
        Run-Checked "git" "push" "origin" $Branch
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "GITHUB PUSH TAMAMLANDI" -ForegroundColor Green
    Write-Host "LF/CRLF uyarilari zararsizdi; schema.prisma EOF boslugu duzeltildi." -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ""
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "git init calistirilmadi. .env ve secret dosyalari kopyalanmadi." -ForegroundColor Yellow
    exit 1
}
