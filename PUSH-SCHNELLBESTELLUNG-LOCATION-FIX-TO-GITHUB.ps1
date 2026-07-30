#requires -version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Source = "C:\Web\burger"
$Repo = "C:\Web\burger-github"
$ExpectedRemoteFragment = "om3r305/burger-brothers.berlin"
$ExpectedBranch = "main"
$CommitMessage = "fix: harden Schnellbestellung location permission flow"

$ChangedFiles = @(
    "app/schnellbestellung/enter/page.tsx",
    "middleware.ts"
)

$RequiredBaseFiles = @(
    "app/schnellbestellung/page.tsx",
    "app/api/schnellbestellung/location/verify/route.ts",
    "app/api/schnellbestellung/session/route.ts",
    "app/api/schnellbestellung/catalog/route.ts",
    "app/api/schnellbestellung/orders/route.ts",
    "components/schnellbestellung/SchnellClient.tsx",
    "lib/server/schnellbestellung.ts"
)

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = "C:\Web\burger-github-backups"
$Backup = Join-Path $BackupRoot ("schnellbestellung-location-fix-" + $Stamp)
$OriginalHead = ""
$CommitCreated = $false

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Text)
    Write-Host $Text -ForegroundColor Yellow
}

function Require-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Gerekli komut bulunamadi: $Name"
    }
}

function To-WindowsPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return $Path.Replace([char]47, [char]92)
}

function Ensure-ParentDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $Parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($Parent)) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$File $($Arguments -join ' ') basarisiz oldu. Cikis kodu: $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Restore-PreCommitState {
    if ([string]::IsNullOrWhiteSpace($OriginalHead)) {
        return
    }

    Write-Host ""
    Write-Host "Commit oncesi hata olustu. GitHub klasoru geri yukleniyor..." -ForegroundColor Yellow

    & git -C $Repo reset --hard $OriginalHead | Out-Null

    foreach ($RelativePath in $ChangedFiles) {
        $WindowsRelative = To-WindowsPath -Path $RelativePath
        $Destination = Join-Path $Repo $WindowsRelative
        $BackupFile = Join-Path $Backup $WindowsRelative
        $MissingMarker = $BackupFile + ".__WAS_MISSING__"

        if (Test-Path -LiteralPath $MissingMarker -PathType Leaf) {
            Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        }
    }

    Remove-Item -LiteralPath (Join-Path $Repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " SCHNELLBESTELLUNG LOCATION FIX - TEST / COMMIT / PUSH" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

Require-Command -Name "git"
Require-Command -Name "node"
Require-Command -Name "npm.cmd"
Require-Command -Name "npx.cmd"

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Ana proje klasoru bulunamadi: $Source"
}

if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
    throw "GitHub senkronizasyon klasoru bulunamadi: $Repo"
}

if (-not (Test-Path -LiteralPath (Join-Path $Repo ".git") -PathType Container)) {
    throw "GitHub klasorunde .git bulunamadi. git init calistirilmadi."
}

foreach ($RelativePath in $ChangedFiles) {
    $SourceFile = Join-Path $Source (To-WindowsPath -Path $RelativePath)
    if (-not (Test-Path -LiteralPath $SourceFile -PathType Leaf)) {
        throw "Ana projede guncel dosya bulunamadi: $RelativePath"
    }
}

foreach ($RelativePath in $RequiredBaseFiles) {
    $SourceFile = Join-Path $Source (To-WindowsPath -Path $RelativePath)
    $RepoFile = Join-Path $Repo (To-WindowsPath -Path $RelativePath)

    if (-not (Test-Path -LiteralPath $SourceFile -PathType Leaf)) {
        throw "Ana projede Schnellbestellung temel dosyasi eksik: $RelativePath"
    }

    if (-not (Test-Path -LiteralPath $RepoFile -PathType Leaf)) {
        throw "GitHub repository Schnellbestellung temel surumunu icermiyor: $RelativePath`nOnce kumulatif Schnellbestellung surumunu GitHub'a gonder."
    }
}

$Remote = (& git -C $Repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Remote)) {
    throw "Git origin remote okunamadi."
}

if ($Remote -notmatch [regex]::Escape($ExpectedRemoteFragment)) {
    throw "Yanlis GitHub remote tespit edildi: $Remote"
}

$Branch = (& git -C $Repo branch --show-current).Trim()
if ($Branch -ne $ExpectedBranch) {
    throw "Yanlis branch tespit edildi: $Branch. Beklenen: $ExpectedBranch"
}

$DirtyBefore = @(& git -C $Repo status --porcelain=v1 --untracked-files=all)
if ($DirtyBefore.Count -gt 0) {
    Write-Host "GitHub klasoru temiz degil. Islem durduruldu:" -ForegroundColor Red
    $DirtyBefore | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    throw "Once C:\Web\burger-github klasorundeki mevcut degisiklikleri temizle veya commit et."
}

Write-Step "[1/9] Remote main branch kontrol ediliyor..."
Invoke-External -File "git" -Arguments @("fetch", "origin", $Branch) -WorkingDirectory $Repo

$RemoteRef = "origin/" + $Branch
$AheadBehindText = (& git -C $Repo rev-list --left-right --count ("HEAD..." + $RemoteRef)).Trim()
if ([string]::IsNullOrWhiteSpace($AheadBehindText)) {
    throw "Local/remote commit durumu okunamadi."
}

$AheadBehind = @($AheadBehindText -split "\s+")
if ($AheadBehind.Count -lt 2) {
    throw "Beklenmeyen Git sonucu: $AheadBehindText"
}

$Ahead = [int]$AheadBehind[0]
$Behind = [int]$AheadBehind[1]

if ($Ahead -gt 0 -and $Behind -gt 0) {
    throw "Local ve remote branch ayrismis durumda. Ahead=$Ahead Behind=$Behind"
}

if ($Ahead -gt 0) {
    throw "GitHub klasorunde push edilmemis $Ahead commit var. Once su komutu calistir: git -C `"$Repo`" push origin $Branch"
}

if ($Behind -gt 0) {
    Invoke-External -File "git" -Arguments @("pull", "--ff-only", "origin", $Branch) -WorkingDirectory $Repo
}

$OriginalHead = (& git -C $Repo rev-parse HEAD).Trim()
New-Item -ItemType Directory -Path $Backup -Force | Out-Null

try {
    Write-Step "[2/9] Yalniz iki guncel dosya yedekleniyor ve kopyalaniyor..."

    foreach ($RelativePath in $ChangedFiles) {
        $WindowsRelative = To-WindowsPath -Path $RelativePath
        $SourceFile = Join-Path $Source $WindowsRelative
        $Destination = Join-Path $Repo $WindowsRelative
        $BackupFile = Join-Path $Backup $WindowsRelative
        $MissingMarker = $BackupFile + ".__WAS_MISSING__"

        Ensure-ParentDirectory -Path $Destination
        Ensure-ParentDirectory -Path $BackupFile

        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            Copy-Item -LiteralPath $Destination -Destination $BackupFile -Force
        }
        else {
            New-Item -ItemType File -Path $MissingMarker -Force | Out-Null
        }

        Copy-Item -LiteralPath $SourceFile -Destination $Destination -Force
    }

    Write-Step "[3/9] Secret ve environment kontrolu yapiliyor..."

    foreach ($ForbiddenName in @(".env", ".env.local", ".env.production", ".env.development")) {
        if (Test-Path -LiteralPath (Join-Path $Repo $ForbiddenName) -PathType Leaf) {
            throw "GitHub klasorunde yasakli environment dosyasi bulundu: $ForbiddenName"
        }
    }

    $SecretPatterns = @(
        "(?<![A-Za-z0-9])sk_(?:live|test)_[A-Za-z0-9]{16,}",
        "(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{16,}",
        "(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}",
        "(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}",
        "(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])"
    )

    foreach ($RelativePath in $ChangedFiles) {
        $Destination = Join-Path $Repo (To-WindowsPath -Path $RelativePath)
        foreach ($Pattern in $SecretPatterns) {
            $Hits = Select-String -LiteralPath $Destination -Pattern $Pattern -AllMatches -ErrorAction SilentlyContinue
            if ($Hits) {
                throw "Muhtemel secret bulundu: $RelativePath"
            }
        }
    }

    Write-Step "[4/9] Build kalintilari temizleniyor ve Prisma Client hazirlaniyor..."
    Remove-Item -LiteralPath (Join-Path $Repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path -LiteralPath (Join-Path $Repo "node_modules") -PathType Container)) {
        Invoke-External -File "npm.cmd" -Arguments @("ci") -WorkingDirectory $Repo
    }

    Invoke-External -File "npx.cmd" -Arguments @("--no-install", "prisma", "generate") -WorkingDirectory $Repo

    Write-Step "[5/9] TypeScript ve Schnellbestellung testleri calisiyor..."
    Invoke-External -File "npm.cmd" -Arguments @("run", "typecheck") -WorkingDirectory $Repo
    Invoke-External -File "npm.cmd" -Arguments @("run", "schnell:test") -WorkingDirectory $Repo

    Write-Step "[6/9] Mevcut guvenlik testleri calisiyor..."
    Invoke-External -File "npm.cmd" -Arguments @("run", "security:test") -WorkingDirectory $Repo

    Write-Step "[7/9] Temiz production build calisiyor..."
    Invoke-External -File "npm.cmd" -Arguments @("run", "build") -WorkingDirectory $Repo

    Remove-Item -LiteralPath (Join-Path $Repo ".next") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

    $Allowed = @($ChangedFiles)
    $WorktreePaths = @()
    $WorktreePaths += @(& git -C $Repo diff --name-only)
    $WorktreePaths += @(& git -C $Repo ls-files --others --exclude-standard)
    $WorktreePaths = @(
        $WorktreePaths |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Sort-Object -Unique
    )

    $Unexpected = @($WorktreePaths | Where-Object { $Allowed -notcontains $_ })
    if ($Unexpected.Count -gt 0) {
        Write-Host "Beklenmeyen repository degisiklikleri:" -ForegroundColor Red
        $Unexpected | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "Beklenmeyen dosya degisikligi nedeniyle commit olusturulmadi."
    }

    Write-Step "[8/9] Yalniz iki dosya stage edilip commit olusturuluyor..."
    foreach ($RelativePath in $ChangedFiles) {
        Invoke-External -File "git" -Arguments @("add", "--", $RelativePath) -WorkingDirectory $Repo
    }

    Invoke-External -File "git" -Arguments @("diff", "--cached", "--check") -WorkingDirectory $Repo

    $Staged = @(& git -C $Repo diff --cached --name-only)
    if ($Staged.Count -eq 0) {
        Write-Host ""
        Write-Host "Dosyalar zaten GitHub repository ile ayni. Yeni commit gerekmiyor." -ForegroundColor Green
        Write-Host "Branch: $Branch" -ForegroundColor Cyan
        Write-Host "HEAD:   $OriginalHead" -ForegroundColor Cyan
        return
    }

    $UnexpectedStaged = @($Staged | Where-Object { $Allowed -notcontains $_ })
    if ($UnexpectedStaged.Count -gt 0) {
        throw "Beklenmeyen staged dosyalar: $($UnexpectedStaged -join ', ')"
    }

    Invoke-External -File "git" -Arguments @("commit", "-m", $CommitMessage) -WorkingDirectory $Repo
    $CommitCreated = $true
    $CommitHash = (& git -C $Repo rev-parse HEAD).Trim()

    Write-Step "[9/9] Commit GitHub main branchine gonderiliyor..."
    try {
        Invoke-External -File "git" -Arguments @("push", "origin", $Branch) -WorkingDirectory $Repo
    }
    catch {
        Write-Host ""
        Write-Host "Commit olustu fakat push basarisiz oldu. Commit silinmedi: $CommitHash" -ForegroundColor Yellow
        Write-Host "Tekrar push komutu:" -ForegroundColor Cyan
        Write-Host "git -C `"$Repo`" push origin $Branch" -ForegroundColor White
        throw
    }

    Write-Host ""
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host " SCHNELLBESTELLUNG LOCATION FIX GITHUB GONDERIMI BASARILI" -ForegroundColor Green
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host "Branch : $Branch" -ForegroundColor Cyan
    Write-Host "Commit : $CommitHash" -ForegroundColor Cyan
    Write-Host "Backup : $Backup" -ForegroundColor Cyan
    Write-Host ""
}
catch {
    if (-not $CommitCreated) {
        Restore-PreCommitState
        Write-Host "Yedek klasoru korundu: $Backup" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host ("HATA: " + $_.Exception.Message) -ForegroundColor Red
    throw
}
