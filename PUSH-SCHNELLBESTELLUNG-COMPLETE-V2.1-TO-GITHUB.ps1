#requires -version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Ana proje ve GitHub senkronizasyon klasorleri.
# Script terminale yapistirilsa bile kaynak klasor bos kalmaz.
$Source = 'C:\Web\burger'
$Repo = 'C:\Web\burger-github'
$ExpectedRemoteFragment = 'om3r305/burger-brothers.berlin'
$ExpectedBranch = 'main'
$CommitMessage = 'feat: complete Schnellbestellung controls with type-safe pause and metadata'

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = 'C:\Web\burger-github-backups'
$Backup = Join-Path $BackupRoot ("schnellbestellung-complete-v2-1-" + $Stamp)

$CommitCreated = $false
$OriginalHead = $null

# Schnellbestellung Complete V2.1: V2 kodlari + typecheck duzeltmeleri.
$Changed = @(
    'app/admin/schnellbestellung/page.tsx',
    'app/api/admin/schnellbestellung/route.ts',
    'app/api/orders/list/route.ts',
    'app/api/orders/status/route.ts',
    'app/api/pause/route.ts',
    'app/api/schnellbestellung/access-token/route.ts',
    'app/api/schnellbestellung/catalog/route.ts',
    'app/schnellbestellung/access-display/page.tsx',
    'app/schnellbestellung/success/page.tsx',
    'app/tv/page.tsx',
    'app/checkout/page.tsx',
    'components/schnellbestellung/SchnellClient.tsx',
    'components/tv/AcceptOrderOverlay.tsx',
    'components/tv/OrderCard.tsx',
    'components/tv/OrderDetailsModal.tsx',
    'components/tv/PauseBlock.tsx',
    'components/tv/SummaryGrid.tsx',
    'components/tv/TvSidebar.tsx',
    'components/tv/TvSoundControls.tsx',
    'hooks/tv/use-tv-pause.ts',
    'hooks/tv/use-tv-sound.ts',
    'lib/pause.ts',
    'lib/server/schnellbestellung.ts',
    'lib/tv/domain.ts',
    'public/sounds/dine-in.wav',
    'tools/schnellbestellung-regression-tests.cjs',
    'README-SCHNELLBESTELLUNG-COMPLETE-V2.1.md',
    'VERIFY-SCHNELLBESTELLUNG-COMPLETE-V2.1.md',
    'CHANGED-FILES-SCHNELLBESTELLUNG-COMPLETE-V2.1.txt',
    'SHA256SUMS-SCHNELLBESTELLUNG-COMPLETE-V2.1.txt',
    'PUSH-SCHNELLBESTELLUNG-COMPLETE-V2.1-TO-GITHUB.ps1',
    'RUN-SCHNELLBESTELLUNG-COMPLETE-V2.1-GITHUB-PUSH.bat',
)

$TextExtensions = @(
    '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs',
    '.json', '.md', '.txt', '.yml', '.yaml',
    '.ps1', '.bat', '.cmd', '.prisma', '.css', '.scss'
)

function Write-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    Write-Host $Text -ForegroundColor Yellow
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Gerekli komut bulunamadi: $Name"
    }
}

function Ensure-ParentDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $parent = Split-Path -Parent $Path

    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}


function Convert-ToForwardSlashPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return $Path.Replace([char]92, [char]47)
}

function Convert-ToWindowsPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return $Path.Replace([char]47, [char]92)
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)]
        [string]$File,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    Push-Location -LiteralPath $WorkingDirectory

    try {
        & $File @Arguments

        if ($LASTEXITCODE -ne 0) {
            $argumentText = $Arguments -join ' '
            throw "$File $argumentText basarisiz oldu. Cikis kodu: $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Normalize-TextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()

    if ($TextExtensions -notcontains $extension) {
        return
    }

    $text = [System.IO.File]::ReadAllText($Path)
    $text = $text -replace "`r`n", "`n"
    $text = $text -replace "`r", "`n"

    if ($extension -eq '.ps1') {
        # Windows PowerShell 5.1 icin UTF-8 BOM + CRLF.
        $text = $text -replace "`n", "`r`n"
        $utf8Bom = New-Object System.Text.UTF8Encoding($true)
        [System.IO.File]::WriteAllText($Path, $text, $utf8Bom)
        return
    }

    # Kod ve dokumanlar icin UTF-8 BOM'suz + LF.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}

function Assert-SafeRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "Mutlak teslimat yolu yasak: $RelativePath"
    }

    $normalized = Convert-ToForwardSlashPath -Path $RelativePath

    if ($normalized -match '(^|/)\.\.(/|$)') {
        throw "Ust klasore cikmaya calisan yol yasak: $RelativePath"
    }

    if ($normalized -match '(^|/)(\.env|\.env\..+)$') {
        throw "Environment dosyasi teslimat listesinde olamaz: $RelativePath"
    }
}

function Get-RepoStatusPaths {
    $lines = @(& git -C $Repo status --porcelain=v1 --untracked-files=all)

    $paths = @()

    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) {
            continue
        }

        $pathPart = $line.Substring(3).Trim()

        if ($pathPart -match ' -> ') {
            $pathPart = ($pathPart -split ' -> ')[-1].Trim()
        }

        $paths += (Convert-ToForwardSlashPath -Path $pathPart)
    }

    return @($paths)
}

function Restore-PreCommitState {
    if ([string]::IsNullOrWhiteSpace($OriginalHead)) {
        return
    }

    Write-Host ''
    Write-Host 'Commit oncesi hata olustu. GitHub klasoru geri yukleniyor...' -ForegroundColor Yellow

    & git -C $Repo reset --hard $OriginalHead | Out-Null

    foreach ($relativePath in $Changed) {
        $windowsRelative = Convert-ToWindowsPath -Path $relativePath
        $destination = Join-Path $Repo $windowsRelative
        $backupFile = Join-Path $Backup $windowsRelative
        $missingMarker = $backupFile + '.__WAS_MISSING__'

        if (Test-Path -LiteralPath $missingMarker -PathType Leaf) {
            Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Remove-Item -LiteralPath (Join-Path $Repo '.next') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host ' SCHNELLBESTELLUNG COMPLETE V2.1 / TEST / COMMIT / PUSH' -ForegroundColor Cyan
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host ''

Require-Command -Name 'git'
Require-Command -Name 'node'
Require-Command -Name 'npm.cmd'
Require-Command -Name 'npx.cmd'

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Ana proje klasoru bulunamadi: $Source"
}

if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
    throw "GitHub senkronizasyon klasoru bulunamadi: $Repo"
}

if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git') -PathType Container)) {
    throw "GitHub klasorunde .git bulunamadi. git init KESINLIKLE calistirilmadi."
}

foreach ($relativePath in $Changed) {
    Assert-SafeRelativePath -RelativePath $relativePath

    $sourceFile = Join-Path $Source (Convert-ToWindowsPath -Path $relativePath)

    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Ana projede gerekli dosya bulunamadi: $relativePath"
    }
}

$remoteLines = @(& git -C $Repo remote get-url origin 2>$null)

if ($LASTEXITCODE -ne 0 -or $remoteLines.Count -eq 0) {
    throw 'Git origin remote okunamadi.'
}

$remote = ($remoteLines -join "`n").Trim()

if ($remote -notmatch [regex]::Escape($ExpectedRemoteFragment)) {
    throw "Yanlis GitHub remote tespit edildi: $remote"
}

$branch = (& git -C $Repo branch --show-current).Trim()

if ([string]::IsNullOrWhiteSpace($branch)) {
    throw 'Detached HEAD tespit edildi. Aktif branch gerekli.'
}

if ($branch -ne $ExpectedBranch) {
    throw "Yanlis branch tespit edildi: $branch. Beklenen branch: $ExpectedBranch"
}

$dirtyBefore = @(& git -C $Repo status --porcelain=v1 --untracked-files=all)

if ($dirtyBefore.Count -gt 0) {
    Write-Host ''
    Write-Host 'GitHub klasoru temiz degil. Mevcut dosyalara dokunulmadan islem durduruldu:' -ForegroundColor Red
    $dirtyBefore | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    throw 'Once C:\Web\burger-github klasorundeki mevcut degisiklikleri temizle veya commit et.'
}

Write-Step '[1/10] GitHub repository remote ile guvenli sekilde eslestiriliyor...'

Invoke-External `
    -File 'git' `
    -Arguments @('fetch', 'origin', $branch) `
    -WorkingDirectory $Repo

$remoteRef = 'origin/' + $branch

Invoke-External `
    -File 'git' `
    -Arguments @('rev-parse', '--verify', $remoteRef) `
    -WorkingDirectory $Repo

$aheadBehindText = (& git -C $Repo rev-list --left-right --count ("HEAD..." + $remoteRef)).Trim()

if ([string]::IsNullOrWhiteSpace($aheadBehindText)) {
    throw 'Local/remote commit durumu okunamadi.'
}

$aheadBehind = @($aheadBehindText -split '\s+')

if ($aheadBehind.Count -lt 2) {
    throw "Beklenmeyen rev-list sonucu: $aheadBehindText"
}

$ahead = [int]$aheadBehind[0]
$behind = [int]$aheadBehind[1]

if ($ahead -gt 0 -and $behind -gt 0) {
    throw "Local ve remote branch ayrismis durumda. Otomatik devam edilmedi. Ahead=$ahead Behind=$behind"
}

if ($ahead -gt 0) {
    throw "C:\Web\burger-github icinde henuz push edilmemis $ahead commit var. Once su komutu calistir: git -C `"$Repo`" push origin $branch"
}

if ($behind -gt 0) {
    Invoke-External `
        -File 'git' `
        -Arguments @('pull', '--ff-only', 'origin', $branch) `
        -WorkingDirectory $Repo
}

$OriginalHead = (& git -C $Repo rev-parse HEAD).Trim()

if ([string]::IsNullOrWhiteSpace($OriginalHead)) {
    throw 'Baslangic commit hash okunamadi.'
}

New-Item -ItemType Directory -Path $Backup -Force | Out-Null

try {
    Write-Step '[2/10] Complete V2 dosyalari yedekleniyor ve kopyalaniyor...'

    foreach ($relativePath in $Changed) {
        $windowsRelative = Convert-ToWindowsPath -Path $relativePath
        $sourceFile = Join-Path $Source $windowsRelative
        $destination = Join-Path $Repo $windowsRelative
        $backupFile = Join-Path $Backup $windowsRelative
        $missingMarker = $backupFile + '.__WAS_MISSING__'

        Ensure-ParentDirectory -Path $backupFile
        Ensure-ParentDirectory -Path $destination

        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            Copy-Item -LiteralPath $destination -Destination $backupFile -Force
        }
        else {
            New-Item -ItemType File -Path $missingMarker -Force | Out-Null
        }

        Copy-Item -LiteralPath $sourceFile -Destination $destination -Force
        Normalize-TextFile -Path $destination
    }

    Write-Step '[3/10] Environment ve yuksek guvenli secret kontrolu yapiliyor...'

    $forbiddenRootFiles = @(
        '.env',
        '.env.local',
        '.env.production',
        '.env.development',
        '.env.test'
    )

    foreach ($forbiddenName in $forbiddenRootFiles) {
        $forbiddenPath = Join-Path $Repo $forbiddenName

        if (Test-Path -LiteralPath $forbiddenPath -PathType Leaf) {
            throw "GitHub klasorunde yasakli environment dosyasi bulundu: $forbiddenName"
        }
    }

    $secretPatterns = @(
        '(?<![A-Za-z0-9])sk_(?:live|test)_[A-Za-z0-9]{16,}',
        '(?<![A-Za-z0-9])sk-proj-[A-Za-z0-9_-]{20,}',
        '(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{16,}',
        '(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}',
        '(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}',
        '(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])',
        '(?<![0-9])[0-9]{8,10}:[A-Za-z0-9_-]{30,}'
    )

    $secretHits = @()

    foreach ($relativePath in $Changed) {
        $destination = Join-Path $Repo (Convert-ToWindowsPath -Path $relativePath)
        $extension = [System.IO.Path]::GetExtension($destination).ToLowerInvariant()

        if ($TextExtensions -notcontains $extension) {
            continue
        }

        foreach ($pattern in $secretPatterns) {
            $matches = Select-String `
                -LiteralPath $destination `
                -Pattern $pattern `
                -AllMatches `
                -ErrorAction SilentlyContinue

            if ($matches) {
                $secretHits += $matches
            }
        }
    }

    if ($secretHits.Count -gt 0) {
        $secretHits |
            Select-Object Path, LineNumber |
            Sort-Object Path, LineNumber -Unique |
            Format-Table -AutoSize

        throw 'Teslimat dosyalarinda gercek secret olabilecek deger tespit edildi.'
    }

    Write-Step '[4/10] Build kalintilari temizleniyor...'

    Remove-Item -LiteralPath (Join-Path $Repo '.next') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue

    Write-Step '[5/10] Dependencies ve Prisma Client hazirlaniyor...'

    if (-not (Test-Path -LiteralPath (Join-Path $Repo 'node_modules') -PathType Container)) {
        Invoke-External `
            -File 'npm.cmd' `
            -Arguments @('ci') `
            -WorkingDirectory $Repo
    }

    Invoke-External `
        -File 'npx.cmd' `
        -Arguments @('--no-install', 'prisma', 'generate') `
        -WorkingDirectory $Repo

    Write-Step '[6/10] TypeScript ve Schnellbestellung regression testleri calisiyor...'

    Invoke-External `
        -File 'npm.cmd' `
        -Arguments @('run', 'typecheck') `
        -WorkingDirectory $Repo

    Invoke-External `
        -File 'npm.cmd' `
        -Arguments @('run', 'schnell:test') `
        -WorkingDirectory $Repo

    Invoke-External `
        -File 'npm.cmd' `
        -Arguments @('run', 'tv:refactor:test') `
        -WorkingDirectory $Repo

    Write-Step '[7/10] Mevcut guvenlik testleri calisiyor...'

    Invoke-External `
        -File 'npm.cmd' `
        -Arguments @('run', 'security:test') `
        -WorkingDirectory $Repo

    Write-Step '[8/10] Temiz production build calisiyor...'

    Invoke-External `
        -File 'npm.cmd' `
        -Arguments @('run', 'build') `
        -WorkingDirectory $Repo

    $worktreePaths = @(Get-RepoStatusPaths)
    $allowedPaths = @($Changed | ForEach-Object { Convert-ToForwardSlashPath -Path $_ })
    $unexpectedWorktreePaths = @(
        $worktreePaths |
            Where-Object { $allowedPaths -notcontains $_ } |
            Sort-Object -Unique
    )

    if ($unexpectedWorktreePaths.Count -gt 0) {
        Write-Host ''
        Write-Host 'Build veya test beklenmeyen dosyalari degistirdi:' -ForegroundColor Red
        $unexpectedWorktreePaths | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw 'Beklenmeyen repository degisikligi nedeniyle commit olusturulmadi.'
    }

    Write-Step '[9/10] Yalniz Complete V2 teslimat dosyalari stage ediliyor...'

    foreach ($relativePath in $Changed) {
        Invoke-External `
            -File 'git' `
            -Arguments @('add', '--', $relativePath) `
            -WorkingDirectory $Repo
    }

    Invoke-External `
        -File 'git' `
        -Arguments @('diff', '--cached', '--check') `
        -WorkingDirectory $Repo

    $staged = @(
        & git -C $Repo diff --cached --name-only |
            ForEach-Object { Convert-ToForwardSlashPath -Path $_ }
    )

    if ($staged.Count -eq 0) {
        Write-Host ''
        Write-Host 'Tum Schnellbestellung dosyalari zaten GitHub repository ile ayni.' -ForegroundColor Green
        Write-Host 'Yeni commit gerekmiyor.' -ForegroundColor Green
        Write-Host "Branch : $branch" -ForegroundColor Cyan
        Write-Host "HEAD   : $OriginalHead" -ForegroundColor Cyan
        Write-Host ''
        return
    }

    $unexpectedStaged = @(
        $staged |
            Where-Object { $allowedPaths -notcontains $_ } |
            Sort-Object -Unique
    )

    if ($unexpectedStaged.Count -gt 0) {
        throw "Beklenmeyen staged dosyalar tespit edildi:`n$($unexpectedStaged -join "`n")"
    }

    Invoke-External `
        -File 'git' `
        -Arguments @('commit', '-m', $CommitMessage) `
        -WorkingDirectory $Repo

    $CommitCreated = $true
    $commitHash = (& git -C $Repo rev-parse HEAD).Trim()

    Write-Step '[10/10] Commit GitHub main branchine gonderiliyor...'

    try {
        Invoke-External `
            -File 'git' `
            -Arguments @('push', 'origin', $branch) `
            -WorkingDirectory $Repo
    }
    catch {
        Write-Host ''
        Write-Host 'Commit basariyla olusturuldu fakat GitHub push basarisiz oldu.' -ForegroundColor Yellow
        Write-Host "Commit silinmedi: $commitHash" -ForegroundColor Yellow
        Write-Host 'Tekrar push etmek icin:' -ForegroundColor Cyan
        Write-Host "git -C `"$Repo`" push origin $branch" -ForegroundColor White
        throw
    }

    Write-Host ''
    Write-Host '=================================================================' -ForegroundColor Green
    Write-Host ' SCHNELLBESTELLUNG COMPLETE V2.1 GITHUB GONDERIMI BASARILI' -ForegroundColor Green
    Write-Host '=================================================================' -ForegroundColor Green
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

    Write-Host ''
    Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
    throw
}
