#requires -version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Source = $PSScriptRoot
$Repo = 'C:\Web\burger-github'
$ExpectedRemoteFragment = 'om3r305/burger-brothers.berlin'
$CommitMessage = 'fix: make Schnellbestellung QR display reliable'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = 'C:\Web\burger-github-backups'
$Backup = Join-Path $BackupRoot ("schnellbestellung-v1.1-$Stamp")
$CommitCreated = $false

$Changed = @(
    'app/admin/schnellbestellung/page.tsx',
    'app/api/schnellbestellung/access-token/route.ts',
    'app/schnellbestellung/access-display/page.tsx',
    'tools/schnellbestellung-regression-tests.cjs',
    'README-SCHNELLBESTELLUNG.md',
    'VERIFY-SCHNELLBESTELLUNG.md',
    'CHANGED-FILES-SCHNELLBESTELLUNG-V1.1.txt',
    'SCHNELLBESTELLUNG-V1.1-QR-FIX-REPORT.md',
    'SHA256SUMS-SCHNELLBESTELLUNG-V1.1.txt',
    'PUSH-SCHNELLBESTELLUNG-V1.1-TO-GITHUB.ps1'
)

$TextExtensions = @(
    '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs',
    '.json', '.md', '.txt', '.yml', '.yaml',
    '.ps1', '.bat', '.cmd', '.prisma', '.css', '.scss'
)

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$File failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Normalize-TextFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($TextExtensions -notcontains $extension) {
        return
    }

    $text = [System.IO.File]::ReadAllText($Path)
    $text = $text -replace "`r`n", "`n"
    $text = $text -replace "`r", "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}

function Restore-PreCommitState {
    Write-Host 'Commit oncesi hata: repository geri yukleniyor...' -ForegroundColor Yellow

    & git -C $Repo reset --hard HEAD | Out-Null

    foreach ($relativePath in $Changed) {
        $destination = Join-Path $Repo ($relativePath -replace '/', '\')
        $backupFile = Join-Path $Backup ($relativePath -replace '/', '\')
        $missingMarker = "$backupFile.__WAS_MISSING__"

        if (Test-Path -LiteralPath $backupFile -PathType Leaf) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $backupFile -Destination $destination -Force
        }
        elseif (Test-Path -LiteralPath $missingMarker -PathType Leaf) {
            Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
        }
    }

    & git -C $Repo reset --hard HEAD | Out-Null
}

Write-Host ''
Write-Host '========================================================' -ForegroundColor Cyan
Write-Host ' SCHNELLBESTELLUNG V1.1 - TEST / COMMIT / PUSH' -ForegroundColor Cyan
Write-Host '========================================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Source folder missing: $Source"
}

if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
    throw "GitHub repository folder missing: $Repo"
}

if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git') -PathType Container)) {
    throw 'Repository .git folder missing. git init will NOT be used.'
}

$remote = (& git -C $Repo remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0) {
    throw 'Git origin remote could not be read.'
}

if (($remote -join "`n") -notmatch [regex]::Escape($ExpectedRemoteFragment)) {
    throw "Wrong Git remote: $($remote -join ', ')"
}

$branch = (& git -C $Repo branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($branch)) {
    throw 'Detached HEAD detected. Active branch is required.'
}

$dirtyBefore = @(& git -C $Repo status --porcelain)
if ($dirtyBefore.Count -gt 0) {
    throw "Repository is not clean. Commit or stash existing changes first:`n$($dirtyBefore -join "`n")"
}

New-Item -ItemType Directory -Path $Backup -Force | Out-Null

try {
    Write-Host '[1/8] Degisen dosyalar yedekleniyor ve kopyalaniyor...' -ForegroundColor Yellow

    foreach ($relativePath in $Changed) {
        $sourceFile = Join-Path $Source ($relativePath -replace '/', '\')
        $destination = Join-Path $Repo ($relativePath -replace '/', '\')
        $backupFile = Join-Path $Backup ($relativePath -replace '/', '\')

        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            throw "Source file missing: $relativePath"
        }

        New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null

        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            Copy-Item -LiteralPath $destination -Destination $backupFile -Force
        }
        else {
            New-Item -ItemType File -Path "$backupFile.__WAS_MISSING__" -Force | Out-Null
        }

        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $sourceFile -Destination $destination -Force
        Normalize-TextFile -Path $destination
    }

    Write-Host '[2/8] Yasakli dosya ve secret taramasi yapiliyor...' -ForegroundColor Yellow

    $forbiddenFiles = Get-ChildItem -LiteralPath $Repo -Recurse -Force -File |
        Where-Object {
            $name = $_.Name.ToLowerInvariant()
            $isEnvironment = ($name -eq '.env') -or ($name -like '.env.*')
            $isSafeTemplate =
                ($name -match 'example') -or
                ($name -match 'sample') -or
                ($name -match 'template')
            $isEnvironment -and -not $isSafeTemplate
        }

    if ($forbiddenFiles) {
        throw 'A real environment file was detected inside the GitHub repository.'
    }

    $secretPatterns = @(
        '(?<![A-Za-z0-9])sk_(?:live|test)_[A-Za-z0-9]{16,}',
        '(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{16,}',
        '(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}',
        '(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}',
        '(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])',
        '(?<![0-9])[0-9]{8,10}:[A-Za-z0-9_-]{30,}'
    )

    $secretHits = @()
    foreach ($relativePath in $Changed) {
        $destination = Join-Path $Repo ($relativePath -replace '/', '\')
        foreach ($pattern in $secretPatterns) {
            $matches = Select-String -LiteralPath $destination -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue
            if ($matches) {
                $secretHits += $matches
            }
        }
    }

    if ($secretHits.Count -gt 0) {
        $secretHits | Select-Object Path, LineNumber | Format-Table -AutoSize
        throw 'Potential secret detected in delivery files.'
    }

    Write-Host '[3/8] Build kalintilari temizleniyor...' -ForegroundColor Yellow
    Remove-Item -LiteralPath (Join-Path $Repo '.next') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue

    Write-Host '[4/8] Dependencies ve Prisma Client dogrulaniyor...' -ForegroundColor Yellow
    if (-not (Test-Path -LiteralPath (Join-Path $Repo 'node_modules') -PathType Container)) {
        Invoke-External -File 'npm.cmd' -Arguments @('ci') -WorkingDirectory $Repo
    }
    Invoke-External -File 'npx.cmd' -Arguments @('prisma', 'generate') -WorkingDirectory $Repo

    Write-Host '[5/8] Typecheck ve regression testleri calisiyor...' -ForegroundColor Yellow
    Invoke-External -File 'npm.cmd' -Arguments @('run', 'typecheck') -WorkingDirectory $Repo
    Invoke-External -File 'npm.cmd' -Arguments @('run', 'schnell:test') -WorkingDirectory $Repo
    Invoke-External -File 'npm.cmd' -Arguments @('run', 'security:test') -WorkingDirectory $Repo

    Write-Host '[6/8] Production build calisiyor...' -ForegroundColor Yellow
    Invoke-External -File 'npm.cmd' -Arguments @('run', 'build') -WorkingDirectory $Repo

    Write-Host '[7/8] Yalniz teslimat dosyalari stage ve commit ediliyor...' -ForegroundColor Yellow
    foreach ($relativePath in $Changed) {
        Invoke-External -File 'git' -Arguments @('add', '--', $relativePath) -WorkingDirectory $Repo
    }

    Invoke-External -File 'git' -Arguments @('diff', '--cached', '--check') -WorkingDirectory $Repo

    $staged = @(& git -C $Repo diff --cached --name-only)
    if ($staged.Count -eq 0) {
        throw 'No staged changes were found.'
    }

    $unexpected = @($staged | Where-Object { $Changed -notcontains ($_ -replace '\', '/') })
    if ($unexpected.Count -gt 0) {
        throw "Unexpected staged files detected:`n$($unexpected -join "`n")"
    }

    Invoke-External -File 'git' -Arguments @('commit', '-m', $CommitMessage) -WorkingDirectory $Repo
    $CommitCreated = $true

    $commitHash = (& git -C $Repo rev-parse HEAD).Trim()

    Write-Host '[8/8] Commit aktif branch uzerinden GitHuba gonderiliyor...' -ForegroundColor Yellow

    try {
        Invoke-External -File 'git' -Arguments @('push', 'origin', $branch) -WorkingDirectory $Repo
    }
    catch {
        Write-Host ''
        Write-Host 'Commit olusturuldu fakat push basarisiz oldu.' -ForegroundColor Yellow
        Write-Host "Commit silinmedi: $commitHash" -ForegroundColor Yellow
        Write-Host 'Tekrar denemek icin:' -ForegroundColor Cyan
        Write-Host "git -C `"$Repo`" push origin $branch" -ForegroundColor White
        throw
    }

    Write-Host ''
    Write-Host '========================================================' -ForegroundColor Green
    Write-Host ' BASARILI' -ForegroundColor Green
    Write-Host '========================================================' -ForegroundColor Green
    Write-Host "Branch : $branch" -ForegroundColor Cyan
    Write-Host "Commit : $commitHash" -ForegroundColor Cyan
    Write-Host "Backup : $Backup" -ForegroundColor Cyan
    Write-Host ''
}
catch {
    if (-not $CommitCreated) {
        Restore-PreCommitState
        Write-Host "Yedek klasoru korundu: $Backup" -ForegroundColor Yellow
    }

    throw
}
