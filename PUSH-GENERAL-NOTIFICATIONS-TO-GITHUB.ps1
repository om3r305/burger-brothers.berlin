param(
    [string]$SourceRoot = "C:\Web\burger",
    [string]$RepoRoot = "C:\Web\burger-github",
    [string]$Branch = "main"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Step([string]$Text) {
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

$ChangedListPath = Join-Path $PSScriptRoot "CHANGED-FILES-GENERAL-NOTIFICATIONS.txt"

try {
    Step "GitHub klasoru kontrol ediliyor"

    if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
        throw "Canli kaynak klasoru bulunamadi: $SourceRoot"
    }
    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
        throw "GitHub klasoru bulunamadi: $RepoRoot"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git") -PathType Container)) {
        throw "C:\Web\burger-github bir Git deposu degil. git init kesinlikle calistirilmadi."
    }
    if (-not (Test-Path -LiteralPath $ChangedListPath -PathType Leaf)) {
        throw "Degisen dosya listesi bulunamadi."
    }

    $changedFiles = Get-Content -LiteralPath $ChangedListPath |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith("#") }

    Push-Location $RepoRoot
    try {
        $remote = (& git remote get-url origin).Trim()
        if ($LASTEXITCODE -ne 0 -or $remote -notmatch 'om3r305/burger-brothers\.berlin') {
            throw "Beklenen GitHub remote bulunamadi. Mevcut origin: $remote"
        }

        $dirty = & git status --porcelain
        if ($LASTEXITCODE -ne 0) { throw "git status calismadi." }
        if ($dirty) {
            throw "C:\Web\burger-github temiz degil. Once mevcut degisiklikleri commit/stash yap."
        }

        Run-Checked "git" "checkout" $Branch
        Run-Checked "git" "pull" "--ff-only" "origin" $Branch
    }
    finally {
        Pop-Location
    }

    Step "Canli projede test ve build calistiriliyor"
    Push-Location $SourceRoot
    try {
        Run-Checked "npm.cmd" "run" "notifications:test"
        Run-Checked "npm.cmd" "run" "tv:refactor:test"
        if (Test-Path -LiteralPath (Join-Path $SourceRoot "print-proxy\index.cjs")) {
            Run-Checked "npm.cmd" "run" "schnell:test"
        }
        Run-Checked "npm.cmd" "run" "typecheck"
        Run-Checked "npm.cmd" "run" "build"
    }
    finally {
        Pop-Location
    }

    Step "Yalniz degisen guvenli dosyalar GitHub klonuna kopyalaniyor"
    foreach ($relative in $changedFiles) {
        if ($relative -match '(^|/)(\.env|node_modules|\.next|\.git)(/|$)') {
            throw "Guvenlik nedeniyle yasakli yol listede: $relative"
        }

        $source = Join-Path $SourceRoot ($relative -replace '/', '\')
        $target = Join-Path $RepoRoot ($relative -replace '/', '\')
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Canli kaynak dosyasi eksik: $relative"
        }
        $targetDir = Split-Path -Parent $target
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
    }

    Step "Secret taramasi ve Git diff kontrolu"
    $secretPatterns = @(
        'sk_(live|test)_[0-9A-Za-z]{20,}',
        'whsec_[0-9A-Za-z]{20,}',
        'github_pat_[0-9A-Za-z_]{20,}',
        'gh[pousr]_[0-9A-Za-z]{20,}',
        '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
    )

    foreach ($relative in $changedFiles) {
        $file = Join-Path $RepoRoot ($relative -replace '/', '\')
        $extension = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
        if ($extension -in @('.png', '.jpg', '.jpeg', '.webp', '.ico')) { continue }
        $content = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
        foreach ($pattern in $secretPatterns) {
            if ($content -match $pattern) {
                throw "Olasi secret bulundu; push durduruldu: $relative"
            }
        }
    }

    Push-Location $RepoRoot
    try {
        Run-Checked "git" "diff" "--check"
        & git add -- $changedFiles
        if ($LASTEXITCODE -ne 0) { throw "git add basarisiz." }
        Run-Checked "git" "diff" "--cached" "--check"

        $staged = & git diff --cached --name-only
        if (-not $staged) {
            Write-Host "GitHub tarafinda yeni degisiklik yok." -ForegroundColor Yellow
            exit 0
        }

        Write-Host ""
        & git diff --cached --stat
        Write-Host ""
        $answer = Read-Host "Yukaridaki degisiklikler commit edilip GitHub'a gonderilsin mi? Devam icin EVET yaz"
        if ($answer.Trim().ToUpperInvariant() -ne "EVET") {
            & git reset | Out-Null
            foreach ($relative in $changedFiles) {
                & git ls-files --error-unmatch -- $relative *> $null
                if ($LASTEXITCODE -eq 0) {
                    & git checkout -- $relative
                }
                else {
                    $untracked = Join-Path $RepoRoot ($relative -replace '/', '\')
                    if (Test-Path -LiteralPath $untracked -PathType Leaf) {
                        Remove-Item -LiteralPath $untracked -Force
                    }
                }
            }
            Write-Host "Commit iptal edildi; GitHub klonu temiz haline getirildi." -ForegroundColor Yellow
            exit 2
        }

        Run-Checked "git" "commit" "-m" "feat: add Android and iOS notification center"
        Run-Checked "git" "push" "origin" $Branch
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "GITHUB PUSH TAMAMLANDI" -ForegroundColor Green
    Write-Host "Vercel Production deployment tamamlaninca /install ve /admin/notifications test edilsin." -ForegroundColor Yellow
    exit 0
}
catch {
    Write-Host ""
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "git init calistirilmadi ve .env/secret dosyalari kopyalanmadi." -ForegroundColor Yellow
    exit 1
}
