#requires -version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Source = 'C:\Web\burger'
$Repo = 'C:\Web\burger-github'
$ExpectedRemoteFragment = 'om3r305/burger-brothers.berlin'
$ExpectedBranch = 'main'
$CommitMessage = 'feat: complete secure Schnellbestellung in-store ordering'

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = 'C:\Web\burger-github-backups'
$Backup = Join-Path $BackupRoot ("schnellbestellung-complete-v2-2-" + $Stamp)

$CommitCreated = $false
$OriginalHead = ''

# İlk Schnellbestellung sürümünden Complete V2.1 typecheck düzeltmesine
# kadar ilgili bütün güncel kaynaklar. PowerShell 5.1 için dizide
# özellikle satır sonu virgülü kullanılmamıştır.
$Changed = @(
    'app/admin/AdminShell.tsx'
    'app/admin/schnellbestellung/page.tsx'

    'app/api/admin/schnellbestellung/route.ts'
    'app/api/orders/list/route.ts'
    'app/api/orders/status/route.ts'
    'app/api/pause/route.ts'
    'app/api/print/jobs/route.ts'
    'app/api/schnellbestellung/access-token/route.ts'
    'app/api/schnellbestellung/catalog/route.ts'
    'app/api/schnellbestellung/location/verify/route.ts'
    'app/api/schnellbestellung/orders/route.ts'
    'app/api/schnellbestellung/session/route.ts'

    'app/checkout/page.tsx'
    'app/schnellbestellung/access-display/page.tsx'
    'app/schnellbestellung/enter/page.tsx'
    'app/schnellbestellung/page.tsx'
    'app/schnellbestellung/success/page.tsx'
    'app/tv/page.tsx'

    'components/schnellbestellung/SchnellClient.tsx'
    'components/tv/AcceptOrderOverlay.tsx'
    'components/tv/OrderCard.tsx'
    'components/tv/OrderDetailsModal.tsx'
    'components/tv/PauseBlock.tsx'
    'components/tv/SummaryGrid.tsx'
    'components/tv/TvSidebar.tsx'
    'components/tv/TvSoundControls.tsx'

    'hooks/tv/use-tv-orders.ts'
    'hooks/tv/use-tv-pause.ts'
    'hooks/tv/use-tv-print.ts'
    'hooks/tv/use-tv-sound.ts'

    'lib/pause.ts'
    'lib/server/schnellbestellung.ts'
    'lib/tv/domain.ts'

    'middleware.ts'
    'package.json'
    'print-proxy/index.cjs'
    'public/sounds/dine-in.wav'
    'tools/schnellbestellung-regression-tests.cjs'
    'types/tv.ts'

    'PUSH-SCHNELLBESTELLUNG-COMPLETE-V2.2-TO-GITHUB.ps1'
    'RUN-SCHNELLBESTELLUNG-COMPLETE-V2.2-GITHUB-PUSH.bat'
)

$TextExtensions = @(
    '.ts'
    '.tsx'
    '.js'
    '.jsx'
    '.cjs'
    '.mjs'
    '.json'
    '.md'
    '.txt'
    '.yml'
    '.yaml'
    '.ps1'
    '.bat'
    '.cmd'
    '.prisma'
    '.css'
    '.scss'
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
        throw "Gerekli komut bulunamadı: $Name"
    }
}

function Convert-ToWindowsPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return $Path.Replace([char]47, [char]92)
}

function Convert-ToForwardSlashPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return $Path.Replace([char]92, [char]47)
}

function Ensure-ParentDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $Parent = Split-Path -Parent $Path

    if (-not [string]::IsNullOrWhiteSpace($Parent)) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }
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
        $ExitCode = $LASTEXITCODE

        if ($ExitCode -ne 0) {
            $ArgumentText = $Arguments -join ' '
            throw "$File $ArgumentText başarısız oldu. Çıkış kodu: $ExitCode"
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

    $Extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()

    if ($TextExtensions -notcontains $Extension) {
        return
    }

    $Text = [System.IO.File]::ReadAllText($Path)
    $Text = $Text.Replace("`r`n", "`n").Replace("`r", "`n")

    if ($Extension -eq '.ps1' -or $Extension -eq '.bat' -or $Extension -eq '.cmd') {
        $Text = $Text.Replace("`n", "`r`n")
        $Utf8Bom = New-Object System.Text.UTF8Encoding($true)
        [System.IO.File]::WriteAllText($Path, $Text, $Utf8Bom)
        return
    }

    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

function Assert-SafeRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "Mutlak teslimat yolu yasak: $RelativePath"
    }

    $Normalized = Convert-ToForwardSlashPath -Path $RelativePath

    if ($Normalized -match '(^|/)\.\.(/|$)') {
        throw "Üst klasöre çıkan yol yasak: $RelativePath"
    }

    if ($Normalized -match '(^|/)(\.env|\.env\..+)$') {
        throw "Environment dosyası teslimat listesinde olamaz: $RelativePath"
    }
}

function Get-RepoStatusPaths {
    $Lines = @(& git -C $Repo status --porcelain=v1 --untracked-files=all)
    $Paths = @()

    foreach ($Line in $Lines) {
        if ([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -lt 4) {
            continue
        }

        $PathPart = $Line.Substring(3).Trim()

        if ($PathPart -match ' -> ') {
            $PathPart = ($PathPart -split ' -> ')[-1].Trim()
        }

        $Paths += (Convert-ToForwardSlashPath -Path $PathPart)
    }

    return @($Paths)
}

function Test-NpmScript {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptName
    )

    $PackagePath = Join-Path $Repo 'package.json'
    $Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json

    if ($null -eq $Package.scripts) {
        return $false
    }

    return ($null -ne $Package.scripts.PSObject.Properties[$ScriptName])
}

function Restore-PreCommitState {
    if ([string]::IsNullOrWhiteSpace($OriginalHead)) {
        return
    }

    Write-Host ''
    Write-Host 'Commit öncesi hata oluştu. GitHub klasörü geri yükleniyor...' -ForegroundColor Yellow

    & git -C $Repo reset --hard $OriginalHead | Out-Null

    foreach ($RelativePath in $Changed) {
        $WindowsRelative = Convert-ToWindowsPath -Path $RelativePath
        $Destination = Join-Path $Repo $WindowsRelative
        $BackupFile = Join-Path $Backup $WindowsRelative
        $MissingMarker = $BackupFile + '.__WAS_MISSING__'

        if (Test-Path -LiteralPath $MissingMarker -PathType Leaf) {
            Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Remove-Item -LiteralPath (Join-Path $Repo '.next') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '====================================================================' -ForegroundColor Cyan
Write-Host ' SCHNELLBESTELLUNG COMPLETE V2.2 / TEST / COMMIT / GITHUB PUSH' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor Cyan
Write-Host ''

Require-Command -Name 'git'
Require-Command -Name 'node'
Require-Command -Name 'npm.cmd'
Require-Command -Name 'npx.cmd'

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Ana proje klasörü bulunamadı: $Source"
}

if (-not (Test-Path -LiteralPath $Repo -PathType Container)) {
    throw "GitHub senkronizasyon klasörü bulunamadı: $Repo"
}

if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git') -PathType Container)) {
    throw "GitHub klasöründe .git bulunamadı. Script git init çalıştırmaz."
}

foreach ($RelativePath in $Changed) {
    Assert-SafeRelativePath -RelativePath $RelativePath

    $SourceFile = Join-Path $Source (Convert-ToWindowsPath -Path $RelativePath)

    if (-not (Test-Path -LiteralPath $SourceFile -PathType Leaf)) {
        throw "Ana projede gerekli teslimat dosyası bulunamadı: $RelativePath"
    }
}

$RemoteOutput = @(& git -C $Repo remote get-url origin 2>$null)

if ($LASTEXITCODE -ne 0 -or $RemoteOutput.Count -eq 0) {
    throw 'Git origin remote okunamadı.'
}

$Remote = ($RemoteOutput -join "`n").Trim()

if ($Remote -notmatch [regex]::Escape($ExpectedRemoteFragment)) {
    throw "Yanlış GitHub remote tespit edildi: $Remote"
}

$Branch = (& git -C $Repo branch --show-current).Trim()

if ([string]::IsNullOrWhiteSpace($Branch)) {
    throw 'Detached HEAD tespit edildi. Aktif branch gerekli.'
}

if ($Branch -ne $ExpectedBranch) {
    throw "Yanlış branch: $Branch. Beklenen branch: $ExpectedBranch"
}

$DirtyBefore = @(& git -C $Repo status --porcelain=v1 --untracked-files=all)

if ($DirtyBefore.Count -gt 0) {
    Write-Host ''
    Write-Host 'C:\Web\burger-github temiz değil. Mevcut değişikliklere dokunulmadı:' -ForegroundColor Red
    $DirtyBefore | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    throw 'Önce GitHub senkronizasyon klasöründeki mevcut değişiklikleri temizle veya commit et.'
}

Write-Step '[1/10] Remote main branch kontrol ediliyor...'

Invoke-External `
    -File 'git' `
    -Arguments @('fetch', 'origin', $Branch) `
    -WorkingDirectory $Repo

$RemoteRef = 'origin/' + $Branch
$AheadBehindText = (& git -C $Repo rev-list --left-right --count ("HEAD..." + $RemoteRef)).Trim()
$AheadBehind = @($AheadBehindText -split '\s+')

if ($AheadBehind.Count -lt 2) {
    throw "Local/remote durumu okunamadı: $AheadBehindText"
}

$Ahead = [int]$AheadBehind[0]
$Behind = [int]$AheadBehind[1]

if ($Ahead -gt 0 -and $Behind -gt 0) {
    throw "Local ve remote branch ayrışmış. Ahead=$Ahead Behind=$Behind"
}

if ($Ahead -gt 0) {
    throw "GitHub klasöründe henüz push edilmemiş $Ahead commit var."
}

if ($Behind -gt 0) {
    Invoke-External `
        -File 'git' `
        -Arguments @('pull', '--ff-only', 'origin', $Branch) `
        -WorkingDirectory $Repo
}

$OriginalHead = (& git -C $Repo rev-parse HEAD).Trim()

if ([string]::IsNullOrWhiteSpace($OriginalHead)) {
    throw 'Başlangıç commit hash okunamadı.'
}

New-Item -ItemType Directory -Path $Backup -Force | Out-Null

try {
    Write-Step '[2/10] Dosyalar yedekleniyor ve GitHub klasörüne kopyalanıyor...'

    foreach ($RelativePath in $Changed) {
        $WindowsRelative = Convert-ToWindowsPath -Path $RelativePath
        $SourceFile = Join-Path $Source $WindowsRelative
        $Destination = Join-Path $Repo $WindowsRelative
        $BackupFile = Join-Path $Backup $WindowsRelative
        $MissingMarker = $BackupFile + '.__WAS_MISSING__'

        Ensure-ParentDirectory -Path $Destination
        Ensure-ParentDirectory -Path $BackupFile

        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            Copy-Item -LiteralPath $Destination -Destination $BackupFile -Force
        }
        else {
            New-Item -ItemType File -Path $MissingMarker -Force | Out-Null
        }

        Copy-Item -LiteralPath $SourceFile -Destination $Destination -Force
        Normalize-TextFile -Path $Destination
    }

    Write-Step '[3/10] Environment ve secret kontrolü yapılıyor...'

    $ForbiddenRootFiles = @(
        '.env'
        '.env.local'
        '.env.production'
        '.env.development'
        '.env.test'
    )

    foreach ($ForbiddenName in $ForbiddenRootFiles) {
        if (Test-Path -LiteralPath (Join-Path $Repo $ForbiddenName) -PathType Leaf) {
            throw "GitHub klasöründe yasaklı environment dosyası bulundu: $ForbiddenName"
        }
    }

    $SecretPatterns = @(
        '(?<![A-Za-z0-9])sk_(?:live|test)_[A-Za-z0-9]{16,}'
        '(?<![A-Za-z0-9])sk-proj-[A-Za-z0-9_-]{20,}'
        '(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{16,}'
        '(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}'
        '(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}'
        '(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])'
        '(?<![0-9])[0-9]{8,10}:[A-Za-z0-9_-]{30,}'
    )

    $SecretHits = @()

    foreach ($RelativePath in $Changed) {
        $Destination = Join-Path $Repo (Convert-ToWindowsPath -Path $RelativePath)
        $Extension = [System.IO.Path]::GetExtension($Destination).ToLowerInvariant()

        if ($TextExtensions -notcontains $Extension) {
            continue
        }

        foreach ($Pattern in $SecretPatterns) {
            $Matches = Select-String `
                -LiteralPath $Destination `
                -Pattern $Pattern `
                -AllMatches `
                -ErrorAction SilentlyContinue

            if ($Matches) {
                $SecretHits += $Matches
            }
        }
    }

    if ($SecretHits.Count -gt 0) {
        $SecretHits |
            Select-Object Path, LineNumber |
            Sort-Object Path, LineNumber -Unique |
            Format-Table -AutoSize

        throw 'Teslimat dosyalarında gerçek secret olabilecek değer tespit edildi.'
    }

    Write-Step '[4/10] Build kalıntıları temizleniyor...'

    Remove-Item -LiteralPath (Join-Path $Repo '.next') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $Repo 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue

    Write-Step '[5/10] Dependencies ve Prisma Client hazırlanıyor...'

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

    Write-Step '[6/10] TypeScript ve Schnellbestellung testleri çalışıyor...'

    Invoke-External `
        -File 'npm.cmd' `
        -Arguments @('run', 'typecheck') `
        -WorkingDirectory $Repo

    if (Test-NpmScript -ScriptName 'schnell:test') {
        Invoke-External `
            -File 'npm.cmd' `
            -Arguments @('run', 'schnell:test') `
            -WorkingDirectory $Repo
    }
    else {
        Invoke-External `
            -File 'node' `
            -Arguments @('tools/schnellbestellung-regression-tests.cjs') `
            -WorkingDirectory $Repo
    }

    Write-Step '[7/10] Güvenlik testleri çalışıyor...'

    if (Test-NpmScript -ScriptName 'security:test') {
        Invoke-External `
            -File 'npm.cmd' `
            -Arguments @('run', 'security:test') `
            -WorkingDirectory $Repo
    }
    else {
        throw 'package.json içinde security:test bulunamadı.'
    }

    Write-Step '[8/10] Temiz production build çalışıyor...'

    Invoke-External `
        -File 'npm.cmd' `
        -Arguments @('run', 'build') `
        -WorkingDirectory $Repo

    $WorktreePaths = @(Get-RepoStatusPaths)
    $AllowedPaths = @(
        $Changed | ForEach-Object {
            Convert-ToForwardSlashPath -Path $_
        }
    )

    $UnexpectedPaths = @(
        $WorktreePaths |
            Where-Object { $AllowedPaths -notcontains $_ } |
            Sort-Object -Unique
    )

    if ($UnexpectedPaths.Count -gt 0) {
        Write-Host ''
        Write-Host 'Test veya build beklenmeyen dosyaları değiştirdi:' -ForegroundColor Red
        $UnexpectedPaths | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw 'Beklenmeyen repository değişikliği nedeniyle commit oluşturulmadı.'
    }

    Write-Step '[9/10] Yalnız teslimat dosyaları stage ediliyor...'

    foreach ($RelativePath in $Changed) {
        Invoke-External `
            -File 'git' `
            -Arguments @('add', '--', $RelativePath) `
            -WorkingDirectory $Repo
    }

    Invoke-External `
        -File 'git' `
        -Arguments @('diff', '--cached', '--check') `
        -WorkingDirectory $Repo

    $Staged = @(
        & git -C $Repo diff --cached --name-only |
            ForEach-Object {
                Convert-ToForwardSlashPath -Path $_
            }
    )

    if ($Staged.Count -eq 0) {
        Write-Host ''
        Write-Host 'Bütün Schnellbestellung dosyaları zaten GitHub ile aynı.' -ForegroundColor Green
        Write-Host "Branch: $Branch" -ForegroundColor Cyan
        Write-Host "HEAD:   $OriginalHead" -ForegroundColor Cyan
        return
    }

    $UnexpectedStaged = @(
        $Staged |
            Where-Object { $AllowedPaths -notcontains $_ } |
            Sort-Object -Unique
    )

    if ($UnexpectedStaged.Count -gt 0) {
        throw "Beklenmeyen staged dosyalar:`n$($UnexpectedStaged -join "`n")"
    }

    Invoke-External `
        -File 'git' `
        -Arguments @('commit', '-m', $CommitMessage) `
        -WorkingDirectory $Repo

    $CommitCreated = $true
    $CommitHash = (& git -C $Repo rev-parse HEAD).Trim()

    Write-Step '[10/10] Commit GitHub main branchine gönderiliyor...'

    try {
        Invoke-External `
            -File 'git' `
            -Arguments @('push', 'origin', $Branch) `
            -WorkingDirectory $Repo
    }
    catch {
        Write-Host ''
        Write-Host 'Commit oluşturuldu fakat push başarısız oldu.' -ForegroundColor Yellow
        Write-Host "Commit silinmedi: $CommitHash" -ForegroundColor Yellow
        Write-Host 'Tekrar push komutu:' -ForegroundColor Cyan
        Write-Host "git -C `"$Repo`" push origin $Branch" -ForegroundColor White
        throw
    }

    Write-Host ''
    Write-Host '====================================================================' -ForegroundColor Green
    Write-Host ' SCHNELLBESTELLUNG COMPLETE V2.2 GITHUB GÖNDERİMİ BAŞARILI' -ForegroundColor Green
    Write-Host '====================================================================' -ForegroundColor Green
    Write-Host "Branch: $Branch" -ForegroundColor Cyan
    Write-Host "Commit: $CommitHash" -ForegroundColor Cyan
    Write-Host "Backup: $Backup" -ForegroundColor Cyan
    Write-Host ''
}
catch {
    if (-not $CommitCreated) {
        Restore-PreCommitState
        Write-Host "Yedek klasörü korundu: $Backup" -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
    throw
}
