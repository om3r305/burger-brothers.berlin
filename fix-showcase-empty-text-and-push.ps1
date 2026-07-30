#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\Web\burger",
    [string]$RepoRoot = "C:\Web\burger-github",
    [string]$CommitMessage = "fix: preserve empty showcase text fields",
    [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Invoke-Native([string]$Label, [scriptblock]$Command) {
    Write-Step $Label
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label basarisiz oldu. Cikis kodu: $LASTEXITCODE"
    }
}

function Get-Sha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ""
    }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Test-PathInsideRoot([string]$Root, [string]$Path) {
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    return $pathFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Apply-Payloads(
    [string]$Root,
    [string]$BackupRoot,
    [object[]]$Payloads
) {
    $states = New-Object 'System.Collections.Generic.List[object]'

    foreach ($payload in $Payloads) {
        $target = Join-Path $Root $payload.Path

        if (-not (Test-PathInsideRoot -Root $Root -Path $target)) {
            throw "Proje disindaki hedef reddedildi: $target"
        }

        $exists = Test-Path -LiteralPath $target -PathType Leaf
        $currentHash = if ($exists) { Get-Sha256 -Path $target } else { "" }

        if ($exists) {
            $knownOriginal = -not [string]::IsNullOrWhiteSpace($payload.OriginalSha256)
            $isOriginal = $knownOriginal -and $currentHash -eq $payload.OriginalSha256
            $isPatched = $currentHash -eq $payload.PatchedSha256

            if (-not $isOriginal -and -not $isPatched) {
                throw "Dosya beklenen surumde degil; guvenlik icin degistirilmedi: $($payload.Path)"
            }
        }
        elseif (-not [string]::IsNullOrWhiteSpace($payload.OriginalSha256)) {
            throw "Zorunlu mevcut dosya bulunamadi: $($payload.Path)"
        }

        $backup = Join-Path $BackupRoot $payload.Path
        $backupFolder = Split-Path -Parent $backup
        if (-not (Test-Path -LiteralPath $backupFolder)) {
            New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
        }

        if ($exists) {
            Copy-Item -LiteralPath $target -Destination $backup -Force
        }

        $states.Add([pscustomobject]@{
            Path = $payload.Path
            Existed = $exists
            Backup = $backup
        })

        if ($currentHash -eq $payload.PatchedSha256) {
            Write-Host "  zaten guncel: $($payload.Path)" -ForegroundColor DarkGreen
            continue
        }

        $targetFolder = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetFolder)) {
            New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null
        }

        $base64 = $payload.Base64 -replace "\s", ""
        $bytes = [Convert]::FromBase64String($base64)
        [System.IO.File]::WriteAllBytes($target, $bytes)

        $writtenHash = Get-Sha256 -Path $target
        if ($writtenHash -ne $payload.PatchedSha256) {
            throw "Yazilan dosyanin hash dogrulamasi basarisiz: $($payload.Path)"
        }

        Write-Host "  uygulandi: $($payload.Path)" -ForegroundColor Green
    }

    return $states.ToArray()
}

function Restore-Payloads(
    [string]$Root,
    [object[]]$States
) {
    foreach ($state in $States) {
        $target = Join-Path $Root $state.Path

        if ($state.Existed) {
            $folder = Split-Path -Parent $target
            if (-not (Test-Path -LiteralPath $folder)) {
                New-Item -ItemType Directory -Path $folder -Force | Out-Null
            }
            Copy-Item -LiteralPath $state.Backup -Destination $target -Force
        }
        elseif (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Force
        }
    }
}

function Test-PayloadSecrets([string]$Root, [object[]]$Payloads) {
    Write-Step "Degisen dosyalarda secret taramasi yapiliyor"

    $patterns = @(
        'sk_(live|test)_[A-Za-z0-9]{16,}',
        'whsec_[A-Za-z0-9]{16,}',
        'gh[pousr]_[A-Za-z0-9]{20,}',
        'xox[baprs]-[A-Za-z0-9-]{20,}',
        'cloudinary://[0-9]+:[^@\s]+@',
        '-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----'
    )

    foreach ($payload in $Payloads) {
        $path = Join-Path $Root $payload.Path
        $content = Get-Content -LiteralPath $path -Raw

        foreach ($pattern in $patterns) {
            if ($content -match $pattern) {
                throw "Muhtemel secret bulundu: $($payload.Path)"
            }
        }
    }

    Write-Host "  Secret bulgusu yok." -ForegroundColor Green
}

function Invoke-ShowcaseTests([string]$Root) {
    Write-Step "Showcase regresyon testleri calistiriliyor"

    $tests = @(
        "tools\showcase-empty-text-regression-tests.cjs",
        "tools\showcase-regression-tests.cjs",
        "tools\showcase-v4-regression-tests.cjs",
        "tools\showcase-v5-regression-tests.cjs",
        "tools\showcase-v6-message-tests.cjs",
        "tools\showcase-timer-regression-tests.cjs"
    )

    foreach ($relative in $tests) {
        $path = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Gerekli Showcase testi bulunamadi: $relative"
        }

        Write-Host "  test: $relative" -ForegroundColor DarkGray
        & node.exe $path
        if ($LASTEXITCODE -ne 0) {
            throw "Showcase testi basarisiz: $relative"
        }
    }
}

function Invoke-ProjectValidation([string]$Root, [bool]$InstallWhenMissing) {
    Push-Location $Root
    try {
        if (
            $InstallWhenMissing -and
            -not (Test-Path -LiteralPath (Join-Path $Root "node_modules") -PathType Container)
        ) {
            Invoke-Native "Dependency kurulumu" {
                npm.cmd ci --no-audit --no-fund
            }
        }

        Invoke-ShowcaseTests -Root $Root

        if (Test-Path -LiteralPath (Join-Path $Root "prisma\schema.prisma") -PathType Leaf) {
            Invoke-Native "Prisma Client uretiliyor" {
                npx.cmd prisma generate
            }
        }

        Invoke-Native "TypeScript kontrolu" {
            npm.cmd run typecheck
        }

        $nextPath = Join-Path $Root ".next"
        if (Test-Path -LiteralPath $nextPath) {
            Remove-Item -LiteralPath $nextPath -Recurse -Force
        }

        Invoke-Native "Temiz production build" {
            npm.cmd run build
        }
    }
    finally {
        Pop-Location
    }
}

function Normalize-GitStatusPath([string]$Line) {
    if ([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -lt 4) {
        return ""
    }

    $path = $Line.Substring(3).Trim()
    if ($path.Contains(" -> ")) {
        $path = ($path -split " -> ", 2)[1].Trim()
    }

    return $path.Trim('"').Replace("\", "/")
}

function Get-RepoDirtyPaths([string]$Root) {
    Push-Location $Root
    try {
        $lines = @(& git.exe status --porcelain)
        if ($LASTEXITCODE -ne 0) {
            throw "git status okunamadi."
        }

        return @(
            $lines |
            ForEach-Object { Normalize-GitStatusPath $_ } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
    }
    finally {
        Pop-Location
    }
}

function Assert-RepoDirtyScope([string]$Root, [string[]]$AllowedPaths) {
    $dirty = @(Get-RepoDirtyPaths -Root $Root)
    if ($dirty.Count -eq 0) {
        Write-Host "  GitHub repo temiz." -ForegroundColor Green
        return
    }

    $unexpected = @(
        $dirty |
        Where-Object { $AllowedPaths -notcontains $_ }
    )

    if ($unexpected.Count -gt 0) {
        Write-Host ""
        Write-Host "Teslimat kapsami disinda repo degisiklikleri bulundu:" -ForegroundColor Red
        $unexpected | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        throw "Ilgisiz dosyalara dokunmamak icin islem durduruldu."
    }

    Write-Host "  Yalniz bu teslimata ait yarim degisiklikler var; uzerine final surum uygulanacak." -ForegroundColor Yellow
}

$Payloads = @(
    [pscustomobject]@{
        Path = "lib\showcase\config.ts"
        GitPath = "lib/showcase/config.ts"
        OriginalSha256 = "5F430179A0583CFF64BF8FD07C1703809AF99D2683DADEA62D03E3722FA16EF6"
        PatchedSha256 = "E4B33D57FBE04F02A782C6C0FBF971902AB233605CA51EBAF4D8860783EA3BC5"
        Base64 = @'
aW1wb3J0IHR5cGUgewogIFNob3djYXNlRG9jdW1lbnQsCiAgU2hvd2Nhc2VNZWRpYUl0ZW0sCiAgU2hvd2Nhc2VTY2VuZSwKICBTaG93Y2FzZVNjZW5lVHlw
ZSwKICBTaG93Y2FzZVRyYW5zaXRpb24sCn0gZnJvbSAiLi90eXBlcyI7CmltcG9ydCB7IG5vcm1hbGl6ZVNob3djYXNlQ2F0ZWdvcnkgfSBmcm9tICIuL3J1
bnRpbWUiOwoKY29uc3QgU0NFTkVfVFlQRVMgPSBuZXcgU2V0PFNob3djYXNlU2NlbmVUeXBlPihbCiAgImhlcm8iLAogICJ2aWRlbyIsCiAgInByb2R1Y3Qi
LAogICJtZW51IiwKICAiY2FtcGFpZ24iLAogICJpbWFnZSIsCiAgInFyIiwKICAibWVzc2FnZSIsCl0pOwoKY29uc3QgVFJBTlNJVElPTlMgPSBuZXcgU2V0
PFNob3djYXNlVHJhbnNpdGlvbj4oWwogICJmYWRlIiwKICAic2xpZGUiLAogICJ6b29tIiwKICAibm9uZSIsCl0pOwoKZnVuY3Rpb24gY2xlYW5UZXh0KHZh
bHVlOiBhbnksIG1heCA9IDMwMCkgewogIHJldHVybiBTdHJpbmcodmFsdWUgPz8gIiIpLnRyaW0oKS5zbGljZSgwLCBtYXgpOwp9CgpmdW5jdGlvbiBoYXNP
d24odmFsdWU6IGFueSwga2V5OiBzdHJpbmcpIHsKICByZXR1cm4gQm9vbGVhbih2YWx1ZSkgJiYgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5j
YWxsKHZhbHVlLCBrZXkpOwp9CgpmdW5jdGlvbiBjbGVhblN0cmluZ0xpc3QodmFsdWU6IGFueSwgbWF4SXRlbXM6IG51bWJlciwgbWF4TGVuZ3RoID0gMTIw
KSB7CiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIFtdOwogIHJldHVybiBBcnJheS5mcm9tKAogICAgbmV3IFNldCgKICAgICAgdmFsdWUK
ICAgICAgICAuc2xpY2UoMCwgbWF4SXRlbXMpCiAgICAgICAgLm1hcCgoaXRlbSkgPT4gY2xlYW5UZXh0KGl0ZW0sIG1heExlbmd0aCkpCiAgICAgICAgLmZp
bHRlcihCb29sZWFuKSwKICAgICksCiAgKTsKfQoKZnVuY3Rpb24gY2xlYW5VcmwodmFsdWU6IGFueSwgbWF4ID0gMl8wMDApIHsKICBjb25zdCB0ZXh0ID0g
Y2xlYW5UZXh0KHZhbHVlLCBtYXgpOwogIGlmICghdGV4dCkgcmV0dXJuICIiOwogIGlmICh0ZXh0LnN0YXJ0c1dpdGgoIi8iKSkgcmV0dXJuIHRleHQ7Cgog
IHRyeSB7CiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHRleHQpOwogICAgcmV0dXJuIFsiaHR0cDoiLCAiaHR0cHM6Il0uaW5jbHVkZXModXJsLnByb3RvY29s
KSA/IHVybC50b1N0cmluZygpIDogIiI7CiAgfSBjYXRjaCB7CiAgICByZXR1cm4gIiI7CiAgfQp9CgpmdW5jdGlvbiBjbGVhbkRhdGUodmFsdWU6IGFueSkg
ewogIGlmICghdmFsdWUpIHJldHVybiAiIjsKICBjb25zdCBkYXRlID0gbmV3IERhdGUodmFsdWUpOwogIHJldHVybiBOdW1iZXIuaXNGaW5pdGUoZGF0ZS52
YWx1ZU9mKCkpID8gZGF0ZS50b0lTT1N0cmluZygpIDogIiI7Cn0KCmZ1bmN0aW9uIGJvb2wodmFsdWU6IGFueSwgZmFsbGJhY2s6IGJvb2xlYW4pIHsKICBy
ZXR1cm4gdHlwZW9mIHZhbHVlID09PSAiYm9vbGVhbiIgPyB2YWx1ZSA6IGZhbGxiYWNrOwp9CgpmdW5jdGlvbiBudW1iZXJJblJhbmdlKHZhbHVlOiBhbnks
IGZhbGxiYWNrOiBudW1iZXIsIG1pbjogbnVtYmVyLCBtYXg6IG51bWJlcikgewogIGNvbnN0IG51bWJlciA9IE51bWJlcih2YWx1ZSk7CiAgaWYgKCFOdW1i
ZXIuaXNGaW5pdGUobnVtYmVyKSkgcmV0dXJuIGZhbGxiYWNrOwogIHJldHVybiBNYXRoLm1pbihtYXgsIE1hdGgubWF4KG1pbiwgbnVtYmVyKSk7Cn0KCmZ1
bmN0aW9uIGlkKHZhbHVlOiBhbnksIHByZWZpeCA9ICJzY2VuZSIpIHsKICBjb25zdCB0ZXh0ID0gY2xlYW5UZXh0KHZhbHVlLCAxMDApLnJlcGxhY2UoL1te
YS16QS1aMC05Xy1dL2csICIiKTsKICBpZiAodGV4dCkgcmV0dXJuIHRleHQ7CiAgcmV0dXJuIGAke3ByZWZpeH0tJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2
KX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA5KX1gOwp9CgpleHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNob3djYXNlRG9j
dW1lbnQoc2l0ZVVybCA9ICJodHRwczovL3d3dy5idXJnZXItYnJvdGhlcnMuYmVybGluIik6IFNob3djYXNlRG9jdW1lbnQgewogIGNvbnN0IG5vdyA9IG5l
dyBEYXRlKCkudG9JU09TdHJpbmcoKTsKCiAgcmV0dXJuIHsKICAgIHNjaGVtYVZlcnNpb246IDEsCiAgICB2ZXJzaW9uOiBgaW5pdGlhbC0ke0RhdGUubm93
KCkudG9TdHJpbmcoMzYpfWAsCiAgICBlbmFibGVkOiB0cnVlLAogICAgdXBkYXRlZEF0OiBub3csCiAgICBzZXR0aW5nczogewogICAgICBuYW1lOiAiQnVy
Z2VyIEJyb3RoZXJzIFZpdHJpbiBFa3JhbsSxIiwKICAgICAgZGVmYXVsdER1cmF0aW9uU2Vjb25kczogNDUsCiAgICAgIHJlZnJlc2hTZWNvbmRzOiAzLAog
ICAgICBzaG93Q2xvY2s6IHRydWUsCiAgICAgIHNob3dQcm9ncmVzczogdHJ1ZSwKICAgICAgc2hvd0Nvbm5lY3Rpb25TdGF0ZTogZmFsc2UsCiAgICAgIHFy
VXJsOiBzaXRlVXJsLAogICAgICBxckxhYmVsOiAiSmV0enQgb25saW5lIGJlc3RlbGxlbiIsCiAgICAgIHRpY2tlcjogIkZyaXNjaCBnZWdyaWxsdCDigKIg
RGlyZWt0IG9ubGluZSBiZXN0ZWxsZW4g4oCiIEJ1cmdlciBCcm90aGVycyBCZXJsaW4iLAogICAgICBiYWNrZ3JvdW5kOiAidGhlbWUiLAogICAgfSwKICAg
IHNjZW5lczogWwogICAgICB7CiAgICAgICAgaWQ6ICJ3aWxsa29tbWVuIiwKICAgICAgICB0eXBlOiAiaGVybyIsCiAgICAgICAgbmFtZTogIkthcsWfxLFs
YW1hIiwKICAgICAgICBlbmFibGVkOiB0cnVlLAogICAgICAgIGR1cmF0aW9uU2Vjb25kczogNDUsCiAgICAgICAgdHJhbnNpdGlvbjogImZhZGUiLAogICAg
ICAgIHRpdGxlOiAiSkVUWlQgT05MSU5FIEJFU1RFTExFTiIsCiAgICAgICAgc3VidGl0bGU6ICJRUi1Db2RlIHNjYW5uZW4gdW5kIGRpcmVrdCB6dXIgU3Bl
aXNla2FydGUiLAogICAgICAgIGJhZGdlOiAiQkVSTElOLVRFR0VMIiwKICAgICAgICBxckxhYmVsOiAiSmV0enQgb25saW5lIGJlc3RlbGxlbiIsCiAgICAg
ICAgc2hvd0xvZ286IHRydWUsCiAgICAgICAgc2hvd1FyOiB0cnVlLAogICAgICAgIGZpdDogImNvdmVyIiwKICAgICAgICBtdXRlZDogdHJ1ZSwKICAgICAg
fSwKICAgICAgewogICAgICAgIGlkOiAib25saW5lLWJlc3RlbGxlbiIsCiAgICAgICAgdHlwZTogInFyIiwKICAgICAgICBuYW1lOiAiT25saW5lIHNpcGFy
acWfIiwKICAgICAgICBlbmFibGVkOiB0cnVlLAogICAgICAgIGR1cmF0aW9uU2Vjb25kczogMjUsCiAgICAgICAgdHJhbnNpdGlvbjogInpvb20iLAogICAg
ICAgIHRpdGxlOiAiSkVUWlQgT05MSU5FIEJFU1RFTExFTiIsCiAgICAgICAgc3VidGl0bGU6ICJRUi1Db2RlIHNjYW5uZW4gdW5kIGRpcmVrdCB6dXIgU3Bl
aXNla2FydGUiLAogICAgICAgIHFyVXJsOiBzaXRlVXJsLAogICAgICAgIHFyTGFiZWw6ICJidXJnZXItYnJvdGhlcnMuYmVybGluIiwKICAgICAgICBzaG93
TG9nbzogdHJ1ZSwKICAgICAgICBzaG93UXI6IHRydWUsCiAgICAgICAgZml0OiAiY29udGFpbiIsCiAgICAgICAgbXV0ZWQ6IHRydWUsCiAgICAgIH0sCiAg
ICBdLAogIH07Cn0KCmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTaG93Y2FzZVNjZW5lKHZhbHVlOiBhbnksIGZhbGxiYWNrRHVyYXRpb24gPSA0NSk6IFNo
b3djYXNlU2NlbmUgewogIGNvbnN0IHR5cGUgPSBTQ0VORV9UWVBFUy5oYXModmFsdWU/LnR5cGUpID8gdmFsdWUudHlwZSA6ICJtZXNzYWdlIjsKICBjb25z
dCB0cmFuc2l0aW9uID0gVFJBTlNJVElPTlMuaGFzKHZhbHVlPy50cmFuc2l0aW9uKSA/IHZhbHVlLnRyYW5zaXRpb24gOiAiZmFkZSI7CiAgY29uc3QgYWNj
ZW50ID0gL14jWzAtOWEtZl17Nn0kL2kudGVzdChTdHJpbmcodmFsdWU/LmFjY2VudCB8fCAiIikpCiAgICA/IFN0cmluZyh2YWx1ZS5hY2NlbnQpCiAgICA6
ICIjZmY5ZDJlIjsKICBjb25zdCBsZWdhY3lQcm9kdWN0SWQgPSBjbGVhblRleHQodmFsdWU/LnByb2R1Y3RJZCwgMTIwKTsKICBjb25zdCBwcm9kdWN0SWRz
ID0gY2xlYW5TdHJpbmdMaXN0KHZhbHVlPy5wcm9kdWN0SWRzLCA1MCwgMTIwKTsKICBjb25zdCBtZW51Q2F0ZWdvcmllcyA9IEFycmF5LmZyb20oCiAgICBu
ZXcgU2V0KAogICAgICBjbGVhblN0cmluZ0xpc3QodmFsdWU/Lm1lbnVDYXRlZ29yaWVzLCAzMCwgODApCiAgICAgICAgLm1hcCgoY2F0ZWdvcnkpID0+IG5v
cm1hbGl6ZVNob3djYXNlQ2F0ZWdvcnkoY2F0ZWdvcnkpKQogICAgICAgIC5maWx0ZXIoQm9vbGVhbiksCiAgICApLAogICk7CiAgY29uc3Qgbm9ybWFsaXpl
ZFByb2R1Y3RJZHMgPSBwcm9kdWN0SWRzLmxlbmd0aAogICAgPyBwcm9kdWN0SWRzCiAgICA6IGxlZ2FjeVByb2R1Y3RJZAogICAgICA/IFtsZWdhY3lQcm9k
dWN0SWRdCiAgICAgIDogW107CiAgY29uc3Qgc2hvd0xvZ29GYWxsYmFjayA9IHR5cGUgPT09ICJwcm9kdWN0IiB8fCB0eXBlID09PSAibWVudSIgPyBmYWxz
ZSA6IHRydWU7CgogIHJldHVybiB7CiAgICBpZDogaWQodmFsdWU/LmlkKSwKICAgIHR5cGUsCiAgICBuYW1lOiBjbGVhblRleHQodmFsdWU/Lm5hbWUgfHwg
dmFsdWU/LnRpdGxlIHx8ICJTYWhuZSIsIDEyMCksCiAgICBlbmFibGVkOiBib29sKHZhbHVlPy5lbmFibGVkLCB0cnVlKSwKICAgIGR1cmF0aW9uU2Vjb25k
czogbnVtYmVySW5SYW5nZSh2YWx1ZT8uZHVyYXRpb25TZWNvbmRzLCBmYWxsYmFja0R1cmF0aW9uLCA1LCAzXzYwMCksCiAgICB0cmFuc2l0aW9uLAogICAg
c3RhcnRBdDogY2xlYW5EYXRlKHZhbHVlPy5zdGFydEF0KSB8fCB1bmRlZmluZWQsCiAgICBlbmRBdDogY2xlYW5EYXRlKHZhbHVlPy5lbmRBdCkgfHwgdW5k
ZWZpbmVkLAogICAgLy8gRWtyYW5kYSBkw7x6ZW5sZW5lYmlsZW4gbWV0aW5sZXIgYm/FnyBixLFyYWvEsWxkxLHEn8SxbmRhIGJvxZ8ga2FsbWFsxLFkxLFy
LgogICAgLy8gQm/FnyBzdHJpbmdpIHVuZGVmaW5lZCdhIMOnZXZpcm1laywgb3luYXTEsWPEsWRha2kgZmFsbGJhY2sgeWF6xLFsYXLEsW7EsSB5ZW5pZGVu
IGfDtnN0ZXJpeW9yZHUuCiAgICB0aXRsZTogY2xlYW5UZXh0KHZhbHVlPy50aXRsZSwgMTgwKSwKICAgIHN1YnRpdGxlOiBjbGVhblRleHQodmFsdWU/LnN1
YnRpdGxlLCAyNjApLAogICAgYm9keTogY2xlYW5UZXh0KHZhbHVlPy5ib2R5LCAxXzIwMCksCiAgICBiYWRnZTogY2xlYW5UZXh0KHZhbHVlPy5iYWRnZSwg
ODApLAogICAgbWVkaWFVcmw6IGNsZWFuVXJsKHZhbHVlPy5tZWRpYVVybCkgfHwgdW5kZWZpbmVkLAogICAgcG9zdGVyVXJsOiBjbGVhblVybCh2YWx1ZT8u
cG9zdGVyVXJsKSB8fCB1bmRlZmluZWQsCiAgICBwcm9kdWN0SWQ6IG5vcm1hbGl6ZWRQcm9kdWN0SWRzWzBdIHx8IHVuZGVmaW5lZCwKICAgIHByb2R1Y3RJ
ZHM6IG5vcm1hbGl6ZWRQcm9kdWN0SWRzLmxlbmd0aCA/IG5vcm1hbGl6ZWRQcm9kdWN0SWRzIDogdW5kZWZpbmVkLAogICAgcHJvZHVjdFNlY29uZHM6IG51
bWJlckluUmFuZ2UodmFsdWU/LnByb2R1Y3RTZWNvbmRzLCAxMiwgNiwgMTIwKSwKICAgIHByb2R1Y3RJbWFnZUZpdDogdmFsdWU/LnByb2R1Y3RJbWFnZUZp
dCA9PT0gImNvdmVyIiA/ICJjb3ZlciIgOiAiY29udGFpbiIsCiAgICBwcm9kdWN0SW1hZ2VTY2FsZTogbnVtYmVySW5SYW5nZSh2YWx1ZT8ucHJvZHVjdElt
YWdlU2NhbGUsIDc4LCAzNSwgMTMwKSwKICAgIHByb2R1Y3RJbWFnZVg6IG51bWJlckluUmFuZ2UodmFsdWU/LnByb2R1Y3RJbWFnZVgsIDAsIC00MCwgNDAp
LAogICAgcHJvZHVjdEltYWdlWTogbnVtYmVySW5SYW5nZSh2YWx1ZT8ucHJvZHVjdEltYWdlWSwgMCwgLTQwLCA0MCksCiAgICBtZW51Q2F0ZWdvcmllcywK
ICAgIG1lbnVJdGVtc1BlclBhZ2U6IG51bWJlckluUmFuZ2UodmFsdWU/Lm1lbnVJdGVtc1BlclBhZ2UsIDgsIDQsIDI0KSwKICAgIG1lbnVQYWdlU2Vjb25k
czogbnVtYmVySW5SYW5nZSh2YWx1ZT8ubWVudVBhZ2VTZWNvbmRzLCAxMiwgNiwgMTIwKSwKICAgIG1lbnVDb2x1bW5zOiBOdW1iZXIodmFsdWU/Lm1lbnVD
b2x1bW5zKSA9PT0gMyA/IDMgOiAyLAogICAgbWVudVNob3dEZXNjcmlwdGlvbnM6IGJvb2wodmFsdWU/Lm1lbnVTaG93RGVzY3JpcHRpb25zLCBmYWxzZSks
CiAgICBtZW51U2hvd0ltYWdlczogYm9vbCh2YWx1ZT8ubWVudVNob3dJbWFnZXMsIHRydWUpLAogICAgbWVudUltYWdlU2l6ZTogbnVtYmVySW5SYW5nZSh2
YWx1ZT8ubWVudUltYWdlU2l6ZSwgNTgsIDM2LCAxMDQpLAogICAgY2FtcGFpZ25JZDogY2xlYW5UZXh0KHZhbHVlPy5jYW1wYWlnbklkLCAxMjApIHx8IHVu
ZGVmaW5lZCwKICAgIHFyVXJsOiBjbGVhblVybCh2YWx1ZT8ucXJVcmwpIHx8IHVuZGVmaW5lZCwKICAgIHFyTGFiZWw6IGNsZWFuVGV4dCh2YWx1ZT8ucXJM
YWJlbCwgMTIwKSwKICAgIGFjY2VudCwKICAgIGZpdDogdmFsdWU/LmZpdCA9PT0gImNvbnRhaW4iID8gImNvbnRhaW4iIDogImNvdmVyIiwKICAgIHNob3dM
b2dvOiBib29sKHZhbHVlPy5zaG93TG9nbywgc2hvd0xvZ29GYWxsYmFjayksCiAgICBzaG93UXI6IGJvb2wodmFsdWU/LnNob3dRciwgZmFsc2UpLAogICAg
c2hvd1ByaWNlOiBib29sKHZhbHVlPy5zaG93UHJpY2UsIHRydWUpLAogICAgbXV0ZWQ6IHRydWUsCiAgfTsKfQoKZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6
ZVNob3djYXNlRG9jdW1lbnQodmFsdWU6IGFueSwgc2l0ZVVybCA9ICJodHRwczovL3d3dy5idXJnZXItYnJvdGhlcnMuYmVybGluIik6IFNob3djYXNlRG9j
dW1lbnQgewogIGNvbnN0IGRlZmF1bHRzID0gY3JlYXRlRGVmYXVsdFNob3djYXNlRG9jdW1lbnQoc2l0ZVVybCk7CiAgY29uc3QgZGVmYXVsdER1cmF0aW9u
ID0gbnVtYmVySW5SYW5nZSgKICAgIHZhbHVlPy5zZXR0aW5ncz8uZGVmYXVsdER1cmF0aW9uU2Vjb25kcywKICAgIGRlZmF1bHRzLnNldHRpbmdzLmRlZmF1
bHREdXJhdGlvblNlY29uZHMsCiAgICA1LAogICAgM182MDAsCiAgKTsKICBjb25zdCBzY2VuZXMgPSBBcnJheS5pc0FycmF5KHZhbHVlPy5zY2VuZXMpCiAg
ICA/IHZhbHVlLnNjZW5lcy5zbGljZSgwLCAxMDApLm1hcCgoc2NlbmU6IGFueSkgPT4gbm9ybWFsaXplU2hvd2Nhc2VTY2VuZShzY2VuZSwgZGVmYXVsdER1
cmF0aW9uKSkKICAgIDogZGVmYXVsdHMuc2NlbmVzOwoKICByZXR1cm4gewogICAgc2NoZW1hVmVyc2lvbjogMSwKICAgIHZlcnNpb246IGNsZWFuVGV4dCh2
YWx1ZT8udmVyc2lvbiwgMTIwKSB8fCBgZHJhZnQtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLAogICAgZW5hYmxlZDogYm9vbCh2YWx1ZT8uZW5hYmxl
ZCwgdHJ1ZSksCiAgICB1cGRhdGVkQXQ6IGNsZWFuRGF0ZSh2YWx1ZT8udXBkYXRlZEF0KSB8fCBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksCiAgICBwdWJs
aXNoZWRBdDogY2xlYW5EYXRlKHZhbHVlPy5wdWJsaXNoZWRBdCkgfHwgdW5kZWZpbmVkLAogICAgc2V0dGluZ3M6IHsKICAgICAgbmFtZTogY2xlYW5UZXh0
KHZhbHVlPy5zZXR0aW5ncz8ubmFtZSwgMTIwKSB8fCBkZWZhdWx0cy5zZXR0aW5ncy5uYW1lLAogICAgICBkZWZhdWx0RHVyYXRpb25TZWNvbmRzOiBkZWZh
dWx0RHVyYXRpb24sCiAgICAgIHJlZnJlc2hTZWNvbmRzOiBudW1iZXJJblJhbmdlKHZhbHVlPy5zZXR0aW5ncz8ucmVmcmVzaFNlY29uZHMsIDMsIDIsIDUp
LAogICAgICBzaG93Q2xvY2s6IGJvb2wodmFsdWU/LnNldHRpbmdzPy5zaG93Q2xvY2ssIHRydWUpLAogICAgICBzaG93UHJvZ3Jlc3M6IGJvb2wodmFsdWU/
LnNldHRpbmdzPy5zaG93UHJvZ3Jlc3MsIHRydWUpLAogICAgICBzaG93Q29ubmVjdGlvblN0YXRlOiBib29sKHZhbHVlPy5zZXR0aW5ncz8uc2hvd0Nvbm5l
Y3Rpb25TdGF0ZSwgZmFsc2UpLAogICAgICBxclVybDogY2xlYW5VcmwodmFsdWU/LnNldHRpbmdzPy5xclVybCkgfHwgc2l0ZVVybCwKICAgICAgLy8gQXlh
ciBhbmFodGFyxLEgaGnDpyB5b2tzYSBpbGsga3VydWx1bSB2YXJzYXnEsWxhbsSxbsSxIGt1bGxhbi4KICAgICAgLy8gQW5haHRhciBtZXZjdXQgdmUgZGXE
n2VyIGJvxZ9zYSBrdWxsYW7EsWPEsW7EsW4gImdpemxlIiB0ZXJjaWhpbmkga29ydS4KICAgICAgcXJMYWJlbDogaGFzT3duKHZhbHVlPy5zZXR0aW5ncywg
InFyTGFiZWwiKQogICAgICAgID8gY2xlYW5UZXh0KHZhbHVlPy5zZXR0aW5ncz8ucXJMYWJlbCwgMTIwKQogICAgICAgIDogZGVmYXVsdHMuc2V0dGluZ3Mu
cXJMYWJlbCwKICAgICAgdGlja2VyOiBoYXNPd24odmFsdWU/LnNldHRpbmdzLCAidGlja2VyIikKICAgICAgICA/IGNsZWFuVGV4dCh2YWx1ZT8uc2V0dGlu
Z3M/LnRpY2tlciwgNTAwKQogICAgICAgIDogZGVmYXVsdHMuc2V0dGluZ3MudGlja2VyLAogICAgICBiYWNrZ3JvdW5kOiBbInRoZW1lIiwgImRhcmsiLCAi
YmxhY2siXS5pbmNsdWRlcyh2YWx1ZT8uc2V0dGluZ3M/LmJhY2tncm91bmQpCiAgICAgICAgPyB2YWx1ZS5zZXR0aW5ncy5iYWNrZ3JvdW5kCiAgICAgICAg
OiAidGhlbWUiLAogICAgfSwKICAgIHNjZW5lczogc2NlbmVzLmxlbmd0aCA/IHNjZW5lcyA6IGRlZmF1bHRzLnNjZW5lcywKICB9Owp9CgpleHBvcnQgZnVu
Y3Rpb24gbm9ybWFsaXplU2hvd2Nhc2VNZWRpYUxpc3QodmFsdWU6IGFueSk6IFNob3djYXNlTWVkaWFJdGVtW10gewogIGlmICghQXJyYXkuaXNBcnJheSh2
YWx1ZSkpIHJldHVybiBbXTsKCiAgcmV0dXJuIHZhbHVlCiAgICAuc2xpY2UoMCwgNTAwKQogICAgLm1hcCgoaXRlbTogYW55KSA9PiAoewogICAgICBpZDog
aWQoaXRlbT8uaWQsICJtZWRpYSIpLAogICAgICBrZXk6IGNsZWFuVGV4dChpdGVtPy5rZXkgfHwgaXRlbT8ucHVibGljSWQsIDUwMCksCiAgICAgIHByb3Zp
ZGVyOiBbImNsb3VkaW5hcnkiLCAicjIiLCAiZXh0ZXJuYWwiXS5pbmNsdWRlcyhpdGVtPy5wcm92aWRlcikKICAgICAgICA/IGl0ZW0ucHJvdmlkZXIKICAg
ICAgICA6IHVuZGVmaW5lZCwKICAgICAgcHVibGljSWQ6IGNsZWFuVGV4dChpdGVtPy5wdWJsaWNJZCwgNTAwKSB8fCB1bmRlZmluZWQsCiAgICAgIHJlc291
cmNlVHlwZTogWyJpbWFnZSIsICJ2aWRlbyJdLmluY2x1ZGVzKGl0ZW0/LnJlc291cmNlVHlwZSkKICAgICAgICA/IGl0ZW0ucmVzb3VyY2VUeXBlCiAgICAg
ICAgOiB1bmRlZmluZWQsCiAgICAgIGFzc2V0SWQ6IGNsZWFuVGV4dChpdGVtPy5hc3NldElkLCAxNjApIHx8IHVuZGVmaW5lZCwKICAgICAgdmVyc2lvbjog
aXRlbT8udmVyc2lvbgogICAgICAgID8gbnVtYmVySW5SYW5nZShpdGVtLnZlcnNpb24sIDAsIDAsIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSKQogICAgICAg
IDogdW5kZWZpbmVkLAogICAgICBmb3JtYXQ6IGNsZWFuVGV4dChpdGVtPy5mb3JtYXQsIDMwKSB8fCB1bmRlZmluZWQsCiAgICAgIG5hbWU6IGNsZWFuVGV4
dChpdGVtPy5uYW1lLCAyMjApIHx8ICJEb3N5YSIsCiAgICAgIHVybDogY2xlYW5VcmwoaXRlbT8udXJsKSwKICAgICAgbWltZVR5cGU6IGNsZWFuVGV4dChp
dGVtPy5taW1lVHlwZSwgMTIwKSwKICAgICAgc2l6ZTogbnVtYmVySW5SYW5nZShpdGVtPy5zaXplLCAwLCAwLCAyXzAwMF8wMDBfMDAwKSwKICAgICAgY3Jl
YXRlZEF0OiBjbGVhbkRhdGUoaXRlbT8uY3JlYXRlZEF0KSB8fCBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksCiAgICAgIHdpZHRoOiBpdGVtPy53aWR0aCA/
IG51bWJlckluUmFuZ2UoaXRlbS53aWR0aCwgMCwgMCwgMjBfMDAwKSA6IHVuZGVmaW5lZCwKICAgICAgaGVpZ2h0OiBpdGVtPy5oZWlnaHQgPyBudW1iZXJJ
blJhbmdlKGl0ZW0uaGVpZ2h0LCAwLCAwLCAyMF8wMDApIDogdW5kZWZpbmVkLAogICAgICBkdXJhdGlvblNlY29uZHM6IGl0ZW0/LmR1cmF0aW9uU2Vjb25k
cwogICAgICAgID8gbnVtYmVySW5SYW5nZShpdGVtLmR1cmF0aW9uU2Vjb25kcywgMCwgMCwgODZfNDAwKQogICAgICAgIDogdW5kZWZpbmVkLAogICAgfSkp
CiAgICAuZmlsdGVyKChpdGVtKSA9PiBpdGVtLmtleSAmJiBpdGVtLnVybCAmJiBpdGVtLm1pbWVUeXBlKTsKfQoKZXhwb3J0IGZ1bmN0aW9uIHNjZW5lSXNB
Y3RpdmUoc2NlbmU6IFNob3djYXNlU2NlbmUsIG5vdyA9IERhdGUubm93KCkpIHsKICBpZiAoIXNjZW5lLmVuYWJsZWQpIHJldHVybiBmYWxzZTsKICBjb25z
dCBzdGFydCA9IHNjZW5lLnN0YXJ0QXQgPyBEYXRlLnBhcnNlKHNjZW5lLnN0YXJ0QXQpIDogTmFOOwogIGNvbnN0IGVuZCA9IHNjZW5lLmVuZEF0ID8gRGF0
ZS5wYXJzZShzY2VuZS5lbmRBdCkgOiBOYU47CiAgaWYgKE51bWJlci5pc0Zpbml0ZShzdGFydCkgJiYgbm93IDwgc3RhcnQpIHJldHVybiBmYWxzZTsKICBp
ZiAoTnVtYmVyLmlzRmluaXRlKGVuZCkgJiYgbm93ID4gZW5kKSByZXR1cm4gZmFsc2U7CiAgcmV0dXJuIHRydWU7Cn0K
'@
    },
    [pscustomobject]@{
        Path = "components\showcase\ShowcaseStage.tsx"
        GitPath = "components/showcase/ShowcaseStage.tsx"
        OriginalSha256 = "072895F9CC785DDF657C91E1507FCAD5744460B9AFDCE2A332CE5EBA2AD24D9F"
        PatchedSha256 = "D943D0F3989E012CAABD4BC6FBA255F47C7C137A2858F847D415B790B4C4E719"
        Base64 = @'
InVzZSBjbGllbnQiOwoKaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VNZW1vLCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSAicmVhY3QiOwppbXBvcnQgUVJDb2Rl
IGZyb20gInJlYWN0LXFyLWNvZGUiOwppbXBvcnQgewogIGJ1aWxkU2hvd2Nhc2VNZW51UGFnZXMsCiAgc2VsZWN0ZWRQcm9kdWN0c0ZvclNjZW5lLAp9IGZy
b20gIkAvbGliL3Nob3djYXNlL3J1bnRpbWUiOwppbXBvcnQgdHlwZSB7CiAgU2hvd2Nhc2VDYW1wYWlnbiwKICBTaG93Y2FzZVByb2R1Y3QsCiAgU2hvd2Nh
c2VQcmV2aWV3QXNwZWN0LAogIFNob3djYXNlU2NlbmUsCiAgU2hvd2Nhc2VTbmFwc2hvdCwKfSBmcm9tICJAL2xpYi9zaG93Y2FzZS90eXBlcyI7CmltcG9y
dCBzdHlsZXMgZnJvbSAiLi9TaG93Y2FzZVN0YWdlLm1vZHVsZS5jc3MiOwoKdHlwZSBQcm9wcyA9IHsKICBzbmFwc2hvdDogU2hvd2Nhc2VTbmFwc2hvdDsK
ICBzY2VuZTogU2hvd2Nhc2VTY2VuZTsKICBzY2VuZUluZGV4OiBudW1iZXI7CiAgc2NlbmVDb3VudDogbnVtYmVyOwogIHByZXZpZXc/OiBib29sZWFuOwog
IHByZXZpZXdBc3BlY3Q/OiBTaG93Y2FzZVByZXZpZXdBc3BlY3Q7CiAgb25saW5lPzogYm9vbGVhbjsKICBvblZpZGVvRW5kZWQ/OiAoKSA9PiB2b2lkOwog
IG9uVmlkZW9FcnJvcj86ICgpID0+IHZvaWQ7Cn07CgpmdW5jdGlvbiBtb25leSh2YWx1ZTogbnVtYmVyKSB7CiAgcmV0dXJuIG5ldyBJbnRsLk51bWJlckZv
cm1hdCgiZGUtREUiLCB7CiAgICBzdHlsZTogImN1cnJlbmN5IiwKICAgIGN1cnJlbmN5OiAiRVVSIiwKICB9KS5mb3JtYXQoTnVtYmVyKHZhbHVlIHx8IDAp
KTsKfQoKZnVuY3Rpb24gdmlzaWJsZVRleHQodmFsdWU/OiBzdHJpbmcgfCBudWxsKSB7CiAgcmV0dXJuIFN0cmluZyh2YWx1ZSA/PyAiIikudHJpbSgpOwp9
CgpmdW5jdGlvbiBwcm9kdWN0Rm9yKHNjZW5lOiBTaG93Y2FzZVNjZW5lLCBwcm9kdWN0czogU2hvd2Nhc2VQcm9kdWN0W10pIHsKICBjb25zdCBzZWxlY3Rl
ZCA9IHNlbGVjdGVkUHJvZHVjdHNGb3JTY2VuZShzY2VuZSwgcHJvZHVjdHMpOwogIHJldHVybiBzZWxlY3RlZFswXSB8fCBudWxsOwp9CgpmdW5jdGlvbiBj
YW1wYWlnbkZvcihzY2VuZTogU2hvd2Nhc2VTY2VuZSwgY2FtcGFpZ25zOiBTaG93Y2FzZUNhbXBhaWduW10pIHsKICBpZiAoIXNjZW5lLmNhbXBhaWduSWQp
IHJldHVybiBudWxsOwogIHJldHVybiBjYW1wYWlnbnMuZmluZCgoaXRlbSkgPT4gaXRlbS5pZCA9PT0gc2NlbmUuY2FtcGFpZ25JZCkgfHwgbnVsbDsKfQoK
ZnVuY3Rpb24gY2FtcGFpZ25IZWFkbGluZShjYW1wYWlnbjogU2hvd2Nhc2VDYW1wYWlnbiB8IG51bGwpIHsKICBpZiAoIWNhbXBhaWduKSByZXR1cm4gIiI7
CiAgY29uc3QgcGF5bG9hZCA9IGNhbXBhaWduLnBheWxvYWQgfHwge307CiAgY29uc3QgdmFsdWUgPSBOdW1iZXIocGF5bG9hZD8udmFsdWUgfHwgMCk7CiAg
Y29uc3Qga2luZCA9IFN0cmluZyhwYXlsb2FkPy5raW5kIHx8ICIiKTsKICBpZiAoa2luZCA9PT0gInBlcmNlbnQiICYmIHZhbHVlID4gMCkgcmV0dXJuIGAk
e3ZhbHVlfSUgUkFCQVRUYDsKICBpZiAoa2luZCA9PT0gImFic29sdXRlIiAmJiB2YWx1ZSA+IDApIHJldHVybiBgJHttb25leSh2YWx1ZSl9IFJBQkFUVGA7
CiAgaWYgKGtpbmQgPT09ICJuZXdQcmljZSIgJiYgdmFsdWUgPiAwKSByZXR1cm4gYE5VUiAke21vbmV5KHZhbHVlKX1gOwogIHJldHVybiB2aXNpYmxlVGV4
dChjYW1wYWlnbi5iYWRnZVRleHQgfHwgY2FtcGFpZ24udGl0bGUpOwp9CgpmdW5jdGlvbiBjYW1wYWlnblRleHQoY2FtcGFpZ246IFNob3djYXNlQ2FtcGFp
Z24gfCBudWxsKSB7CiAgY29uc3QgcGF5bG9hZCA9IGNhbXBhaWduPy5wYXlsb2FkIHx8IHt9OwogIHJldHVybiB2aXNpYmxlVGV4dCgKICAgIHBheWxvYWQ/
LmN1c3RvbWVyTm90aWNlIHx8CiAgICAgIHBheWxvYWQ/LmRlc2NyaXB0aW9uIHx8CiAgICAgIHBheWxvYWQ/LnRleHQgfHwKICAgICAgcGF5bG9hZD8uc3Vi
dGl0bGUgfHwKICAgICAgY2FtcGFpZ24/LnRpdGxlLAogICk7Cn0KCmZ1bmN0aW9uIGNhbXBhaWduTW9kZUxhYmVsKHByb2R1Y3Q6IFNob3djYXNlUHJvZHVj
dCkgewogIGlmIChwcm9kdWN0LmNhbXBhaWduTW9kZSA9PT0gImRlbGl2ZXJ5IikgcmV0dXJuICJOVVIgTElFRkVSVU5HIjsKICBpZiAocHJvZHVjdC5jYW1w
YWlnbk1vZGUgPT09ICJwaWNrdXAiKSByZXR1cm4gIk5VUiBBQkhPTFVORyI7CiAgcmV0dXJuICIiOwp9CgpmdW5jdGlvbiBQcm9kdWN0UHJpY2UoeyBwcm9k
dWN0LCBsYXJnZSA9IGZhbHNlIH06IHsgcHJvZHVjdDogU2hvd2Nhc2VQcm9kdWN0OyBsYXJnZT86IGJvb2xlYW4gfSkgewogIGNvbnN0IGRpc2NvdW50ZWQg
PQogICAgdHlwZW9mIHByb2R1Y3Qub3JpZ2luYWxQcmljZSA9PT0gIm51bWJlciIgJiYKICAgIHByb2R1Y3Qub3JpZ2luYWxQcmljZSA+IHByb2R1Y3QuZGlz
cGxheVByaWNlOwoKICByZXR1cm4gKAogICAgPGRpdiBjbGFzc05hbWU9e2xhcmdlID8gc3R5bGVzLnByb2R1Y3RQcmljZUxhcmdlIDogc3R5bGVzLm1lbnVQ
cmljZX0+CiAgICAgIHtkaXNjb3VudGVkID8gKAogICAgICAgIDxzcGFuIGNsYXNzTmFtZT17c3R5bGVzLm9yaWdpbmFsUHJpY2V9Pnttb25leShwcm9kdWN0
Lm9yaWdpbmFsUHJpY2UgfHwgcHJvZHVjdC5wcmljZSl9PC9zcGFuPgogICAgICApIDogbnVsbH0KICAgICAgPHN0cm9uZz57bW9uZXkocHJvZHVjdC5kaXNw
bGF5UHJpY2UgPz8gcHJvZHVjdC5wcmljZSl9PC9zdHJvbmc+CiAgICA8L2Rpdj4KICApOwp9CgpmdW5jdGlvbiBpbmdyZWRpZW50TGluZXModmFsdWU/OiBz
dHJpbmcpIHsKICBjb25zdCB0ZXh0ID0gU3RyaW5nKHZhbHVlIHx8ICIiKS50cmltKCk7CiAgaWYgKCF0ZXh0KSByZXR1cm4gW107CiAgY29uc3Qgc3BsaXQg
PSB0ZXh0CiAgICAuc3BsaXQoL1xyP1xufOKAonzCt3xcc1st4oCT4oCUXVxzL2cpCiAgICAuZmxhdE1hcCgocGFydCkgPT4gKHBhcnQuaW5jbHVkZXMoIiwi
KSA/IHBhcnQuc3BsaXQoIiwiKSA6IFtwYXJ0XSkpCiAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKS5yZXBsYWNlKC9eWy3igJPigJTigKJdK1xzKi8s
ICIiKSkKICAgIC5maWx0ZXIoQm9vbGVhbik7CiAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldChzcGxpdCkpLnNsaWNlKDAsIDEwKTsKfQoKZnVuY3Rpb24g
Q2xvY2soKSB7CiAgY29uc3QgW25vdywgc2V0Tm93XSA9IHVzZVN0YXRlKCgpID0+IG5ldyBEYXRlKCkpOwoKICB1c2VFZmZlY3QoKCkgPT4gewogICAgY29u
c3QgdGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwoKCkgPT4gc2V0Tm93KG5ldyBEYXRlKCkpLCAxXzAwMCk7CiAgICByZXR1cm4gKCkgPT4gd2luZG93LmNs
ZWFySW50ZXJ2YWwodGltZXIpOwogIH0sIFtdKTsKCiAgcmV0dXJuICgKICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuY2xvY2t9IHN1cHByZXNzSHlkcmF0
aW9uV2FybmluZz4KICAgICAgPHN0cm9uZz4KICAgICAgICB7bm93LnRvTG9jYWxlVGltZVN0cmluZygiZGUtREUiLCB7IGhvdXI6ICIyLWRpZ2l0IiwgbWlu
dXRlOiAiMi1kaWdpdCIgfSl9CiAgICAgIDwvc3Ryb25nPgogICAgICA8c3Bhbj4KICAgICAgICB7bm93LnRvTG9jYWxlRGF0ZVN0cmluZygiZGUtREUiLCB7
CiAgICAgICAgICB3ZWVrZGF5OiAic2hvcnQiLAogICAgICAgICAgZGF5OiAiMi1kaWdpdCIsCiAgICAgICAgICBtb250aDogIjItZGlnaXQiLAogICAgICAg
IH0pfQogICAgICA8L3NwYW4+CiAgICA8L2Rpdj4KICApOwp9CgpmdW5jdGlvbiBTaGFycFFyKHsgdmFsdWUsIGxhYmVsIH06IHsgdmFsdWU6IHN0cmluZzsg
bGFiZWw/OiBzdHJpbmcgfSkgewogIGNvbnN0IHZpc2libGVMYWJlbCA9IHZpc2libGVUZXh0KGxhYmVsKTsKCiAgcmV0dXJuICgKICAgIDxkaXYgY2xhc3NO
YW1lPXtzdHlsZXMucXJDYXJkfT4KICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5xckNvZGV9PgogICAgICAgIDxRUkNvZGUKICAgICAgICAgIHZhbHVl
PXt2YWx1ZSB8fCAiaHR0cHM6Ly93d3cuYnVyZ2VyLWJyb3RoZXJzLmJlcmxpbiJ9CiAgICAgICAgICBzaXplPXsyNTZ9CiAgICAgICAgICBsZXZlbD0iSCIK
ICAgICAgICAgIGJnQ29sb3I9IiNmZmZmZmYiCiAgICAgICAgICBmZ0NvbG9yPSIjMDgwODA4IgogICAgICAgICAgc3R5bGU9e3sgd2lkdGg6ICIxMDAlIiwg
aGVpZ2h0OiAiMTAwJSIgfX0KICAgICAgICAvPgogICAgICA8L2Rpdj4KICAgICAge3Zpc2libGVMYWJlbCA/IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMucXJM
YWJlbH0+e3Zpc2libGVMYWJlbH08L2Rpdj4gOiBudWxsfQogICAgPC9kaXY+CiAgKTsKfQoKZnVuY3Rpb24gTG9nbyh7IHVybCwgbmFtZSB9OiB7IHVybDog
c3RyaW5nOyBuYW1lOiBzdHJpbmcgfSkgewogIHJldHVybiAoCiAgICA8aW1nCiAgICAgIHNyYz17dXJsIHx8ICIvbG9nby1idXJnZXItYnJvdGhlcnMucG5n
In0KICAgICAgYWx0PXtuYW1lfQogICAgICBjbGFzc05hbWU9e3N0eWxlcy5sb2dvfQogICAgICBvbkVycm9yPXsoZXZlbnQpID0+IHsKICAgICAgICBldmVu
dC5jdXJyZW50VGFyZ2V0LnNyYyA9ICIvbG9nby1idXJnZXItYnJvdGhlcnMucG5nIjsKICAgICAgfX0KICAgIC8+CiAgKTsKfQoKZnVuY3Rpb24gdGhlbWVQ
YXJ0aWNsZVN0eWxlKGluZGV4OiBudW1iZXIpOiBSZWFjdC5DU1NQcm9wZXJ0aWVzIHsKICBjb25zdCBsZWZ0ID0gKGluZGV4ICogMTcgKyA3KSAlIDk2Owog
IGNvbnN0IGRlbGF5ID0gLSgoaW5kZXggKiAxLjM3KSAlIDEyKTsKICBjb25zdCBkdXJhdGlvbiA9IDkgKyAoaW5kZXggJSA2KSAqIDEuNzsKICBjb25zdCBz
aXplID0gMTQgKyAoaW5kZXggJSA0KSAqIDQ7CgogIHJldHVybiB7CiAgICBsZWZ0OiBgJHtsZWZ0fSVgLAogICAgYW5pbWF0aW9uRGVsYXk6IGAke2RlbGF5
fXNgLAogICAgYW5pbWF0aW9uRHVyYXRpb246IGAke2R1cmF0aW9ufXNgLAogICAgZm9udFNpemU6IGAke3NpemV9cHhgLAogIH07Cn0KCmZ1bmN0aW9uIFRo
ZW1lRGVjb3JhdGlvbnMoeyBzbmFwc2hvdCB9OiB7IHNuYXBzaG90OiBTaG93Y2FzZVNuYXBzaG90IH0pIHsKICBjb25zdCBicmFuZGluZyA9IHNuYXBzaG90
LmJyYW5kaW5nOwogIGlmICghYnJhbmRpbmcudGhlbWVEZWNvcmF0aW9uc0VuYWJsZWQpIHJldHVybiBudWxsOwoKICBjb25zdCBwYXJ0aWNsZXMgPSBBcnJh
eS5pc0FycmF5KGJyYW5kaW5nLnRoZW1lUGFydGljbGVzKQogICAgPyBicmFuZGluZy50aGVtZVBhcnRpY2xlcy5maWx0ZXIoQm9vbGVhbikKICAgIDogW107
CgogIHJldHVybiAoCiAgICA8ZGl2CiAgICAgIGNsYXNzTmFtZT17WwogICAgICAgIHN0eWxlcy50aGVtZURlY29yYXRpb25zLAogICAgICAgIGJyYW5kaW5n
LnRoZW1lTW90aW9uRW5hYmxlZCA/IHN0eWxlcy50aGVtZU1vdGlvbiA6IHN0eWxlcy50aGVtZVN0aWxsLAogICAgICAgIGJyYW5kaW5nLnRoZW1lU25vdyA/
IHN0eWxlcy50aGVtZVNub3cgOiAiIiwKICAgICAgXS5qb2luKCIgIil9CiAgICAgIGFyaWEtaGlkZGVuPSJ0cnVlIgogICAgPgogICAgICA8ZGl2IGNsYXNz
TmFtZT17c3R5bGVzLnRoZW1lR2FybGFuZH0gLz4KICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy50aGVtZUF0bW9zcGhlcmV9IC8+CiAgICAgIDxzcGFu
IGNsYXNzTmFtZT17YCR7c3R5bGVzLnRoZW1lQ29ybmVyfSAke3N0eWxlcy50aGVtZUNvcm5lckxlZnR9YH0+CiAgICAgICAge2JyYW5kaW5nLnRoZW1lQ29y
bmVyTGVmdH0KICAgICAgPC9zcGFuPgogICAgICA8c3BhbiBjbGFzc05hbWU9e2Ake3N0eWxlcy50aGVtZUNvcm5lcn0gJHtzdHlsZXMudGhlbWVDb3JuZXJS
aWdodH1gfT4KICAgICAgICB7YnJhbmRpbmcudGhlbWVDb3JuZXJSaWdodH0KICAgICAgPC9zcGFuPgogICAgICB7cGFydGljbGVzLmxlbmd0aCA/ICgKICAg
ICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnRoZW1lUGFydGljbGVzfT4KICAgICAgICAgIHtBcnJheS5mcm9tKHsgbGVuZ3RoOiAxOCB9LCAoXywgaW5k
ZXgpID0+ICgKICAgICAgICAgICAgPHNwYW4KICAgICAgICAgICAgICBrZXk9e2Ake2JyYW5kaW5nLnRoZW1lSWR9LSR7aW5kZXh9YH0KICAgICAgICAgICAg
ICBjbGFzc05hbWU9e3N0eWxlcy50aGVtZVBhcnRpY2xlfQogICAgICAgICAgICAgIHN0eWxlPXt0aGVtZVBhcnRpY2xlU3R5bGUoaW5kZXgpfQogICAgICAg
ICAgICA+CiAgICAgICAgICAgICAge3BhcnRpY2xlc1tpbmRleCAlIHBhcnRpY2xlcy5sZW5ndGhdfQogICAgICAgICAgICA8L3NwYW4+CiAgICAgICAgICAp
KX0KICAgICAgICA8L2Rpdj4KICAgICAgKSA6IG51bGx9CiAgICA8L2Rpdj4KICApOwp9CgpmdW5jdGlvbiBCYWNrZ3JvdW5kKHsgc2NlbmUsIHNuYXBzaG90
IH06IHsgc2NlbmU6IFNob3djYXNlU2NlbmU7IHNuYXBzaG90OiBTaG93Y2FzZVNuYXBzaG90IH0pIHsKICBjb25zdCB2aWRlb1VybCA9CiAgICBzY2VuZS50
eXBlID09PSAiaGVybyIgJiYgIXNjZW5lLm1lZGlhVXJsCiAgICAgID8gc25hcHNob3QuYnJhbmRpbmcudGhlbWVWaWRlb1VybAogICAgICA6IHNjZW5lLnR5
cGUgPT09ICJoZXJvIgogICAgICAgID8gc2NlbmUubWVkaWFVcmwKICAgICAgICA6ICIiOwogIGNvbnN0IGlzVmlkZW8gPSAvXC4obXA0fHdlYm0pKD86XD98
JCkvaS50ZXN0KHZpZGVvVXJsIHx8ICIiKTsKICBjb25zdCBpc0ltYWdlID0gQm9vbGVhbih2aWRlb1VybCkgJiYgIWlzVmlkZW87CgogIGNvbnN0IG1lZGlh
Q2xhc3MgPSBbCiAgICBzY2VuZS5maXQgPT09ICJjb250YWluIiA/IHN0eWxlcy5tZWRpYUNvbnRhaW4gOiBzdHlsZXMubWVkaWFDb3ZlciwKICAgIHNjZW5l
LnR5cGUgPT09ICJoZXJvIiA/IHN0eWxlcy5sYW5kaW5nTWVkaWEgOiAiIiwKICBdLmpvaW4oIiAiKTsKCiAgcmV0dXJuICgKICAgIDw+CiAgICAgIDxkaXYg
Y2xhc3NOYW1lPXtzdHlsZXMuZ3JhZGllbnRCYXNlfSAvPgogICAgICB7aXNJbWFnZSA/IDxpbWcgc3JjPXt2aWRlb1VybH0gYWx0PSIiIGNsYXNzTmFtZT17
bWVkaWFDbGFzc30gLz4gOiBudWxsfQogICAgICB7aXNWaWRlbyA/ICgKICAgICAgICA8dmlkZW8KICAgICAgICAgIGtleT17dmlkZW9Vcmx9CiAgICAgICAg
ICBzcmM9e3ZpZGVvVXJsfQogICAgICAgICAgbXV0ZWQKICAgICAgICAgIGF1dG9QbGF5CiAgICAgICAgICBsb29wCiAgICAgICAgICBwbGF5c0lubGluZQog
ICAgICAgICAgcHJlbG9hZD0iYXV0byIKICAgICAgICAgIGNsYXNzTmFtZT17bWVkaWFDbGFzc30KICAgICAgICAvPgogICAgICApIDogbnVsbH0KICAgICAg
PGRpdiBjbGFzc05hbWU9e1tzdHlsZXMudmlnbmV0dGUsIHNjZW5lLnR5cGUgPT09ICJoZXJvIiA/IHN0eWxlcy5sYW5kaW5nVmlnbmV0dGUgOiAiIl0uam9p
bigiICIpfSAvPgogICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLm5vaXNlfSAvPgogICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmdsb3dPbmV9IC8+
CiAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuZ2xvd1R3b30gLz4KICAgIDwvPgogICk7Cn0KCmZ1bmN0aW9uIEhlcm9TY2VuZSh7IHNjZW5lLCBzbmFw
c2hvdCB9OiB7IHNjZW5lOiBTaG93Y2FzZVNjZW5lOyBzbmFwc2hvdDogU2hvd2Nhc2VTbmFwc2hvdCB9KSB7CiAgY29uc3QgcXJVcmwgPSBzY2VuZS5xclVy
bCB8fCBzbmFwc2hvdC5kb2N1bWVudC5zZXR0aW5ncy5xclVybCB8fCBzbmFwc2hvdC5icmFuZGluZy5zaXRlVXJsOwogIGNvbnN0IHNpdGVBZGRyZXNzID0g
c25hcHNob3QuYnJhbmRpbmcuc2l0ZVVybC5yZXBsYWNlKC9eaHR0cHM/OlwvXC8vLCAiIik7CiAgY29uc3QgdGl0bGUgPSB2aXNpYmxlVGV4dChzY2VuZS50
aXRsZSk7CiAgY29uc3Qgc3VidGl0bGUgPSB2aXNpYmxlVGV4dChzY2VuZS5zdWJ0aXRsZSk7CiAgY29uc3QgYm9keSA9IHZpc2libGVUZXh0KHNjZW5lLmJv
ZHkpOwogIGNvbnN0IHFyTGFiZWwgPSB2aXNpYmxlVGV4dChzY2VuZS5xckxhYmVsKTsKCiAgcmV0dXJuICgKICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMu
bGFuZGluZ0hlcm99PgogICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmxhbmRpbmdCcmFuZEJsb2NrfT4KICAgICAgICB7c2NlbmUuYmFkZ2UgPyA8ZGl2
IGNsYXNzTmFtZT17c3R5bGVzLmJhZGdlfT57c2NlbmUuYmFkZ2V9PC9kaXY+IDogbnVsbH0KICAgICAgICB7c2NlbmUuc2hvd0xvZ28gIT09IGZhbHNlID8g
KAogICAgICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5sYW5kaW5nTG9nb1dyYXB9PgogICAgICAgICAgICA8TG9nbyB1cmw9e3NuYXBzaG90LmJyYW5k
aW5nLmxvZ29Vcmx9IG5hbWU9e3NuYXBzaG90LmJyYW5kaW5nLnNob3BOYW1lfSAvPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgKSA6IG51bGx9CiAgICAg
ICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5sYW5kaW5nTG9jYXRpb259PgogICAgICAgICAgPHNwYW4gYXJpYS1oaWRkZW49InRydWUiPvCfk408L3NwYW4+
CiAgICAgICAgICB7c25hcHNob3QuYnJhbmRpbmcubG9jYXRpb25MYWJlbCB8fCAiMTM1MDcgQmVybGluIFRlZ2VsIn0KICAgICAgICA8L2Rpdj4KICAgICAg
PC9kaXY+CgogICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmxhbmRpbmdPcmRlckJsb2NrfT4KICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmxh
bmRpbmdPcmRlckNvcHl9PgogICAgICAgICAge3RpdGxlID8gPGgxPnt0aXRsZX08L2gxPiA6IG51bGx9CiAgICAgICAgICB7c3VidGl0bGUgPyA8cD57c3Vi
dGl0bGV9PC9wPiA6IG51bGx9CiAgICAgICAgICB7Ym9keSA/IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuYm9keVRleHR9Pntib2R5fTwvZGl2PiA6IG51bGx9
CiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnNpdGVBZGRyZXNzfT57c2l0ZUFkZHJlc3N9PC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgICAg
e3NjZW5lLnNob3dRciAhPT0gZmFsc2UgPyAoCiAgICAgICAgICA8U2hhcnBRciB2YWx1ZT17cXJVcmx9IGxhYmVsPXtxckxhYmVsfSAvPgogICAgICAgICkg
OiBudWxsfQogICAgICA8L2Rpdj4KICAgIDwvZGl2PgogICk7Cn0KCmZ1bmN0aW9uIFZpZGVvU2NlbmUoewogIHNjZW5lLAogIHNuYXBzaG90LAogIHByb2R1
Y3QsCiAgb25FbmRlZCwKICBvbkVycm9yLAp9OiB7CiAgc2NlbmU6IFNob3djYXNlU2NlbmU7CiAgc25hcHNob3Q6IFNob3djYXNlU25hcHNob3Q7CiAgcHJv
ZHVjdDogU2hvd2Nhc2VQcm9kdWN0IHwgbnVsbDsKICBvbkVuZGVkPzogKCkgPT4gdm9pZDsKICBvbkVycm9yPzogKCkgPT4gdm9pZDsKfSkgewogIGNvbnN0
IHRpdGxlID0gdmlzaWJsZVRleHQoc2NlbmUudGl0bGUpOwogIGNvbnN0IHN1YnRpdGxlID0gdmlzaWJsZVRleHQoc2NlbmUuc3VidGl0bGUpOwogIGNvbnN0
IGJvZHkgPSB2aXNpYmxlVGV4dChzY2VuZS5ib2R5KTsKICBjb25zdCBxckxhYmVsID0gdmlzaWJsZVRleHQoc2NlbmUucXJMYWJlbCk7CgogIHJldHVybiAo
CiAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnZpZGVvU2NlbmV9PgogICAgICB7c2NlbmUubWVkaWFVcmwgPyAoCiAgICAgICAgPHZpZGVvCiAgICAgICAg
ICBrZXk9e2Ake3NjZW5lLmlkfToke3NjZW5lLm1lZGlhVXJsfWB9CiAgICAgICAgICBzcmM9e3NjZW5lLm1lZGlhVXJsfQogICAgICAgICAgcG9zdGVyPXtz
Y2VuZS5wb3N0ZXJVcmx9CiAgICAgICAgICBtdXRlZAogICAgICAgICAgYXV0b1BsYXkKICAgICAgICAgIHBsYXlzSW5saW5lCiAgICAgICAgICBwcmVsb2Fk
PSJhdXRvIgogICAgICAgICAgY2xhc3NOYW1lPXtzY2VuZS5maXQgPT09ICJjb250YWluIiA/IHN0eWxlcy52aWRlb0NvbnRhaW4gOiBzdHlsZXMudmlkZW9D
b3Zlcn0KICAgICAgICAgIG9uRW5kZWQ9e29uRW5kZWR9CiAgICAgICAgICBvbkVycm9yPXtvbkVycm9yfQogICAgICAgIC8+CiAgICAgICkgOiAoCiAgICAg
ICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5taXNzaW5nTWVkaWF9PlZJREVPIEhJTlpVRsOcR0VOPC9kaXY+CiAgICAgICl9CiAgICAgIDxkaXYgY2xhc3NO
YW1lPXtzdHlsZXMudmlkZW9TaGFkZX0gLz4KICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy52aWRlb1RvcH0+CiAgICAgICAgPGRpdj4KICAgICAgICAg
IHtzY2VuZS5iYWRnZSA/IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuYmFkZ2V9PntzY2VuZS5iYWRnZX08L2Rpdj4gOiBudWxsfQogICAgICAgICAge3RpdGxl
ID8gPGgyPnt0aXRsZX08L2gyPiA6IG51bGx9CiAgICAgICAgICB7c3VidGl0bGUgPyA8cD57c3VidGl0bGV9PC9wPiA6IG51bGx9CiAgICAgICAgPC9kaXY+
CiAgICAgICAge3NjZW5lLnNob3dMb2dvICE9PSBmYWxzZSA/ICgKICAgICAgICAgIDxMb2dvIHVybD17c25hcHNob3QuYnJhbmRpbmcubG9nb1VybH0gbmFt
ZT17c25hcHNob3QuYnJhbmRpbmcuc2hvcE5hbWV9IC8+CiAgICAgICAgKSA6IG51bGx9CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5
bGVzLnZpZGVvQm90dG9tfT4KICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnZpZGVvQm90dG9tVGV4dH0+CiAgICAgICAgICB7Ym9keSA/IDxzcGFu
Pntib2R5fTwvc3Bhbj4gOiBudWxsfQogICAgICAgICAgPHN0cm9uZz57c25hcHNob3QuYnJhbmRpbmcuc2l0ZVVybC5yZXBsYWNlKC9eaHR0cHM/OlwvXC8v
LCAiIil9PC9zdHJvbmc+CiAgICAgICAgPC9kaXY+CiAgICAgICAge3NjZW5lLnNob3dQcmljZSAhPT0gZmFsc2UgJiYgcHJvZHVjdCA/ICgKICAgICAgICAg
IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMucHJpY2VQaWxsfT57bW9uZXkocHJvZHVjdC5kaXNwbGF5UHJpY2UgPz8gcHJvZHVjdC5wcmljZSl9PC9kaXY+CiAg
ICAgICAgKSA6IG51bGx9CiAgICAgICAge3NjZW5lLnNob3dRciA/ICgKICAgICAgICAgIDxTaGFycFFyCiAgICAgICAgICAgIHZhbHVlPXtzY2VuZS5xclVy
bCB8fCBzbmFwc2hvdC5kb2N1bWVudC5zZXR0aW5ncy5xclVybH0KICAgICAgICAgICAgbGFiZWw9e3FyTGFiZWx9CiAgICAgICAgICAvPgogICAgICAgICkg
OiBudWxsfQogICAgICA8L2Rpdj4KICAgIDwvZGl2PgogICk7Cn0KCmZ1bmN0aW9uIFByb2R1Y3RGbG93U2NlbmUoewogIHNjZW5lLAogIHNuYXBzaG90LAp9
OiB7CiAgc2NlbmU6IFNob3djYXNlU2NlbmU7CiAgc25hcHNob3Q6IFNob3djYXNlU25hcHNob3Q7Cn0pIHsKICBjb25zdCBwcm9kdWN0cyA9IHVzZU1lbW8o
CiAgICAoKSA9PiBzZWxlY3RlZFByb2R1Y3RzRm9yU2NlbmUoc2NlbmUsIHNuYXBzaG90LnByb2R1Y3RzKSwKICAgIFtzY2VuZSwgc25hcHNob3QucHJvZHVj
dHNdLAogICk7CiAgY29uc3Qgc2lnbmF0dXJlID0gcHJvZHVjdHMubWFwKChwcm9kdWN0KSA9PiBwcm9kdWN0LmlkKS5qb2luKCJ8Iik7CiAgY29uc3QgW3By
b2R1Y3RJbmRleCwgc2V0UHJvZHVjdEluZGV4XSA9IHVzZVN0YXRlKDApOwoKICB1c2VFZmZlY3QoKCkgPT4gewogICAgc2V0UHJvZHVjdEluZGV4KDApOwog
IH0sIFtzY2VuZS5pZCwgc2lnbmF0dXJlXSk7CgogIHVzZUVmZmVjdCgoKSA9PiB7CiAgICBpZiAocHJvZHVjdHMubGVuZ3RoIDw9IDEpIHJldHVybjsKICAg
IGNvbnN0IHRpbWVyID0gd2luZG93LnNldFRpbWVvdXQoCiAgICAgICgpID0+IHNldFByb2R1Y3RJbmRleCgoY3VycmVudCkgPT4gKGN1cnJlbnQgKyAxKSAl
IHByb2R1Y3RzLmxlbmd0aCksCiAgICAgIE1hdGgubWF4KDYsIE51bWJlcihzY2VuZS5wcm9kdWN0U2Vjb25kcyB8fCAxMikpICogMV8wMDAsCiAgICApOwog
ICAgcmV0dXJuICgpID0+IHdpbmRvdy5jbGVhclRpbWVvdXQodGltZXIpOwogIH0sIFtwcm9kdWN0SW5kZXgsIHByb2R1Y3RzLmxlbmd0aCwgc2NlbmUucHJv
ZHVjdFNlY29uZHMsIHNpZ25hdHVyZV0pOwoKICBjb25zdCBwcm9kdWN0ID0gcHJvZHVjdHNbcHJvZHVjdEluZGV4XSB8fCBudWxsOwogIGlmICghcHJvZHVj
dCkgewogICAgcmV0dXJuICgKICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5wcm9kdWN0RW1wdHl9PgogICAgICAgIDxzcGFuPvCfjZQ8L3NwYW4+CiAg
ICAgICAgPGgyPlBST0RVS1RFIEFVU1fDhEhMRU48L2gyPgogICAgICAgIDxwPkRpZXNlIFN6ZW5lIHdpcmQgaW0gQWRtaW5iZXJlaWNoIG1pdCBQcm9kdWt0
ZW4gZ2Vmw7xsbHQuPC9wPgogICAgICA8L2Rpdj4KICAgICk7CiAgfQoKICBjb25zdCBpbmdyZWRpZW50cyA9IGluZ3JlZGllbnRMaW5lcygKICAgIHByb2R1
Y3QuaW5ncmVkaWVudHNUZXh0IHx8IHByb2R1Y3QuZGVzY3JpcHRpb24gfHwgc2NlbmUuYm9keSwKICApOwogIGNvbnN0IGltYWdlVXJsID0gcHJvZHVjdC5p
bWFnZVVybCB8fCBzY2VuZS5tZWRpYVVybDsKICBjb25zdCBtb2RlTGFiZWwgPSBjYW1wYWlnbk1vZGVMYWJlbChwcm9kdWN0KTsKICBjb25zdCBwcm9kdWN0
SW1hZ2VGaXQgPSBzY2VuZS5wcm9kdWN0SW1hZ2VGaXQgPT09ICJjb3ZlciIgPyAiY292ZXIiIDogImNvbnRhaW4iOwogIGNvbnN0IHByb2R1Y3RJbWFnZVNj
YWxlID0KICAgIE1hdGgubWF4KDM1LCBNYXRoLm1pbigxMzAsIE51bWJlcihzY2VuZS5wcm9kdWN0SW1hZ2VTY2FsZSB8fCA4MikpKSAvIDEwMDsKICBjb25z
dCBwcm9kdWN0SW1hZ2VYID0gTWF0aC5tYXgoLTQwLCBNYXRoLm1pbig0MCwgTnVtYmVyKHNjZW5lLnByb2R1Y3RJbWFnZVggfHwgMCkpKTsKICBjb25zdCBw
cm9kdWN0SW1hZ2VZID0gTWF0aC5tYXgoLTQwLCBNYXRoLm1pbig0MCwgTnVtYmVyKHNjZW5lLnByb2R1Y3RJbWFnZVkgfHwgMCkpKTsKCiAgcmV0dXJuICgK
ICAgIDxkaXYKICAgICAga2V5PXtgJHtwcm9kdWN0LmlkfToke3Byb2R1Y3RJbmRleH1gfQogICAgICBjbGFzc05hbWU9e3N0eWxlcy5wcm9kdWN0U3BvdGxp
Z2h0fQogICAgICBzdHlsZT17CiAgICAgICAgewogICAgICAgICAgIi0tcHJvZHVjdC1pbWFnZS1zY2FsZSI6IHByb2R1Y3RJbWFnZVNjYWxlLAogICAgICAg
ICAgIi0tcHJvZHVjdC1pbWFnZS14IjogYCR7cHJvZHVjdEltYWdlWH0lYCwKICAgICAgICAgICItLXByb2R1Y3QtaW1hZ2UteSI6IGAke3Byb2R1Y3RJbWFn
ZVl9JWAsCiAgICAgICAgfSBhcyBSZWFjdC5DU1NQcm9wZXJ0aWVzCiAgICAgIH0KICAgID4KICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5wcm9kdWN0
U3BvdGxpZ2h0VmlzdWFsfT4KICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnByb2R1Y3RIYWxvfSAvPgogICAgICAgIHtpbWFnZVVybCA/ICgKICAg
ICAgICAgIDxpbWcKICAgICAgICAgICAgc3JjPXtpbWFnZVVybH0KICAgICAgICAgICAgYWx0PXtwcm9kdWN0Lm5hbWV9CiAgICAgICAgICAgIGNsYXNzTmFt
ZT17CiAgICAgICAgICAgICAgcHJvZHVjdEltYWdlRml0ID09PSAiY292ZXIiCiAgICAgICAgICAgICAgICA/IHN0eWxlcy5wcm9kdWN0U3BvdGxpZ2h0SW1h
Z2VDb3ZlcgogICAgICAgICAgICAgICAgOiBzdHlsZXMucHJvZHVjdFNwb3RsaWdodEltYWdlCiAgICAgICAgICAgIH0KICAgICAgICAgIC8+CiAgICAgICAg
KSA6ICgKICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMucHJvZHVjdEltYWdlTWlzc2luZ30+8J+NlDwvZGl2PgogICAgICAgICl9CiAgICAgICAg
e3Byb2R1Y3QuY2FtcGFpZ25CYWRnZSA/ICgKICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMucHJvZHVjdENhbXBhaWduQmFkZ2V9Pntwcm9kdWN0
LmNhbXBhaWduQmFkZ2V9PC9kaXY+CiAgICAgICAgKSA6IG51bGx9CiAgICAgIDwvZGl2PgoKICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5wcm9kdWN0
U3BvdGxpZ2h0SW5mb30+CiAgICAgICAge3Zpc2libGVUZXh0KHNjZW5lLnRpdGxlKSA/ICgKICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT17c3R5bGVzLmV5
ZWJyb3d9Pnt2aXNpYmxlVGV4dChzY2VuZS50aXRsZSl9PC9zcGFuPgogICAgICAgICkgOiBudWxsfQogICAgICAgIDxoMj57cHJvZHVjdC5uYW1lfTwvaDI+
CgogICAgICAgIHtpbmdyZWRpZW50cy5sZW5ndGggPyAoCiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnByb2R1Y3RJbmdyZWRpZW50U3VtbWFy
eX0+CiAgICAgICAgICAgIHtpbmdyZWRpZW50cy5zbGljZSgwLCA2KS5tYXAoKGluZ3JlZGllbnQpID0+ICgKICAgICAgICAgICAgICA8c3BhbiBrZXk9e2lu
Z3JlZGllbnR9PntpbmdyZWRpZW50fTwvc3Bhbj4KICAgICAgICAgICAgKSl9CiAgICAgICAgICA8L2Rpdj4KICAgICAgICApIDogKAogICAgICAgICAgdmlz
aWJsZVRleHQoc2NlbmUuc3VidGl0bGUgPz8gcHJvZHVjdC5jYW1wYWlnblRpdGxlID8/IHByb2R1Y3QuZGVzY3JpcHRpb24pID8gKAogICAgICAgICAgICA8
cCBjbGFzc05hbWU9e3N0eWxlcy5wcm9kdWN0U3BvdGxpZ2h0U3VidGl0bGV9PgogICAgICAgICAgICAgIHt2aXNpYmxlVGV4dChzY2VuZS5zdWJ0aXRsZSA/
PyBwcm9kdWN0LmNhbXBhaWduVGl0bGUgPz8gcHJvZHVjdC5kZXNjcmlwdGlvbil9CiAgICAgICAgICAgIDwvcD4KICAgICAgICAgICkgOiBudWxsCiAgICAg
ICAgKX0KCiAgICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5wcm9kdWN0U3BvdGxpZ2h0TWV0YX0+CiAgICAgICAgICB7cHJvZHVjdC5hbGxlcmdlbnM/
Lmxlbmd0aCA/ICgKICAgICAgICAgICAgPHNwYW4+QWxsZXJnZW5lOiB7cHJvZHVjdC5hbGxlcmdlbnMuam9pbigiLCAiKX08L3NwYW4+CiAgICAgICAgICAp
IDogbnVsbH0KICAgICAgICAgIHttb2RlTGFiZWwgPyA8c3Ryb25nPnttb2RlTGFiZWx9PC9zdHJvbmc+IDogbnVsbH0KICAgICAgICA8L2Rpdj4KCiAgICAg
ICAge3NjZW5lLnNob3dQcmljZSAhPT0gZmFsc2UgPyA8UHJvZHVjdFByaWNlIHByb2R1Y3Q9e3Byb2R1Y3R9IGxhcmdlIC8+IDogbnVsbH0KICAgICAgPC9k
aXY+CgogICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnByb2R1Y3RGbG93Q291bnRlcn0+CiAgICAgICAge3Byb2R1Y3RJbmRleCArIDF9IC8ge3Byb2R1
Y3RzLmxlbmd0aH0KICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KICApOwp9CgpmdW5jdGlvbiBNZW51U2NlbmUoeyBzY2VuZSwgc25hcHNob3QgfTogeyBzY2Vu
ZTogU2hvd2Nhc2VTY2VuZTsgc25hcHNob3Q6IFNob3djYXNlU25hcHNob3QgfSkgewogIGNvbnN0IGJvYXJkUmVmID0gdXNlUmVmPEhUTUxEaXZFbGVtZW50
IHwgbnVsbD4obnVsbCk7CiAgY29uc3QgW2xheW91dCwgc2V0TGF5b3V0XSA9IHVzZVN0YXRlPCJsYW5kc2NhcGUiIHwgInBvcnRyYWl0Ij4oImxhbmRzY2Fw
ZSIpOwoKICB1c2VFZmZlY3QoKCkgPT4gewogICAgY29uc3QgZWxlbWVudCA9IGJvYXJkUmVmLmN1cnJlbnQ7CiAgICBpZiAoIWVsZW1lbnQgfHwgdHlwZW9m
IFJlc2l6ZU9ic2VydmVyID09PSAidW5kZWZpbmVkIikgcmV0dXJuOwogICAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKFtlbnRyeV0p
ID0+IHsKICAgICAgY29uc3QgeyB3aWR0aCwgaGVpZ2h0IH0gPSBlbnRyeS5jb250ZW50UmVjdDsKICAgICAgaWYgKCF3aWR0aCB8fCAhaGVpZ2h0KSByZXR1
cm47CiAgICAgIHNldExheW91dCh3aWR0aCAvIGhlaWdodCA8IDEuMTUgPyAicG9ydHJhaXQiIDogImxhbmRzY2FwZSIpOwogICAgfSk7CiAgICBvYnNlcnZl
ci5vYnNlcnZlKGVsZW1lbnQpOwogICAgcmV0dXJuICgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKTsKICB9LCBbXSk7CgogIGNvbnN0IHJlcXVlc3RlZEl0
ZW1zUGVyUGFnZSA9IE1hdGgubWF4KDQsIE51bWJlcihzY2VuZS5tZW51SXRlbXNQZXJQYWdlIHx8IDgpKTsKICBjb25zdCBhZGFwdGl2ZUl0ZW1zUGVyUGFn
ZSA9IGxheW91dCA9PT0gInBvcnRyYWl0IgogICAgPyBNYXRoLm1pbig2LCByZXF1ZXN0ZWRJdGVtc1BlclBhZ2UpCiAgICA6IHJlcXVlc3RlZEl0ZW1zUGVy
UGFnZTsKICBjb25zdCBwYWdlcyA9IHVzZU1lbW8oCiAgICAoKSA9PiBidWlsZFNob3djYXNlTWVudVBhZ2VzKHNjZW5lLCBzbmFwc2hvdC5wcm9kdWN0cywg
YWRhcHRpdmVJdGVtc1BlclBhZ2UpLAogICAgW3NjZW5lLCBzbmFwc2hvdC5wcm9kdWN0cywgYWRhcHRpdmVJdGVtc1BlclBhZ2VdLAogICk7CiAgY29uc3Qg
c2lnbmF0dXJlID0gcGFnZXMubWFwKChwYWdlKSA9PiBwYWdlLmlkKS5qb2luKCJ8Iik7CiAgY29uc3QgW3BhZ2VJbmRleCwgc2V0UGFnZUluZGV4XSA9IHVz
ZVN0YXRlKDApOwoKICB1c2VFZmZlY3QoKCkgPT4gc2V0UGFnZUluZGV4KDApLCBbc2NlbmUuaWQsIHNpZ25hdHVyZV0pOwoKICB1c2VFZmZlY3QoKCkgPT4g
ewogICAgaWYgKHBhZ2VzLmxlbmd0aCA8PSAxKSByZXR1cm47CiAgICBjb25zdCB0aW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KAogICAgICAoKSA9PiBzZXRQ
YWdlSW5kZXgoKGN1cnJlbnQpID0+IChjdXJyZW50ICsgMSkgJSBwYWdlcy5sZW5ndGgpLAogICAgICBNYXRoLm1heCg2LCBOdW1iZXIoc2NlbmUubWVudVBh
Z2VTZWNvbmRzIHx8IDEyKSkgKiAxXzAwMCwKICAgICk7CiAgICByZXR1cm4gKCkgPT4gd2luZG93LmNsZWFyVGltZW91dCh0aW1lcik7CiAgfSwgW3BhZ2VJ
bmRleCwgcGFnZXMubGVuZ3RoLCBzY2VuZS5tZW51UGFnZVNlY29uZHMsIHNpZ25hdHVyZV0pOwoKICBjb25zdCBwYWdlID0gcGFnZXNbcGFnZUluZGV4XSB8
fCBudWxsOwogIGNvbnN0IHJhaWxHcm91cHMgPSBBcnJheS5mcm9tKAogICAgbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oCiAgICAgIHBhZ2VzLm1hcCgoaXRl
bSkgPT4gW2l0ZW0uZ3JvdXBLZXksIGl0ZW0uZ3JvdXBMYWJlbF0gYXMgY29uc3QpLAogICAgKS5lbnRyaWVzKCksCiAgKTsKICBpZiAoIXBhZ2UpIHsKICAg
IHJldHVybiAoCiAgICAgIDxkaXYgcmVmPXtib2FyZFJlZn0gY2xhc3NOYW1lPXtzdHlsZXMucHJvZHVjdEVtcHR5fT4KICAgICAgICA8c3Bhbj7wn5OLPC9z
cGFuPgogICAgICAgIDxoMj5NRU7DnEdSVVBQRU4gQVVTV8OESExFTjwvaDI+CiAgICAgICAgPHA+QWt0aXZlIFByb2R1a3RncnVwcGVuIGvDtm5uZW4gaW0g
QWRtaW5iZXJlaWNoIGF1c2dld8OkaGx0IHdlcmRlbi48L3A+CiAgICAgIDwvZGl2PgogICAgKTsKICB9CgogIGNvbnN0IGNvbHVtbnNDbGFzcyA9IGxheW91
dCA9PT0gInBvcnRyYWl0IgogICAgPyBzdHlsZXMubWVudUNvbHVtbnNPbmUKICAgIDogTnVtYmVyKHNjZW5lLm1lbnVDb2x1bW5zKSA9PT0gMwogICAgICA/
IHN0eWxlcy5tZW51Q29sdW1uc1RocmVlCiAgICAgIDogc3R5bGVzLm1lbnVDb2x1bW5zVHdvOwoKICBjb25zdCBtZW51SW1hZ2VTaXplID0gTWF0aC5tYXgo
MzYsIE1hdGgubWluKDEwNCwgTnVtYmVyKHNjZW5lLm1lbnVJbWFnZVNpemUgfHwgNTgpKSk7CgogIHJldHVybiAoCiAgICA8ZGl2CiAgICAgIHJlZj17Ym9h
cmRSZWZ9CiAgICAgIGNsYXNzTmFtZT17YCR7c3R5bGVzLm1lbnVCb2FyZH0gJHtsYXlvdXQgPT09ICJwb3J0cmFpdCIgPyBzdHlsZXMubWVudUJvYXJkUG9y
dHJhaXQgOiBzdHlsZXMubWVudUJvYXJkTGFuZHNjYXBlfWB9CiAgICAgIHN0eWxlPXt7ICItLW1lbnUtdGh1bWItc2l6ZSI6IGAke21lbnVJbWFnZVNpemV9
cHhgIH0gYXMgUmVhY3QuQ1NTUHJvcGVydGllc30KICAgID4KICAgICAgPGhlYWRlciBjbGFzc05hbWU9e3N0eWxlcy5tZW51Qm9hcmRIZWFkZXJ9PgogICAg
ICAgIDxkaXY+CiAgICAgICAgICB7dmlzaWJsZVRleHQoc2NlbmUudGl0bGUpID8gKAogICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9e3N0eWxlcy5leWVi
cm93fT57dmlzaWJsZVRleHQoc2NlbmUudGl0bGUpfTwvc3Bhbj4KICAgICAgICAgICkgOiBudWxsfQogICAgICAgICAgPGgyPntwYWdlLmdyb3VwTGFiZWwg
fHwgcGFnZS5jYXRlZ29yeUxhYmVsfTwvaDI+CiAgICAgICAgICB7dmlzaWJsZVRleHQoc2NlbmUuc3VidGl0bGUpID8gPHA+e3Zpc2libGVUZXh0KHNjZW5l
LnN1YnRpdGxlKX08L3A+IDogbnVsbH0KICAgICAgICA8L2Rpdj4KICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLm1lbnVDYXRlZ29yeVJhaWx9Pgog
ICAgICAgICAge3JhaWxHcm91cHMubWFwKChbZ3JvdXBLZXksIGdyb3VwTGFiZWxdKSA9PiAoCiAgICAgICAgICAgIDxzcGFuIGtleT17Z3JvdXBLZXl9IGNs
YXNzTmFtZT17Z3JvdXBLZXkgPT09IHBhZ2UuZ3JvdXBLZXkgPyBzdHlsZXMubWVudUNhdGVnb3J5QWN0aXZlIDogIiJ9PgogICAgICAgICAgICAgIHtncm91
cExhYmVsfQogICAgICAgICAgICA8L3NwYW4+CiAgICAgICAgICApKX0KICAgICAgICA8L2Rpdj4KICAgICAgPC9oZWFkZXI+CgogICAgICA8ZGl2IGtleT17
cGFnZS5pZH0gY2xhc3NOYW1lPXtgJHtzdHlsZXMubWVudUl0ZW1zfSAke2NvbHVtbnNDbGFzc31gfT4KICAgICAgICB7cGFnZS5wcm9kdWN0cy5tYXAoKHBy
b2R1Y3QpID0+ICgKICAgICAgICAgIDxhcnRpY2xlIGNsYXNzTmFtZT17c3R5bGVzLm1lbnVJdGVtfSBrZXk9e3Byb2R1Y3QuaWR9PgogICAgICAgICAgICB7
c2NlbmUubWVudVNob3dJbWFnZXMgIT09IGZhbHNlICYmIHByb2R1Y3QuaW1hZ2VVcmwgPyAoCiAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxl
cy5tZW51SXRlbVRodW1ifT4KICAgICAgICAgICAgICAgIDxpbWcgc3JjPXtwcm9kdWN0LmltYWdlVXJsfSBhbHQ9IiIgLz4KICAgICAgICAgICAgICA8L2Rp
dj4KICAgICAgICAgICAgKSA6IG51bGx9CiAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMubWVudUl0ZW1NYWlufT4KICAgICAgICAgICAgICA8
ZGl2IGNsYXNzTmFtZT17c3R5bGVzLm1lbnVJdGVtVGl0bGVSb3d9PgogICAgICAgICAgICAgICAgPGgzPntwcm9kdWN0Lm5hbWV9PC9oMz4KICAgICAgICAg
ICAgICAgIHtwcm9kdWN0LmNhbXBhaWduQmFkZ2UgPyA8c3Bhbj57cHJvZHVjdC5jYW1wYWlnbkJhZGdlfTwvc3Bhbj4gOiBudWxsfQogICAgICAgICAgICAg
IDwvZGl2PgogICAgICAgICAgICAgIHtzY2VuZS5tZW51U2hvd0Rlc2NyaXB0aW9ucyAmJiBwcm9kdWN0LmRlc2NyaXB0aW9uID8gKAogICAgICAgICAgICAg
ICAgPHA+e3Byb2R1Y3QuZGVzY3JpcHRpb259PC9wPgogICAgICAgICAgICAgICkgOiBudWxsfQogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHls
ZXMubWVudUl0ZW1NZXRhfT4KICAgICAgICAgICAgICAgIHtjYW1wYWlnbk1vZGVMYWJlbChwcm9kdWN0KSA/ICgKICAgICAgICAgICAgICAgICAgPHNtYWxs
PntjYW1wYWlnbk1vZGVMYWJlbChwcm9kdWN0KX08L3NtYWxsPgogICAgICAgICAgICAgICAgKSA6IG51bGx9CiAgICAgICAgICAgICAgICB7cHJvZHVjdC5k
ZXBvc2l0QW1vdW50ID8gKAogICAgICAgICAgICAgICAgICA8c21hbGw+enpnbC4ge21vbmV5KHByb2R1Y3QuZGVwb3NpdEFtb3VudCl9IFBmYW5kPC9zbWFs
bD4KICAgICAgICAgICAgICAgICkgOiBudWxsfQogICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAge3NjZW5lLnNo
b3dQcmljZSAhPT0gZmFsc2UgPyA8UHJvZHVjdFByaWNlIHByb2R1Y3Q9e3Byb2R1Y3R9IC8+IDogbnVsbH0KICAgICAgICAgIDwvYXJ0aWNsZT4KICAgICAg
ICApKX0KICAgICAgPC9kaXY+CgogICAgICA8Zm9vdGVyIGNsYXNzTmFtZT17c3R5bGVzLm1lbnVCb2FyZEZvb3Rlcn0+CiAgICAgICAgPHNwYW4+e3BhZ2Uu
Y2F0ZWdvcnlMYWJlbH0gwrcge3BhZ2UuZ3JvdXBMYWJlbH08L3NwYW4+CiAgICAgICAgPHN0cm9uZz57cGFnZS5wYWdlSW5kZXggKyAxfSAvIHtwYWdlLnBh
Z2VDb3VudH08L3N0cm9uZz4KICAgICAgICB7c2NlbmUuc2hvd1FyID8gKAogICAgICAgICAgPFNoYXJwUXIKICAgICAgICAgICAgdmFsdWU9e3NjZW5lLnFy
VXJsIHx8IHNuYXBzaG90LmRvY3VtZW50LnNldHRpbmdzLnFyVXJsfQogICAgICAgICAgICBsYWJlbD17dmlzaWJsZVRleHQoc2NlbmUucXJMYWJlbCl9CiAg
ICAgICAgICAvPgogICAgICAgICkgOiBudWxsfQogICAgICA8L2Zvb3Rlcj4KICAgIDwvZGl2PgogICk7Cn0KCmZ1bmN0aW9uIENhbXBhaWduU2NlbmUoewog
IHNjZW5lLAogIHNuYXBzaG90LAogIGNhbXBhaWduLAp9OiB7CiAgc2NlbmU6IFNob3djYXNlU2NlbmU7CiAgc25hcHNob3Q6IFNob3djYXNlU25hcHNob3Q7
CiAgY2FtcGFpZ246IFNob3djYXNlQ2FtcGFpZ24gfCBudWxsOwp9KSB7CiAgY29uc3QgYmFkZ2UgPSB2aXNpYmxlVGV4dChzY2VuZS5iYWRnZSA/PyBjYW1w
YWlnbj8uYmFkZ2VUZXh0KTsKICBjb25zdCBzdWJ0aXRsZSA9IHZpc2libGVUZXh0KHNjZW5lLnN1YnRpdGxlID8/IGNhbXBhaWduPy50aXRsZSk7CiAgY29u
c3QgdGl0bGUgPSB2aXNpYmxlVGV4dChzY2VuZS50aXRsZSA/PyBjYW1wYWlnbkhlYWRsaW5lKGNhbXBhaWduKSk7CiAgY29uc3QgYm9keSA9IHZpc2libGVU
ZXh0KHNjZW5lLmJvZHkgPz8gY2FtcGFpZ25UZXh0KGNhbXBhaWduKSk7CiAgY29uc3QgcXJMYWJlbCA9IHZpc2libGVUZXh0KHNjZW5lLnFyTGFiZWwpOwoK
ICByZXR1cm4gKAogICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5jYW1wYWlnbkdyaWR9PgogICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmNhbXBhaWdu
Q29weX0+CiAgICAgICAge2JhZGdlID8gPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5iYWRnZX0+e2JhZGdlfTwvZGl2PiA6IG51bGx9CiAgICAgICAge3N1YnRp
dGxlID8gPHNwYW4gY2xhc3NOYW1lPXtzdHlsZXMuZXllYnJvd30+e3N1YnRpdGxlfTwvc3Bhbj4gOiBudWxsfQogICAgICAgIHt0aXRsZSA/IDxoMj57dGl0
bGV9PC9oMj4gOiBudWxsfQogICAgICAgIHtib2R5ID8gPHA+e2JvZHl9PC9wPiA6IG51bGx9CiAgICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5jYW1w
YWlnblNpdGV9PntzbmFwc2hvdC5icmFuZGluZy5zaXRlVXJsLnJlcGxhY2UoL15odHRwcz86XC9cLy8sICIiKX08L2Rpdj4KICAgICAgPC9kaXY+CiAgICAg
IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuY2FtcGFpZ25WaXN1YWx9PgogICAgICAgIHtzY2VuZS5tZWRpYVVybCA/ICgKICAgICAgICAgIDxpbWcgc3JjPXtz
Y2VuZS5tZWRpYVVybH0gYWx0PSIiIGNsYXNzTmFtZT17c3R5bGVzLmNhbXBhaWduSW1hZ2V9IC8+CiAgICAgICAgKSA6ICgKICAgICAgICAgIDxMb2dvIHVy
bD17c25hcHNob3QuYnJhbmRpbmcubG9nb1VybH0gbmFtZT17c25hcHNob3QuYnJhbmRpbmcuc2hvcE5hbWV9IC8+CiAgICAgICAgKX0KICAgICAgICB7c2Nl
bmUuc2hvd1FyICE9PSBmYWxzZSA/ICgKICAgICAgICAgIDxTaGFycFFyCiAgICAgICAgICAgIHZhbHVlPXtzY2VuZS5xclVybCB8fCBzbmFwc2hvdC5kb2N1
bWVudC5zZXR0aW5ncy5xclVybH0KICAgICAgICAgICAgbGFiZWw9e3FyTGFiZWx9CiAgICAgICAgICAvPgogICAgICAgICkgOiBudWxsfQogICAgICA8L2Rp
dj4KICAgIDwvZGl2PgogICk7Cn0KCmZ1bmN0aW9uIEltYWdlU2NlbmUoeyBzY2VuZSwgc25hcHNob3QgfTogeyBzY2VuZTogU2hvd2Nhc2VTY2VuZTsgc25h
cHNob3Q6IFNob3djYXNlU25hcHNob3QgfSkgewogIGNvbnN0IHRpdGxlID0gdmlzaWJsZVRleHQoc2NlbmUudGl0bGUpOwogIGNvbnN0IHN1YnRpdGxlID0g
dmlzaWJsZVRleHQoc2NlbmUuc3VidGl0bGUpOwogIGNvbnN0IHFyTGFiZWwgPSB2aXNpYmxlVGV4dChzY2VuZS5xckxhYmVsKTsKCiAgcmV0dXJuICgKICAg
IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuaW1hZ2VTY2VuZX0+CiAgICAgIHtzY2VuZS5tZWRpYVVybCA/ICgKICAgICAgICA8aW1nCiAgICAgICAgICBzcmM9
e3NjZW5lLm1lZGlhVXJsfQogICAgICAgICAgYWx0PXt0aXRsZSB8fCAiQnVyZ2VyIEJyb3RoZXJzIn0KICAgICAgICAgIGNsYXNzTmFtZT17c2NlbmUuZml0
ID09PSAiY29udGFpbiIgPyBzdHlsZXMuaW1hZ2VDb250YWluIDogc3R5bGVzLmltYWdlQ292ZXJ9CiAgICAgICAgLz4KICAgICAgKSA6ICgKICAgICAgICA8
TG9nbyB1cmw9e3NuYXBzaG90LmJyYW5kaW5nLmxvZ29Vcmx9IG5hbWU9e3NuYXBzaG90LmJyYW5kaW5nLnNob3BOYW1lfSAvPgogICAgICApfQogICAgICA8
ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmltYWdlU2hhZGV9IC8+CiAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuaW1hZ2VDb3B5fT4KICAgICAgICB7c2Nl
bmUuYmFkZ2UgPyA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmJhZGdlfT57c2NlbmUuYmFkZ2V9PC9kaXY+IDogbnVsbH0KICAgICAgICB7dGl0bGUgPyA8aDI+
e3RpdGxlfTwvaDI+IDogbnVsbH0KICAgICAgICB7c3VidGl0bGUgPyA8cD57c3VidGl0bGV9PC9wPiA6IG51bGx9CiAgICAgIDwvZGl2PgogICAgICB7c2Nl
bmUuc2hvd1FyID8gKAogICAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuaW1hZ2VRcn0+CiAgICAgICAgICA8U2hhcnBRcgogICAgICAgICAgICB2YWx1
ZT17c2NlbmUucXJVcmwgfHwgc25hcHNob3QuZG9jdW1lbnQuc2V0dGluZ3MucXJVcmx9CiAgICAgICAgICAgIGxhYmVsPXtxckxhYmVsfQogICAgICAgICAg
Lz4KICAgICAgICA8L2Rpdj4KICAgICAgKSA6IG51bGx9CiAgICA8L2Rpdj4KICApOwp9CgpmdW5jdGlvbiBRclNjZW5lKHsgc2NlbmUsIHNuYXBzaG90IH06
IHsgc2NlbmU6IFNob3djYXNlU2NlbmU7IHNuYXBzaG90OiBTaG93Y2FzZVNuYXBzaG90IH0pIHsKICBjb25zdCB0aXRsZSA9IHZpc2libGVUZXh0KHNjZW5l
LnRpdGxlKTsKICBjb25zdCBzdWJ0aXRsZSA9IHZpc2libGVUZXh0KHNjZW5lLnN1YnRpdGxlKTsKICBjb25zdCBib2R5ID0gdmlzaWJsZVRleHQoc2NlbmUu
Ym9keSk7CiAgY29uc3QgcXJMYWJlbCA9IHZpc2libGVUZXh0KHNjZW5lLnFyTGFiZWwpOwoKICByZXR1cm4gKAogICAgPGRpdiBjbGFzc05hbWU9e3N0eWxl
cy5xclNjZW5lfT4KICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5xclNjZW5lQ29weX0+CiAgICAgICAge3NjZW5lLnNob3dMb2dvICE9PSBmYWxzZSA/
ICgKICAgICAgICAgIDxMb2dvIHVybD17c25hcHNob3QuYnJhbmRpbmcubG9nb1VybH0gbmFtZT17c25hcHNob3QuYnJhbmRpbmcuc2hvcE5hbWV9IC8+CiAg
ICAgICAgKSA6IG51bGx9CiAgICAgICAge3NjZW5lLmJhZGdlID8gPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5iYWRnZX0+e3NjZW5lLmJhZGdlfTwvZGl2PiA6
IG51bGx9CiAgICAgICAge3RpdGxlID8gPGgyPnt0aXRsZX08L2gyPiA6IG51bGx9CiAgICAgICAge3N1YnRpdGxlID8gPHA+e3N1YnRpdGxlfTwvcD4gOiBu
dWxsfQogICAgICAgIHtib2R5ID8gPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5ib2R5VGV4dH0+e2JvZHl9PC9kaXY+IDogbnVsbH0KICAgICAgPC9kaXY+CiAg
ICAgIDxTaGFycFFyCiAgICAgICAgdmFsdWU9e3NjZW5lLnFyVXJsIHx8IHNuYXBzaG90LmRvY3VtZW50LnNldHRpbmdzLnFyVXJsIHx8IHNuYXBzaG90LmJy
YW5kaW5nLnNpdGVVcmx9CiAgICAgICAgbGFiZWw9e3FyTGFiZWx9CiAgICAgIC8+CiAgICA8L2Rpdj4KICApOwp9CgpmdW5jdGlvbiBNZXNzYWdlU2NlbmUo
eyBzY2VuZSwgc25hcHNob3QgfTogeyBzY2VuZTogU2hvd2Nhc2VTY2VuZTsgc25hcHNob3Q6IFNob3djYXNlU25hcHNob3QgfSkgewogIGNvbnN0IHRpdGxl
ID0gdmlzaWJsZVRleHQoc2NlbmUudGl0bGUpOwogIGNvbnN0IHN1YnRpdGxlID0gdmlzaWJsZVRleHQoc2NlbmUuc3VidGl0bGUpOwogIGNvbnN0IGJvZHkg
PSB2aXNpYmxlVGV4dChzY2VuZS5ib2R5KTsKICBjb25zdCBxckxhYmVsID0gdmlzaWJsZVRleHQoc2NlbmUucXJMYWJlbCk7CgogIHJldHVybiAoCiAgICA8
ZGl2IGNsYXNzTmFtZT17c3R5bGVzLm1lc3NhZ2VTY2VuZX0+CiAgICAgIHtzY2VuZS5zaG93TG9nbyAhPT0gZmFsc2UgPyAoCiAgICAgICAgPExvZ28gdXJs
PXtzbmFwc2hvdC5icmFuZGluZy5sb2dvVXJsfSBuYW1lPXtzbmFwc2hvdC5icmFuZGluZy5zaG9wTmFtZX0gLz4KICAgICAgKSA6IG51bGx9CiAgICAgIHtz
Y2VuZS5iYWRnZSA/IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuYmFkZ2V9PntzY2VuZS5iYWRnZX08L2Rpdj4gOiBudWxsfQogICAgICA8ZGl2IGNsYXNzTmFt
ZT17c3R5bGVzLm1lc3NhZ2VEaXZpZGVyfSBhcmlhLWhpZGRlbj0idHJ1ZSIgLz4KICAgICAge3RpdGxlID8gPGgyPnt0aXRsZX08L2gyPiA6IG51bGx9CiAg
ICAgIHtzdWJ0aXRsZSA/IDxwIGNsYXNzTmFtZT17c3R5bGVzLm1lc3NhZ2VTdWJ0aXRsZX0+e3N1YnRpdGxlfTwvcD4gOiBudWxsfQogICAgICB7Ym9keSA/
IDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMubWVzc2FnZUJvZHl9Pntib2R5fTwvZGl2PiA6IG51bGx9CiAgICAgIHtzY2VuZS5zaG93UXIgPyAoCiAgICAgICAg
PFNoYXJwUXIKICAgICAgICAgIHZhbHVlPXtzY2VuZS5xclVybCB8fCBzbmFwc2hvdC5kb2N1bWVudC5zZXR0aW5ncy5xclVybH0KICAgICAgICAgIGxhYmVs
PXtxckxhYmVsfQogICAgICAgIC8+CiAgICAgICkgOiBudWxsfQogICAgPC9kaXY+CiAgKTsKfQoKZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gU2hvd2Nhc2VT
dGFnZSh7CiAgc25hcHNob3QsCiAgc2NlbmUsCiAgc2NlbmVJbmRleCwKICBzY2VuZUNvdW50LAogIHByZXZpZXcgPSBmYWxzZSwKICBwcmV2aWV3QXNwZWN0
ID0gImxhbmRzY2FwZSIsCiAgb25saW5lID0gdHJ1ZSwKICBvblZpZGVvRW5kZWQsCiAgb25WaWRlb0Vycm9yLAp9OiBQcm9wcykgewogIGNvbnN0IHByb2R1
Y3QgPSB1c2VNZW1vKAogICAgKCkgPT4gcHJvZHVjdEZvcihzY2VuZSwgc25hcHNob3QucHJvZHVjdHMpLAogICAgW3NjZW5lLCBzbmFwc2hvdC5wcm9kdWN0
c10sCiAgKTsKICBjb25zdCBjYW1wYWlnbiA9IHVzZU1lbW8oCiAgICAoKSA9PiBjYW1wYWlnbkZvcihzY2VuZSwgc25hcHNob3QuY2FtcGFpZ25zKSwKICAg
IFtzY2VuZSwgc25hcHNob3QuY2FtcGFpZ25zXSwKICApOwogIGNvbnN0IGFjY2VudCA9IHNjZW5lLmFjY2VudCB8fCAiI2ZmOWQyZSI7CiAgY29uc3QgdHJh
bnNpdGlvbkNsYXNzID0gc3R5bGVzW2B0cmFuc2l0aW9uXyR7c2NlbmUudHJhbnNpdGlvbn1gXSB8fCBzdHlsZXMudHJhbnNpdGlvbl9mYWRlOwogIGNvbnN0
IHRoZW1lQ2xhc3MgPSBzdHlsZXNbYHRoZW1lXyR7c25hcHNob3QuYnJhbmRpbmcudGhlbWVJZH1gXSB8fCBzdHlsZXMudGhlbWVfY2xhc3NpYzsKICBjb25z
dCBwcmV2aWV3QXNwZWN0Q2xhc3MgPSBwcmV2aWV3CiAgICA/IHByZXZpZXdBc3BlY3QgPT09ICJwb3J0cmFpdCIKICAgICAgPyBzdHlsZXMucHJldmlld1Bv
cnRyYWl0CiAgICAgIDogcHJldmlld0FzcGVjdCA9PT0gInVsdHJhd2lkZSIKICAgICAgICA/IHN0eWxlcy5wcmV2aWV3VWx0cmF3aWRlCiAgICAgICAgOiBz
dHlsZXMucHJldmlld0xhbmRzY2FwZQogICAgOiAiIjsKICBjb25zdCBiYWNrZ3JvdW5kQ2xhc3MgPQogICAgc25hcHNob3QuZG9jdW1lbnQuc2V0dGluZ3Mu
YmFja2dyb3VuZCA9PT0gImJsYWNrIgogICAgICA/IHN0eWxlcy5iYWNrZ3JvdW5kX2JsYWNrCiAgICAgIDogc25hcHNob3QuZG9jdW1lbnQuc2V0dGluZ3Mu
YmFja2dyb3VuZCA9PT0gImRhcmsiCiAgICAgICAgPyBzdHlsZXMuYmFja2dyb3VuZF9kYXJrCiAgICAgICAgOiBzdHlsZXMuYmFja2dyb3VuZF90aGVtZTsK
CiAgcmV0dXJuICgKICAgIDxzZWN0aW9uCiAgICAgIGNsYXNzTmFtZT17WwogICAgICAgIHN0eWxlcy5zdGFnZSwKICAgICAgICBwcmV2aWV3ID8gc3R5bGVz
LnByZXZpZXcgOiBzdHlsZXMuZnVsbHNjcmVlbiwKICAgICAgICBwcmV2aWV3QXNwZWN0Q2xhc3MsCiAgICAgICAgdHJhbnNpdGlvbkNsYXNzLAogICAgICAg
IHRoZW1lQ2xhc3MsCiAgICAgICAgYmFja2dyb3VuZENsYXNzLAogICAgICBdLmpvaW4oIiAiKX0KICAgICAgc3R5bGU9ewogICAgICAgIHsKICAgICAgICAg
ICItLXNob3djYXNlLWFjY2VudCI6IGFjY2VudCwKICAgICAgICAgICItLXNob3djYXNlLXRoZW1lIjogc25hcHNob3QuYnJhbmRpbmcudGhlbWVDb2xvciB8
fCAiIzBiMDcwNCIsCiAgICAgICAgfSBhcyBSZWFjdC5DU1NQcm9wZXJ0aWVzCiAgICAgIH0KICAgICAgYXJpYS1sYWJlbD17c2NlbmUubmFtZX0KICAgID4K
ICAgICAgPEJhY2tncm91bmQgc2NlbmU9e3NjZW5lfSBzbmFwc2hvdD17c25hcHNob3R9IC8+CiAgICAgIHtzY2VuZS50eXBlID09PSAicHJvZHVjdCIgfHwg
c2NlbmUudHlwZSA9PT0gIm1lbnUiID8gbnVsbCA6ICgKICAgICAgICA8VGhlbWVEZWNvcmF0aW9ucyBzbmFwc2hvdD17c25hcHNob3R9IC8+CiAgICAgICl9
CiAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuc2NlbmVDYW52YXN9PgogICAgICAgIDxkaXYgY2xhc3NOYW1lPXtzdHlsZXMuY29udGVudH0ga2V5PXtg
JHtzY2VuZS5pZH06JHtzY2VuZUluZGV4fWB9PgogICAgICAgICAge3NjZW5lLnR5cGUgPT09ICJoZXJvIiA/IDxIZXJvU2NlbmUgc2NlbmU9e3NjZW5lfSBz
bmFwc2hvdD17c25hcHNob3R9IC8+IDogbnVsbH0KICAgICAgICAgIHtzY2VuZS50eXBlID09PSAidmlkZW8iID8gKAogICAgICAgICAgICA8VmlkZW9TY2Vu
ZQogICAgICAgICAgICAgIHNjZW5lPXtzY2VuZX0KICAgICAgICAgICAgICBzbmFwc2hvdD17c25hcHNob3R9CiAgICAgICAgICAgICAgcHJvZHVjdD17cHJv
ZHVjdH0KICAgICAgICAgICAgICBvbkVuZGVkPXtvblZpZGVvRW5kZWR9CiAgICAgICAgICAgICAgb25FcnJvcj17b25WaWRlb0Vycm9yfQogICAgICAgICAg
ICAvPgogICAgICAgICAgKSA6IG51bGx9CiAgICAgICAgICB7c2NlbmUudHlwZSA9PT0gInByb2R1Y3QiID8gPFByb2R1Y3RGbG93U2NlbmUgc2NlbmU9e3Nj
ZW5lfSBzbmFwc2hvdD17c25hcHNob3R9IC8+IDogbnVsbH0KICAgICAgICAgIHtzY2VuZS50eXBlID09PSAibWVudSIgPyA8TWVudVNjZW5lIHNjZW5lPXtz
Y2VuZX0gc25hcHNob3Q9e3NuYXBzaG90fSAvPiA6IG51bGx9CiAgICAgICAgICB7c2NlbmUudHlwZSA9PT0gImNhbXBhaWduIiA/ICgKICAgICAgICAgICAg
PENhbXBhaWduU2NlbmUgc2NlbmU9e3NjZW5lfSBzbmFwc2hvdD17c25hcHNob3R9IGNhbXBhaWduPXtjYW1wYWlnbn0gLz4KICAgICAgICAgICkgOiBudWxs
fQogICAgICAgICAge3NjZW5lLnR5cGUgPT09ICJpbWFnZSIgPyA8SW1hZ2VTY2VuZSBzY2VuZT17c2NlbmV9IHNuYXBzaG90PXtzbmFwc2hvdH0gLz4gOiBu
dWxsfQogICAgICAgICAge3NjZW5lLnR5cGUgPT09ICJxciIgPyA8UXJTY2VuZSBzY2VuZT17c2NlbmV9IHNuYXBzaG90PXtzbmFwc2hvdH0gLz4gOiBudWxs
fQogICAgICAgICAge3NjZW5lLnR5cGUgPT09ICJtZXNzYWdlIiA/IDxNZXNzYWdlU2NlbmUgc2NlbmU9e3NjZW5lfSBzbmFwc2hvdD17c25hcHNob3R9IC8+
IDogbnVsbH0KICAgICAgICA8L2Rpdj4KCiAgICAgICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy50b3BDaHJvbWV9PgogICAgICAgICAge3NuYXBzaG90LmRv
Y3VtZW50LnNldHRpbmdzLnNob3dDb25uZWN0aW9uU3RhdGUgPyAoCiAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPXtvbmxpbmUgPyBzdHlsZXMub25saW5l
IDogc3R5bGVzLm9mZmxpbmV9PgogICAgICAgICAgICAgIDxzcGFuIC8+IHtvbmxpbmUgPyAiT05MSU5FIiA6ICJPRkZMSU5FLU1PRFVTIn0KICAgICAgICAg
ICAgPC9kaXY+CiAgICAgICAgICApIDogPHNwYW4gLz59CiAgICAgICAgICB7c25hcHNob3QuZG9jdW1lbnQuc2V0dGluZ3Muc2hvd0Nsb2NrID8gPENsb2Nr
IC8+IDogbnVsbH0KICAgICAgICA8L2Rpdj4KCiAgICAgICAge3NuYXBzaG90LmRvY3VtZW50LnNldHRpbmdzLnRpY2tlciA/ICgKICAgICAgICAgIDxkaXYg
Y2xhc3NOYW1lPXtzdHlsZXMudGlja2VyfT4KICAgICAgICAgICAgPGRpdj57c25hcHNob3QuZG9jdW1lbnQuc2V0dGluZ3MudGlja2VyfTwvZGl2PgogICAg
ICAgICAgPC9kaXY+CiAgICAgICAgKSA6IG51bGx9CgogICAgICAgIHtzbmFwc2hvdC5kb2N1bWVudC5zZXR0aW5ncy5zaG93UHJvZ3Jlc3MgJiYgc2NlbmVD
b3VudCA+IDEgPyAoCiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnByb2dyZXNzfT4KICAgICAgICAgICAge0FycmF5LmZyb20oeyBsZW5ndGg6
IHNjZW5lQ291bnQgfSkubWFwKChfLCBpbmRleCkgPT4gKAogICAgICAgICAgICAgIDxzcGFuIGtleT17aW5kZXh9IGNsYXNzTmFtZT17aW5kZXggPT09IHNj
ZW5lSW5kZXggPyBzdHlsZXMucHJvZ3Jlc3NBY3RpdmUgOiAiIn0gLz4KICAgICAgICAgICAgKSl9CiAgICAgICAgICA8L2Rpdj4KICAgICAgICApIDogbnVs
bH0KICAgICAgPC9kaXY+CiAgICA8L3NlY3Rpb24+CiAgKTsKfQo=
'@
    },
    [pscustomobject]@{
        Path = "app\admin\showcase\page.tsx"
        GitPath = "app/admin/showcase/page.tsx"
        OriginalSha256 = "1E9DC280449DB44F41196A64768618C93F2061B7195C8A65CA92D9D5E397BBCF"
        PatchedSha256 = "2917974A480A7B2DE09E8669CC320507217E5FE352AF86F5B292BE13D929D82C"
        Base64 = @'
InVzZSBjbGllbnQiOwoKaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VNZW1vLCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSAicmVhY3QiOwppbXBvcnQgU2hvd2Nh
c2VTdGFnZSBmcm9tICJAL2NvbXBvbmVudHMvc2hvd2Nhc2UvU2hvd2Nhc2VTdGFnZSI7CmltcG9ydCB7CiAgY3JlYXRlRGVmYXVsdFNob3djYXNlRG9jdW1l
bnQsCiAgbm9ybWFsaXplU2hvd2Nhc2VEb2N1bWVudCwKfSBmcm9tICJAL2xpYi9zaG93Y2FzZS9jb25maWciOwppbXBvcnQgewogIGF2YWlsYWJsZVNob3dj
YXNlQ2F0ZWdvcmllcywKICBidWlsZFNob3djYXNlTWVudVBhZ2VzLAogIGVmZmVjdGl2ZVNob3djYXNlU2NlbmVEdXJhdGlvbiwKICBzZWxlY3RlZFByb2R1
Y3RzRm9yU2NlbmUsCiAgc2hvd2Nhc2VDYXRlZ29yeUxhYmVsLAp9IGZyb20gIkAvbGliL3Nob3djYXNlL3J1bnRpbWUiOwppbXBvcnQgdHlwZSB7CiAgU2hv
d2Nhc2VCcmFuZGluZywKICBTaG93Y2FzZUNhbXBhaWduLAogIFNob3djYXNlRG9jdW1lbnQsCiAgU2hvd2Nhc2VNZWRpYUl0ZW0sCiAgU2hvd2Nhc2VQcm9k
dWN0LAogIFNob3djYXNlUHJldmlld0FzcGVjdCwKICBTaG93Y2FzZVNjZW5lLAogIFNob3djYXNlU2NlbmVUeXBlLAogIFNob3djYXNlU25hcHNob3QsCn0g
ZnJvbSAiQC9saWIvc2hvd2Nhc2UvdHlwZXMiOwoKY29uc3QgVFlQRV9MQUJFTFM6IFJlY29yZDxTaG93Y2FzZVNjZW5lVHlwZSwgc3RyaW5nPiA9IHsKICBo
ZXJvOiAiR2lyacWfIGVrcmFuxLEiLAogIHZpZGVvOiAiVmlkZW8iLAogIHByb2R1Y3Q6ICLDnHLDvG4gYWvEscWfxLEiLAogIG1lbnU6ICJEaWppdGFsIG1l
bsO8IiwKICBjYW1wYWlnbjogIkthbXBhbnlhIiwKICBpbWFnZTogIkfDtnJzZWwiLAogIHFyOiAiUVIga29kIiwKICBtZXNzYWdlOiAiTWV0aW4gLyBEdXl1
cnUiLAp9OwoKY29uc3QgVFlQRV9JQ09OUzogUmVjb3JkPFNob3djYXNlU2NlbmVUeXBlLCBzdHJpbmc+ID0gewogIGhlcm86ICLwn5SlIiwKICB2aWRlbzog
IvCfjqwiLAogIHByb2R1Y3Q6ICLwn42UIiwKICBtZW51OiAi8J+TiyIsCiAgY2FtcGFpZ246ICLwn4+377iPIiwKICBpbWFnZTogIvCflrzvuI8iLAogIHFy
OiAi8J+TsSIsCiAgbWVzc2FnZTogIvCfkqwiLAp9OwoKdHlwZSBTdG9yYWdlU3RhdGUgPSB7CiAgY29uZmlndXJlZDogYm9vbGVhbjsKICBwcm92aWRlcjog
ImNsb3VkaW5hcnkiOwogIGNsb3VkTmFtZTogc3RyaW5nOwogIG1heFVwbG9hZEJ5dGVzOiBudW1iZXI7Cn07Cgp0eXBlIEFkbWluUGF5bG9hZCA9IHsKICBk
cmFmdDogU2hvd2Nhc2VEb2N1bWVudDsKICBwdWJsaXNoZWQ6IFNob3djYXNlRG9jdW1lbnQ7CiAgbWVkaWE6IFNob3djYXNlTWVkaWFJdGVtW107CiAgcHJv
ZHVjdHM6IFNob3djYXNlUHJvZHVjdFtdOwogIGNhbXBhaWduczogU2hvd2Nhc2VDYW1wYWlnbltdOwogIGJyYW5kaW5nOiBTaG93Y2FzZUJyYW5kaW5nOwog
IHN0b3JhZ2U6IFN0b3JhZ2VTdGF0ZTsKfTsKCmZ1bmN0aW9uIHVpZChwcmVmaXggPSAic2NlbmUiKSB7CiAgdHJ5IHsKICAgIHJldHVybiBgJHtwcmVmaXh9
LSR7Y3J5cHRvLnJhbmRvbVVVSUQoKX1gOwogIH0gY2F0Y2ggewogICAgcmV0dXJuIGAke3ByZWZpeH0tJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX0tJHtN
YXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA4KX1gOwogIH0KfQoKZnVuY3Rpb24gZm9ybWF0Qnl0ZXModmFsdWU6IG51bWJlcikgewogIGNv
bnN0IGJ5dGVzID0gTnVtYmVyKHZhbHVlIHx8IDApOwogIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBgJHtieXRlc30gQmA7CiAgaWYgKGJ5dGVzIDwgMTAy
NCAqKiAyKSByZXR1cm4gYCR7KGJ5dGVzIC8gMTAyNCkudG9GaXhlZCgxKX0gS0JgOwogIGlmIChieXRlcyA8IDEwMjQgKiogMykgcmV0dXJuIGAkeyhieXRl
cyAvIDEwMjQgKiogMikudG9GaXhlZCgxKX0gTUJgOwogIHJldHVybiBgJHsoYnl0ZXMgLyAxMDI0ICoqIDMpLnRvRml4ZWQoMil9IEdCYDsKfQoKZnVuY3Rp
b24gbG9jYWxEYXRlKHZhbHVlPzogc3RyaW5nKSB7CiAgaWYgKCF2YWx1ZSkgcmV0dXJuICIiOwogIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSh2YWx1ZSk7CiAg
aWYgKCFOdW1iZXIuaXNGaW5pdGUoZGF0ZS52YWx1ZU9mKCkpKSByZXR1cm4gIiI7CiAgY29uc3Qgb2Zmc2V0ID0gZGF0ZS5nZXRUaW1lem9uZU9mZnNldCgp
ICogNjBfMDAwOwogIHJldHVybiBuZXcgRGF0ZShkYXRlLnZhbHVlT2YoKSAtIG9mZnNldCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxNik7Cn0KCmZ1bmN0
aW9uIGlzb0RhdGUodmFsdWU6IHN0cmluZykgewogIGlmICghdmFsdWUpIHJldHVybiB1bmRlZmluZWQ7CiAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHZhbHVl
KTsKICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGRhdGUudmFsdWVPZigpKSA/IGRhdGUudG9JU09TdHJpbmcoKSA6IHVuZGVmaW5lZDsKfQoKZnVuY3Rpb24g
bmV3U2NlbmUodHlwZTogU2hvd2Nhc2VTY2VuZVR5cGUsIGRvY3VtZW50OiBTaG93Y2FzZURvY3VtZW50KTogU2hvd2Nhc2VTY2VuZSB7CiAgY29uc3QgY29t
bW9uID0gewogICAgaWQ6IHVpZCgpLAogICAgdHlwZSwKICAgIG5hbWU6IFRZUEVfTEFCRUxTW3R5cGVdLAogICAgZW5hYmxlZDogdHJ1ZSwKICAgIGR1cmF0
aW9uU2Vjb25kczogZG9jdW1lbnQuc2V0dGluZ3MuZGVmYXVsdER1cmF0aW9uU2Vjb25kcywKICAgIHRyYW5zaXRpb246ICJmYWRlIiBhcyBjb25zdCwKICAg
IGFjY2VudDogIiNmZjlkMmUiLAogICAgZml0OiAiY292ZXIiIGFzIGNvbnN0LAogICAgc2hvd0xvZ286IHRydWUsCiAgICBzaG93UXI6IHR5cGUgIT09ICJ2
aWRlbyIsCiAgICBxckxhYmVsOiBkb2N1bWVudC5zZXR0aW5ncy5xckxhYmVsLAogICAgc2hvd1ByaWNlOiB0cnVlLAogICAgbXV0ZWQ6IHRydWUsCiAgfTsK
CiAgaWYgKHR5cGUgPT09ICJoZXJvIikgewogICAgcmV0dXJuIHsKICAgICAgLi4uY29tbW9uLAogICAgICB0aXRsZTogIkJVUkdFUiBCUk9USEVSUyBCRVJM
SU4iLAogICAgICBzdWJ0aXRsZTogIkZyaXNjaCBnZWdyaWxsdC4gRGlyZWt0IGJlc3RlbGx0LiIsCiAgICAgIGJhZGdlOiAiQkVSTElOLVRFR0VMIiwKICAg
IH07CiAgfQogIGlmICh0eXBlID09PSAidmlkZW8iKSB7CiAgICByZXR1cm4gewogICAgICAuLi5jb21tb24sCiAgICAgIG5hbWU6ICJZZW5pIHZpZGVvIiwK
ICAgICAgdGl0bGU6ICJGcmlzY2ggZsO8ciBTaWUgenViZXJlaXRldCIsCiAgICAgIHN1YnRpdGxlOiAiQnVyZ2VyIEJyb3RoZXJzIEJlcmxpbiIsCiAgICAg
IHNob3dRcjogZmFsc2UsCiAgICB9OwogIH0KICBpZiAodHlwZSA9PT0gInByb2R1Y3QiKSB7CiAgICByZXR1cm4gewogICAgICAuLi5jb21tb24sCiAgICAg
IG5hbWU6ICLDnHLDvG4gYWvEscWfxLEiLAogICAgICB0aXRsZTogIkJVUkdFUiBCUk9USEVSUyBFTVBGSUVITFQiLAogICAgICBzdWJ0aXRsZTogIkZyaXNj
aCB6dWJlcmVpdGV0IHVuZCB2b2xsZXIgR2VzY2htYWNrLiIsCiAgICAgIHByb2R1Y3RJZHM6IFtdLAogICAgICBwcm9kdWN0U2Vjb25kczogMTIsCiAgICAg
IHByb2R1Y3RJbWFnZUZpdDogImNvbnRhaW4iLAogICAgICBwcm9kdWN0SW1hZ2VTY2FsZTogODIsCiAgICAgIHByb2R1Y3RJbWFnZVg6IDAsCiAgICAgIHBy
b2R1Y3RJbWFnZVk6IDAsCiAgICAgIHNob3dMb2dvOiBmYWxzZSwKICAgICAgc2hvd1FyOiBmYWxzZSwKICAgICAgZml0OiAiY29udGFpbiIsCiAgICB9Owog
IH0KICBpZiAodHlwZSA9PT0gIm1lbnUiKSB7CiAgICByZXR1cm4gewogICAgICAuLi5jb21tb24sCiAgICAgIG5hbWU6ICJEaWppdGFsIG1lbsO8IiwKICAg
ICAgdGl0bGU6ICJVTlNFUkUgU1BFSVNFS0FSVEUiLAogICAgICBzdWJ0aXRsZTogIkZyaXNjaCB6dWJlcmVpdGV0LiBEaXJla3Qgb25saW5lIGJlc3RlbGxl
bi4iLAogICAgICBtZW51Q2F0ZWdvcmllczogW10sCiAgICAgIG1lbnVJdGVtc1BlclBhZ2U6IDgsCiAgICAgIG1lbnVQYWdlU2Vjb25kczogMTIsCiAgICAg
IG1lbnVDb2x1bW5zOiAyLAogICAgICBtZW51U2hvd0Rlc2NyaXB0aW9uczogZmFsc2UsCiAgICAgIG1lbnVTaG93SW1hZ2VzOiB0cnVlLAogICAgICBtZW51
SW1hZ2VTaXplOiA1OCwKICAgICAgc2hvd0xvZ286IGZhbHNlLAogICAgICBzaG93UXI6IGZhbHNlLAogICAgfTsKICB9CiAgaWYgKHR5cGUgPT09ICJjYW1w
YWlnbiIpIHsKICAgIHJldHVybiB7CiAgICAgIC4uLmNvbW1vbiwKICAgICAgbmFtZTogIkthbXBhbnlhIiwKICAgICAgdGl0bGU6ICJBS1RVRUxMRSBBS1RJ
T04iLAogICAgICBzdWJ0aXRsZTogIk51ciBmw7xyIGt1cnplIFplaXQiLAogICAgICBiYWRnZTogIkxJTUlUSUVSVEUgQUtUSU9OIiwKICAgIH07CiAgfQog
IGlmICh0eXBlID09PSAiaW1hZ2UiKSB7CiAgICByZXR1cm4geyAuLi5jb21tb24sIG5hbWU6ICJHw7Zyc2VsIiwgdGl0bGU6ICJCdXJnZXIgQnJvdGhlcnMg
QmVybGluIiwgc2hvd1FyOiBmYWxzZSB9OwogIH0KICBpZiAodHlwZSA9PT0gInFyIikgewogICAgcmV0dXJuIHsKICAgICAgLi4uY29tbW9uLAogICAgICBu
YW1lOiAiT25saW5lIHNpcGFyacWfIiwKICAgICAgdGl0bGU6ICJKRVRaVCBPTkxJTkUgQkVTVEVMTEVOIiwKICAgICAgc3VidGl0bGU6ICJRUi1Db2RlIHNj
YW5uZW4gdW5kIGRpcmVrdCB6dXIgU3BlaXNla2FydGUiLAogICAgfTsKICB9CiAgcmV0dXJuIHsKICAgIC4uLmNvbW1vbiwKICAgIG5hbWU6ICJEdXl1cnUi
LAogICAgYmFkZ2U6ICJXSUNIVElHRSBJTkZPUk1BVElPTiIsCiAgICB0aXRsZTogIldJQ0hUSUdFIE1JVFRFSUxVTkciLAogICAgc3VidGl0bGU6ICJBa3R1
ZWxsZSBJbmZvcm1hdGlvbmVuIHZvbiBCdXJnZXIgQnJvdGhlcnMgQmVybGluLiIsCiAgICBib2R5OiAiw5ZmZm51bmdzemVpdGVuLCBMaWVmZXJoaW53ZWlz
ZSBvZGVyIGVpbmUgYmVzb25kZXJlIEFua8O8bmRpZ3VuZyBoaWVyIGVpbnRyYWdlbi4iLAogICAgc2hvd1FyOiBmYWxzZSwKICB9Owp9Cgphc3luYyBmdW5j
dGlvbiBqc29uRmV0Y2godXJsOiBzdHJpbmcsIGluaXQ/OiBSZXF1ZXN0SW5pdCkgewogIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7CiAg
ICAuLi5pbml0LAogICAgaGVhZGVyczogeyAiQ29udGVudC1UeXBlIjogImFwcGxpY2F0aW9uL2pzb24iLCAuLi4oaW5pdD8uaGVhZGVycyB8fCB7fSkgfSwK
ICAgIGNhY2hlOiAibm8tc3RvcmUiLAogIH0pOwogIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7CiAgaWYg
KCFyZXNwb25zZS5vayB8fCBkYXRhPy5vayA9PT0gZmFsc2UpIHsKICAgIHRocm93IG5ldyBFcnJvcihkYXRhPy5lcnJvciB8fCBgSFRUUF8ke3Jlc3BvbnNl
LnN0YXR1c31gKTsKICB9CiAgcmV0dXJuIGRhdGE7Cn0KCmZ1bmN0aW9uIHNpZ25hbFNob3djYXNlUHVibGlzaGVkKHZlcnNpb24/OiBzdHJpbmcpIHsKICBj
b25zdCBwYXlsb2FkID0gewogICAgdmVyc2lvbjogU3RyaW5nKHZlcnNpb24gfHwgIiIpLAogICAgYXQ6IERhdGUubm93KCksCiAgfTsKCiAgdHJ5IHsKICAg
IGNvbnN0IGNoYW5uZWwgPSBuZXcgQnJvYWRjYXN0Q2hhbm5lbCgiYmJfc2hvd2Nhc2VfbGl2ZV92MSIpOwogICAgY2hhbm5lbC5wb3N0TWVzc2FnZShwYXls
b2FkKTsKICAgIGNoYW5uZWwuY2xvc2UoKTsKICB9IGNhdGNoIHt9CgogIHRyeSB7CiAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgiYmJfc2hvd2Nhc2VfcHVi
bGlzaF9waW5nIiwgSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpOwogIH0gY2F0Y2gge30KfQoKYXN5bmMgZnVuY3Rpb24gaW5zcGVjdEZpbGUoZmlsZTogRmls
ZSk6IFByb21pc2U8eyB3aWR0aD86IG51bWJlcjsgaGVpZ2h0PzogbnVtYmVyOyBkdXJhdGlvblNlY29uZHM/OiBudW1iZXIgfT4gewogIGNvbnN0IHVybCA9
IFVSTC5jcmVhdGVPYmplY3RVUkwoZmlsZSk7CiAgdHJ5IHsKICAgIGlmIChmaWxlLnR5cGUuc3RhcnRzV2l0aCgidmlkZW8vIikpIHsKICAgICAgcmV0dXJu
IGF3YWl0IG5ldyBQcm9taXNlPHsgd2lkdGg/OiBudW1iZXI7IGhlaWdodD86IG51bWJlcjsgZHVyYXRpb25TZWNvbmRzPzogbnVtYmVyIH0+KChyZXNvbHZl
KSA9PiB7CiAgICAgICAgY29uc3QgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJ2aWRlbyIpOwogICAgICAgIHZpZGVvLnByZWxvYWQgPSAibWV0
YWRhdGEiOwogICAgICAgIHZpZGVvLm9ubG9hZGVkbWV0YWRhdGEgPSAoKSA9PgogICAgICAgICAgcmVzb2x2ZSh7CiAgICAgICAgICAgIHdpZHRoOiB2aWRl
by52aWRlb1dpZHRoIHx8IHVuZGVmaW5lZCwKICAgICAgICAgICAgaGVpZ2h0OiB2aWRlby52aWRlb0hlaWdodCB8fCB1bmRlZmluZWQsCiAgICAgICAgICAg
IGR1cmF0aW9uU2Vjb25kczogTnVtYmVyLmlzRmluaXRlKHZpZGVvLmR1cmF0aW9uKSA/IE1hdGgucm91bmQodmlkZW8uZHVyYXRpb24gKiAxMCkgLyAxMCA6
IHVuZGVmaW5lZCwKICAgICAgICAgIH0pOwogICAgICAgIHZpZGVvLm9uZXJyb3IgPSAoKSA9PiByZXNvbHZlKHt9KTsKICAgICAgICB2aWRlby5zcmMgPSB1
cmw7CiAgICAgIH0pOwogICAgfQoKICAgIGlmIChmaWxlLnR5cGUuc3RhcnRzV2l0aCgiaW1hZ2UvIikpIHsKICAgICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9t
aXNlPHsgd2lkdGg/OiBudW1iZXI7IGhlaWdodD86IG51bWJlciB9PigocmVzb2x2ZSkgPT4gewogICAgICAgIGNvbnN0IGltYWdlID0gbmV3IEltYWdlKCk7
CiAgICAgICAgaW1hZ2Uub25sb2FkID0gKCkgPT4gcmVzb2x2ZSh7IHdpZHRoOiBpbWFnZS5uYXR1cmFsV2lkdGgsIGhlaWdodDogaW1hZ2UubmF0dXJhbEhl
aWdodCB9KTsKICAgICAgICBpbWFnZS5vbmVycm9yID0gKCkgPT4gcmVzb2x2ZSh7fSk7CiAgICAgICAgaW1hZ2Uuc3JjID0gdXJsOwogICAgICB9KTsKICAg
IH0KICB9IGZpbmFsbHkgewogICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpOwogIH0KICByZXR1cm4ge307Cn0KCmZ1bmN0aW9uIHVwbG9hZENsb3VkaW5h
cnlXaXRoUHJvZ3Jlc3MoCiAgdXJsOiBzdHJpbmcsCiAgZmllbGRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+LAogIGZpbGU6IEZpbGUsCiAg
b25Qcm9ncmVzczogKHZhbHVlOiBudW1iZXIpID0+IHZvaWQsCikgewogIHJldHVybiBuZXcgUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PigocmVzb2x2
ZSwgcmVqZWN0KSA9PiB7CiAgICBjb25zdCB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTsKICAgIGNvbnN0IGZvcm0gPSBuZXcgRm9ybURhdGEoKTsKICAg
IE9iamVjdC5lbnRyaWVzKGZpZWxkcykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiBmb3JtLmFwcGVuZChrZXksIFN0cmluZyh2YWx1ZSkpKTsKICAgIGZv
cm0uYXBwZW5kKCJmaWxlIiwgZmlsZSk7CgogICAgeGhyLm9wZW4oIlBPU1QiLCB1cmwpOwogICAgeGhyLnVwbG9hZC5vbnByb2dyZXNzID0gKGV2ZW50KSA9
PiB7CiAgICAgIGlmIChldmVudC5sZW5ndGhDb21wdXRhYmxlKSBvblByb2dyZXNzKE1hdGgucm91bmQoKGV2ZW50LmxvYWRlZCAvIGV2ZW50LnRvdGFsKSAq
IDEwMCkpOwogICAgfTsKICAgIHhoci5vbmxvYWQgPSAoKSA9PiB7CiAgICAgIGNvbnN0IHJlc3BvbnNlID0gKCgpID0+IHsKICAgICAgICB0cnkgewogICAg
ICAgICAgcmV0dXJuIEpTT04ucGFyc2UoeGhyLnJlc3BvbnNlVGV4dCB8fCAie30iKTsKICAgICAgICB9IGNhdGNoIHsKICAgICAgICAgIHJldHVybiB7fTsK
ICAgICAgICB9CiAgICAgIH0pKCk7CiAgICAgIGlmICh4aHIuc3RhdHVzID49IDIwMCAmJiB4aHIuc3RhdHVzIDwgMzAwICYmIHJlc3BvbnNlPy5zZWN1cmVf
dXJsKSByZXNvbHZlKHJlc3BvbnNlKTsKICAgICAgZWxzZSByZWplY3QobmV3IEVycm9yKHJlc3BvbnNlPy5lcnJvcj8ubWVzc2FnZSB8fCBgQ0xPVURJTkFS
WV9VUExPQURfSFRUUF8ke3hoci5zdGF0dXN9YCkpOwogICAgfTsKICAgIHhoci5vbmVycm9yID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcigiQ0xPVURJTkFS
WV9VUExPQURfTkVUV09SS19FUlJPUiIpKTsKICAgIHhoci5vbmFib3J0ID0gKCkgPT4gcmVqZWN0KG5ldyBFcnJvcigiQ0xPVURJTkFSWV9VUExPQURfQUJP
UlRFRCIpKTsKICAgIHhoci5zZW5kKGZvcm0pOwogIH0pOwp9CgpmdW5jdGlvbiBGaWVsZCh7IGxhYmVsLCBjaGlsZHJlbiwgaGludCB9OiB7IGxhYmVsOiBz
dHJpbmc7IGNoaWxkcmVuOiBSZWFjdC5SZWFjdE5vZGU7IGhpbnQ/OiBzdHJpbmcgfSkgewogIHJldHVybiAoCiAgICA8bGFiZWwgY2xhc3NOYW1lPSJibG9j
ayBzcGFjZS15LTEuNSI+CiAgICAgIDxzcGFuIGNsYXNzTmFtZT0idGV4dC1zbSBmb250LXNlbWlib2xkIHRleHQtc3RvbmUtMjAwIj57bGFiZWx9PC9zcGFu
PgogICAgICB7Y2hpbGRyZW59CiAgICAgIHtoaW50ID8gPHNwYW4gY2xhc3NOYW1lPSJibG9jayB0ZXh0LXhzIHRleHQtc3RvbmUtNTAwIj57aGludH08L3Nw
YW4+IDogbnVsbH0KICAgIDwvbGFiZWw+CiAgKTsKfQoKY29uc3QgaW5wdXRDbGFzcyA9CiAgInctZnVsbCByb3VuZGVkLXhsIGJvcmRlciBib3JkZXItc3Rv
bmUtNzAwIGJnLXN0b25lLTk1MC84MCBweC0zIHB5LTIuNSB0ZXh0LXNtIHRleHQtd2hpdGUgb3V0bGluZS1ub25lIHRyYW5zaXRpb24gZm9jdXM6Ym9yZGVy
LW9yYW5nZS00MDAgZm9jdXM6cmluZy0yIGZvY3VzOnJpbmctb3JhbmdlLTUwMC8yMCI7CgpleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBTaG93Y2FzZUFkbWlu
UGFnZSgpIHsKICBjb25zdCBbZGF0YSwgc2V0RGF0YV0gPSB1c2VTdGF0ZTxBZG1pblBheWxvYWQgfCBudWxsPihudWxsKTsKICBjb25zdCBbZHJhZnQsIHNl
dERyYWZ0XSA9IHVzZVN0YXRlPFNob3djYXNlRG9jdW1lbnQgfCBudWxsPihudWxsKTsKICBjb25zdCBbc2VsZWN0ZWRJZCwgc2V0U2VsZWN0ZWRJZF0gPSB1
c2VTdGF0ZSgiIik7CiAgY29uc3QgW2J1c3ksIHNldEJ1c3ldID0gdXNlU3RhdGUoZmFsc2UpOwogIGNvbnN0IFttZXNzYWdlLCBzZXRNZXNzYWdlXSA9IHVz
ZVN0YXRlKCIiKTsKICBjb25zdCBbZXJyb3IsIHNldEVycm9yXSA9IHVzZVN0YXRlKCIiKTsKICBjb25zdCBbdXBsb2FkUHJvZ3Jlc3MsIHNldFVwbG9hZFBy
b2dyZXNzXSA9IHVzZVN0YXRlPG51bWJlciB8IG51bGw+KG51bGwpOwogIGNvbnN0IFtwcmV2aWV3QXNwZWN0LCBzZXRQcmV2aWV3QXNwZWN0XSA9IHVzZVN0
YXRlPFNob3djYXNlUHJldmlld0FzcGVjdD4oImxhbmRzY2FwZSIpOwogIGNvbnN0IGZpbGVSZWYgPSB1c2VSZWY8SFRNTElucHV0RWxlbWVudCB8IG51bGw+
KG51bGwpOwoKICBjb25zdCBsb2FkID0gYXN5bmMgKCkgPT4gewogICAgc2V0RXJyb3IoIiIpOwogICAgdHJ5IHsKICAgICAgY29uc3QgcGF5bG9hZCA9IChh
d2FpdCBqc29uRmV0Y2goIi9hcGkvYWRtaW4vc2hvd2Nhc2UiKSkgYXMgQWRtaW5QYXlsb2FkOwogICAgICBzZXREYXRhKHBheWxvYWQpOwogICAgICBzZXRE
cmFmdChwYXlsb2FkLmRyYWZ0KTsKICAgICAgc2V0U2VsZWN0ZWRJZCgoY3VycmVudCkgPT4gY3VycmVudCB8fCBwYXlsb2FkLmRyYWZ0LnNjZW5lc1swXT8u
aWQgfHwgIiIpOwogICAgfSBjYXRjaCAobG9hZEVycm9yOiBhbnkpIHsKICAgICAgc2V0RXJyb3IobG9hZEVycm9yPy5tZXNzYWdlIHx8ICJWaXRyaW4gZWty
YW7EsSB5w7xrbGVuZW1lZGkuIik7CiAgICB9CiAgfTsKCiAgdXNlRWZmZWN0KCgpID0+IHsKICAgIHZvaWQgbG9hZCgpOwogIH0sIFtdKTsKCiAgY29uc3Qg
cmVmcmVzaExpdmVTb3VyY2VzID0gYXN5bmMgKCkgPT4gewogICAgc2V0QnVzeSh0cnVlKTsKICAgIHNldEVycm9yKCIiKTsKICAgIHNldE1lc3NhZ2UoIiIp
OwogICAgdHJ5IHsKICAgICAgY29uc3QgcGF5bG9hZCA9IChhd2FpdCBqc29uRmV0Y2goIi9hcGkvYWRtaW4vc2hvd2Nhc2UiKSkgYXMgQWRtaW5QYXlsb2Fk
OwogICAgICBzZXREYXRhKChjdXJyZW50KSA9PgogICAgICAgIGN1cnJlbnQKICAgICAgICAgID8gewogICAgICAgICAgICAgIC4uLmN1cnJlbnQsCiAgICAg
ICAgICAgICAgcHVibGlzaGVkOiBwYXlsb2FkLnB1Ymxpc2hlZCwKICAgICAgICAgICAgICBtZWRpYTogcGF5bG9hZC5tZWRpYSwKICAgICAgICAgICAgICBw
cm9kdWN0czogcGF5bG9hZC5wcm9kdWN0cywKICAgICAgICAgICAgICBjYW1wYWlnbnM6IHBheWxvYWQuY2FtcGFpZ25zLAogICAgICAgICAgICAgIGJyYW5k
aW5nOiBwYXlsb2FkLmJyYW5kaW5nLAogICAgICAgICAgICAgIHN0b3JhZ2U6IHBheWxvYWQuc3RvcmFnZSwKICAgICAgICAgICAgfQogICAgICAgICAgOiBw
YXlsb2FkLAogICAgICApOwogICAgICBzZXRNZXNzYWdlKGBXZWIgc2l0ZXNpIHZlcmlsZXJpIHllbmlsZW5kaS4gQWt0aWYgdGVtYTogJHtwYXlsb2FkLmJy
YW5kaW5nLnRoZW1lSWR9YCk7CiAgICB9IGNhdGNoIChyZWZyZXNoRXJyb3I6IGFueSkgewogICAgICBzZXRFcnJvcihyZWZyZXNoRXJyb3I/Lm1lc3NhZ2Ug
fHwgIldlYiBzaXRlc2kgdGVtYSB2ZSDDvHLDvG4gdmVyaWxlcmkgeWVuaWxlbmVtZWRpLiIpOwogICAgfSBmaW5hbGx5IHsKICAgICAgc2V0QnVzeShmYWxz
ZSk7CiAgICB9CiAgfTsKCiAgY29uc3Qgc2VsZWN0ZWRJbmRleCA9IHVzZU1lbW8oCiAgICAoKSA9PiBkcmFmdD8uc2NlbmVzLmZpbmRJbmRleCgoc2NlbmUp
ID0+IHNjZW5lLmlkID09PSBzZWxlY3RlZElkKSA/PyAtMSwKICAgIFtkcmFmdD8uc2NlbmVzLCBzZWxlY3RlZElkXSwKICApOwogIGNvbnN0IHNlbGVjdGVk
ID0gc2VsZWN0ZWRJbmRleCA+PSAwID8gZHJhZnQ/LnNjZW5lc1tzZWxlY3RlZEluZGV4XSB8fCBudWxsIDogbnVsbDsKCiAgY29uc3Qgc2VsZWN0ZWRQcm9k
dWN0cyA9IHVzZU1lbW8oCiAgICAoKSA9PiAoc2VsZWN0ZWQgJiYgZGF0YSA/IHNlbGVjdGVkUHJvZHVjdHNGb3JTY2VuZShzZWxlY3RlZCwgZGF0YS5wcm9k
dWN0cykgOiBbXSksCiAgICBbc2VsZWN0ZWQsIGRhdGFdLAogICk7CiAgY29uc3QgYXZhaWxhYmxlQ2F0ZWdvcmllcyA9IHVzZU1lbW8oCiAgICAoKSA9PiAo
ZGF0YSA/IGF2YWlsYWJsZVNob3djYXNlQ2F0ZWdvcmllcyhkYXRhLnByb2R1Y3RzKSA6IFtdKSwKICAgIFtkYXRhXSwKICApOwogIGNvbnN0IHNlbGVjdGVk
TWVudVBhZ2VzID0gdXNlTWVtbygKICAgICgpID0+IChzZWxlY3RlZCAmJiBkYXRhID8gYnVpbGRTaG93Y2FzZU1lbnVQYWdlcyhzZWxlY3RlZCwgZGF0YS5w
cm9kdWN0cykgOiBbXSksCiAgICBbc2VsZWN0ZWQsIGRhdGFdLAogICk7CgogIGNvbnN0IHByZXZpZXdTbmFwc2hvdCA9IHVzZU1lbW88U2hvd2Nhc2VTbmFw
c2hvdCB8IG51bGw+KCgpID0+IHsKICAgIGlmICghZGF0YSB8fCAhZHJhZnQpIHJldHVybiBudWxsOwogICAgcmV0dXJuIHsKICAgICAgb2s6IHRydWUsCiAg
ICAgIHNvdXJjZTogImRiIiwKICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSwKICAgICAgZG9jdW1lbnQ6IGRyYWZ0LAogICAg
ICBwcm9kdWN0czogZGF0YS5wcm9kdWN0cywKICAgICAgY2FtcGFpZ25zOiBkYXRhLmNhbXBhaWducywKICAgICAgYnJhbmRpbmc6IGRhdGEuYnJhbmRpbmcs
CiAgICB9OwogIH0sIFtkYXRhLCBkcmFmdF0pOwoKICBjb25zdCB1cGRhdGVEb2N1bWVudCA9IChwYXRjaDogUGFydGlhbDxTaG93Y2FzZURvY3VtZW50Pikg
PT4gewogICAgc2V0RHJhZnQoKGN1cnJlbnQpID0+IChjdXJyZW50ID8geyAuLi5jdXJyZW50LCAuLi5wYXRjaCwgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRv
SVNPU3RyaW5nKCkgfSA6IGN1cnJlbnQpKTsKICB9OwoKICBjb25zdCB1cGRhdGVTZXR0aW5ncyA9IChwYXRjaDogUGFydGlhbDxTaG93Y2FzZURvY3VtZW50
WyJzZXR0aW5ncyJdPikgPT4gewogICAgc2V0RHJhZnQoKGN1cnJlbnQpID0+CiAgICAgIGN1cnJlbnQKICAgICAgICA/IHsKICAgICAgICAgICAgLi4uY3Vy
cmVudCwKICAgICAgICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksCiAgICAgICAgICAgIHNldHRpbmdzOiB7IC4uLmN1cnJlbnQu
c2V0dGluZ3MsIC4uLnBhdGNoIH0sCiAgICAgICAgICB9CiAgICAgICAgOiBjdXJyZW50LAogICAgKTsKICB9OwoKICBjb25zdCB1cGRhdGVTY2VuZSA9IChw
YXRjaDogUGFydGlhbDxTaG93Y2FzZVNjZW5lPikgPT4gewogICAgaWYgKCFzZWxlY3RlZElkKSByZXR1cm47CiAgICBzZXREcmFmdCgoY3VycmVudCkgPT4K
ICAgICAgY3VycmVudAogICAgICAgID8gewogICAgICAgICAgICAuLi5jdXJyZW50LAogICAgICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09T
dHJpbmcoKSwKICAgICAgICAgICAgc2NlbmVzOiBjdXJyZW50LnNjZW5lcy5tYXAoKHNjZW5lKSA9PgogICAgICAgICAgICAgIHNjZW5lLmlkID09PSBzZWxl
Y3RlZElkID8geyAuLi5zY2VuZSwgLi4ucGF0Y2ggfSA6IHNjZW5lLAogICAgICAgICAgICApLAogICAgICAgICAgfQogICAgICAgIDogY3VycmVudCwKICAg
ICk7CiAgfTsKCiAgY29uc3QgY2hhbmdlU2NlbmVUeXBlID0gKHR5cGU6IFNob3djYXNlU2NlbmVUeXBlKSA9PiB7CiAgICBpZiAoIWRyYWZ0IHx8ICFzZWxl
Y3RlZCkgcmV0dXJuOwogICAgY29uc3QgZGVmYXVsdHMgPSBuZXdTY2VuZSh0eXBlLCBkcmFmdCk7CiAgICB1cGRhdGVTY2VuZSh7CiAgICAgIHR5cGUsCiAg
ICAgIG5hbWU6IGRlZmF1bHRzLm5hbWUsCiAgICAgIHRpdGxlOiBkZWZhdWx0cy50aXRsZSwKICAgICAgc3VidGl0bGU6IGRlZmF1bHRzLnN1YnRpdGxlLAog
ICAgICBib2R5OiBkZWZhdWx0cy5ib2R5LAogICAgICBiYWRnZTogZGVmYXVsdHMuYmFkZ2UsCiAgICAgIHFyTGFiZWw6IGRlZmF1bHRzLnFyTGFiZWwsCiAg
ICAgIHNob3dMb2dvOiBkZWZhdWx0cy5zaG93TG9nbywKICAgICAgc2hvd1FyOiBkZWZhdWx0cy5zaG93UXIsCiAgICAgIHNob3dQcmljZTogZGVmYXVsdHMu
c2hvd1ByaWNlLAogICAgICBmaXQ6IGRlZmF1bHRzLmZpdCwKICAgICAgcHJvZHVjdElkczogZGVmYXVsdHMucHJvZHVjdElkcywKICAgICAgcHJvZHVjdElk
OiBkZWZhdWx0cy5wcm9kdWN0SWQsCiAgICAgIHByb2R1Y3RTZWNvbmRzOiBkZWZhdWx0cy5wcm9kdWN0U2Vjb25kcywKICAgICAgcHJvZHVjdEltYWdlRml0
OiBkZWZhdWx0cy5wcm9kdWN0SW1hZ2VGaXQsCiAgICAgIHByb2R1Y3RJbWFnZVNjYWxlOiBkZWZhdWx0cy5wcm9kdWN0SW1hZ2VTY2FsZSwKICAgICAgcHJv
ZHVjdEltYWdlWDogZGVmYXVsdHMucHJvZHVjdEltYWdlWCwKICAgICAgcHJvZHVjdEltYWdlWTogZGVmYXVsdHMucHJvZHVjdEltYWdlWSwKICAgICAgbWVu
dUNhdGVnb3JpZXM6IGRlZmF1bHRzLm1lbnVDYXRlZ29yaWVzLAogICAgICBtZW51SXRlbXNQZXJQYWdlOiBkZWZhdWx0cy5tZW51SXRlbXNQZXJQYWdlLAog
ICAgICBtZW51UGFnZVNlY29uZHM6IGRlZmF1bHRzLm1lbnVQYWdlU2Vjb25kcywKICAgICAgbWVudUNvbHVtbnM6IGRlZmF1bHRzLm1lbnVDb2x1bW5zLAog
ICAgICBtZW51U2hvd0Rlc2NyaXB0aW9uczogZGVmYXVsdHMubWVudVNob3dEZXNjcmlwdGlvbnMsCiAgICAgIG1lbnVTaG93SW1hZ2VzOiBkZWZhdWx0cy5t
ZW51U2hvd0ltYWdlcywKICAgICAgbWVudUltYWdlU2l6ZTogZGVmYXVsdHMubWVudUltYWdlU2l6ZSwKICAgIH0pOwogIH07CgogIGNvbnN0IHNldFByb2R1
Y3RJZHMgPSAoaWRzOiBzdHJpbmdbXSkgPT4gewogICAgY29uc3QgY2xlYW4gPSBBcnJheS5mcm9tKG5ldyBTZXQoaWRzLm1hcChTdHJpbmcpLmZpbHRlcihC
b29sZWFuKSkpLnNsaWNlKDAsIDUwKTsKICAgIHVwZGF0ZVNjZW5lKHsgcHJvZHVjdElkczogY2xlYW4sIHByb2R1Y3RJZDogY2xlYW5bMF0gfHwgdW5kZWZp
bmVkIH0pOwogIH07CgogIGNvbnN0IGFkZFByb2R1Y3RUb1NjZW5lID0gKHByb2R1Y3RJZDogc3RyaW5nKSA9PiB7CiAgICBpZiAoIXByb2R1Y3RJZCB8fCAh
c2VsZWN0ZWQpIHJldHVybjsKICAgIGNvbnN0IGlkcyA9IEFycmF5LmlzQXJyYXkoc2VsZWN0ZWQucHJvZHVjdElkcykKICAgICAgPyBzZWxlY3RlZC5wcm9k
dWN0SWRzCiAgICAgIDogc2VsZWN0ZWQucHJvZHVjdElkCiAgICAgICAgPyBbc2VsZWN0ZWQucHJvZHVjdElkXQogICAgICAgIDogW107CiAgICBpZiAoaWRz
LmluY2x1ZGVzKHByb2R1Y3RJZCkpIHJldHVybjsKICAgIHNldFByb2R1Y3RJZHMoWy4uLmlkcywgcHJvZHVjdElkXSk7CiAgfTsKCiAgY29uc3QgcmVtb3Zl
UHJvZHVjdEZyb21TY2VuZSA9IChwcm9kdWN0SWQ6IHN0cmluZykgPT4gewogICAgaWYgKCFzZWxlY3RlZCkgcmV0dXJuOwogICAgY29uc3QgaWRzID0gQXJy
YXkuaXNBcnJheShzZWxlY3RlZC5wcm9kdWN0SWRzKQogICAgICA/IHNlbGVjdGVkLnByb2R1Y3RJZHMKICAgICAgOiBzZWxlY3RlZC5wcm9kdWN0SWQKICAg
ICAgICA/IFtzZWxlY3RlZC5wcm9kdWN0SWRdCiAgICAgICAgOiBbXTsKICAgIHNldFByb2R1Y3RJZHMoaWRzLmZpbHRlcigoaWQpID0+IGlkICE9PSBwcm9k
dWN0SWQpKTsKICB9OwoKICBjb25zdCBtb3ZlUHJvZHVjdEluU2NlbmUgPSAocHJvZHVjdElkOiBzdHJpbmcsIGRpcmVjdGlvbjogLTEgfCAxKSA9PiB7CiAg
ICBpZiAoIXNlbGVjdGVkKSByZXR1cm47CiAgICBjb25zdCBpZHMgPSBBcnJheS5pc0FycmF5KHNlbGVjdGVkLnByb2R1Y3RJZHMpCiAgICAgID8gWy4uLnNl
bGVjdGVkLnByb2R1Y3RJZHNdCiAgICAgIDogc2VsZWN0ZWQucHJvZHVjdElkCiAgICAgICAgPyBbc2VsZWN0ZWQucHJvZHVjdElkXQogICAgICAgIDogW107
CiAgICBjb25zdCBpbmRleCA9IGlkcy5pbmRleE9mKHByb2R1Y3RJZCk7CiAgICBjb25zdCB0YXJnZXQgPSBpbmRleCArIGRpcmVjdGlvbjsKICAgIGlmIChp
bmRleCA8IDAgfHwgdGFyZ2V0IDwgMCB8fCB0YXJnZXQgPj0gaWRzLmxlbmd0aCkgcmV0dXJuOwogICAgW2lkc1tpbmRleF0sIGlkc1t0YXJnZXRdXSA9IFtp
ZHNbdGFyZ2V0XSwgaWRzW2luZGV4XV07CiAgICBzZXRQcm9kdWN0SWRzKGlkcyk7CiAgfTsKCiAgY29uc3QgdG9nZ2xlTWVudUNhdGVnb3J5ID0gKGNhdGVn
b3J5OiBzdHJpbmcpID0+IHsKICAgIGlmICghc2VsZWN0ZWQpIHJldHVybjsKICAgIGNvbnN0IGN1cnJlbnQgPSBBcnJheS5pc0FycmF5KHNlbGVjdGVkLm1l
bnVDYXRlZ29yaWVzKSA/IHNlbGVjdGVkLm1lbnVDYXRlZ29yaWVzIDogW107CiAgICB1cGRhdGVTY2VuZSh7CiAgICAgIG1lbnVDYXRlZ29yaWVzOiBjdXJy
ZW50LmluY2x1ZGVzKGNhdGVnb3J5KQogICAgICAgID8gY3VycmVudC5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0gIT09IGNhdGVnb3J5KQogICAgICAgIDogWy4u
LmN1cnJlbnQsIGNhdGVnb3J5XSwKICAgIH0pOwogIH07CgogIGNvbnN0IHNldE9ubHlNZW51Q2F0ZWdvcnkgPSAoY2F0ZWdvcnk6IHN0cmluZykgPT4gewog
ICAgdXBkYXRlU2NlbmUoeyBtZW51Q2F0ZWdvcmllczogW2NhdGVnb3J5XSB9KTsKICAgIHNldE1lc3NhZ2UoYERpaml0YWwgbWVuw7wgeWFsbsSxemNhIOKA
nCR7c2hvd2Nhc2VDYXRlZ29yeUxhYmVsKGNhdGVnb3J5LCAidHIiKX3igJ0gZ3J1YnVudSBnw7ZzdGVyZWNlay5gKTsKICB9OwoKICBjb25zdCBjbGVhck1l
bnVDYXRlZ29yaWVzID0gKCkgPT4gewogICAgdXBkYXRlU2NlbmUoeyBtZW51Q2F0ZWdvcmllczogW10gfSk7CiAgICBzZXRNZXNzYWdlKCJEaWppdGFsIG1l
bsO8IGdydXAgc2XDp2ltaSB0ZW1pemxlbmRpLiIpOwogIH07CgogIGNvbnN0IGFkZFNjZW5lID0gKHR5cGU6IFNob3djYXNlU2NlbmVUeXBlKSA9PiB7CiAg
ICBpZiAoIWRyYWZ0KSByZXR1cm47CiAgICBjb25zdCBzY2VuZSA9IG5ld1NjZW5lKHR5cGUsIGRyYWZ0KTsKICAgIHNldERyYWZ0KHsgLi4uZHJhZnQsIHNj
ZW5lczogWy4uLmRyYWZ0LnNjZW5lcywgc2NlbmVdLCB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KTsKICAgIHNldFNlbGVjdGVkSWQo
c2NlbmUuaWQpOwogIH07CgogIGNvbnN0IGRlbGV0ZVNjZW5lID0gKCkgPT4gewogICAgaWYgKCFkcmFmdCB8fCAhc2VsZWN0ZWQpIHJldHVybjsKICAgIGlm
IChkcmFmdC5zY2VuZXMubGVuZ3RoIDw9IDEpIHsKICAgICAgc2V0RXJyb3IoIkVuIGF6IGJpciBzYWhuZSBrYWxtYWzEsWTEsXIuIik7CiAgICAgIHJldHVy
bjsKICAgIH0KICAgIGlmICghd2luZG93LmNvbmZpcm0oYOKAnCR7c2VsZWN0ZWQubmFtZX3igJ0gZ2Vyw6dla3RlbiBzaWxpbnNpbiBtaT9gKSkgcmV0dXJu
OwogICAgY29uc3QgbmV4dCA9IGRyYWZ0LnNjZW5lcy5maWx0ZXIoKHNjZW5lKSA9PiBzY2VuZS5pZCAhPT0gc2VsZWN0ZWQuaWQpOwogICAgc2V0RHJhZnQo
eyAuLi5kcmFmdCwgc2NlbmVzOiBuZXh0LCB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KTsKICAgIHNldFNlbGVjdGVkSWQobmV4dFtN
YXRoLm1heCgwLCBzZWxlY3RlZEluZGV4IC0gMSldPy5pZCB8fCBuZXh0WzBdPy5pZCB8fCAiIik7CiAgfTsKCiAgY29uc3QgZHVwbGljYXRlU2NlbmUgPSAo
KSA9PiB7CiAgICBpZiAoIWRyYWZ0IHx8ICFzZWxlY3RlZCkgcmV0dXJuOwogICAgY29uc3QgY29weSA9IHsgLi4uc2VsZWN0ZWQsIGlkOiB1aWQoKSwgbmFt
ZTogYCR7c2VsZWN0ZWQubmFtZX0gS29weWFzxLFgIH07CiAgICBjb25zdCBuZXh0ID0gWy4uLmRyYWZ0LnNjZW5lc107CiAgICBuZXh0LnNwbGljZShzZWxl
Y3RlZEluZGV4ICsgMSwgMCwgY29weSk7CiAgICBzZXREcmFmdCh7IC4uLmRyYWZ0LCBzY2VuZXM6IG5leHQsIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lT
T1N0cmluZygpIH0pOwogICAgc2V0U2VsZWN0ZWRJZChjb3B5LmlkKTsKICB9OwoKICBjb25zdCBtb3ZlU2NlbmUgPSAoZGlyZWN0aW9uOiAtMSB8IDEpID0+
IHsKICAgIGlmICghZHJhZnQgfHwgc2VsZWN0ZWRJbmRleCA8IDApIHJldHVybjsKICAgIGNvbnN0IHRhcmdldCA9IHNlbGVjdGVkSW5kZXggKyBkaXJlY3Rp
b247CiAgICBpZiAodGFyZ2V0IDwgMCB8fCB0YXJnZXQgPj0gZHJhZnQuc2NlbmVzLmxlbmd0aCkgcmV0dXJuOwogICAgY29uc3QgbmV4dCA9IFsuLi5kcmFm
dC5zY2VuZXNdOwogICAgW25leHRbc2VsZWN0ZWRJbmRleF0sIG5leHRbdGFyZ2V0XV0gPSBbbmV4dFt0YXJnZXRdLCBuZXh0W3NlbGVjdGVkSW5kZXhdXTsK
ICAgIHNldERyYWZ0KHsgLi4uZHJhZnQsIHNjZW5lczogbmV4dCwgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSk7CiAgfTsKCiAgY29u
c3QgdmFsaWRhdGVEcmFmdCA9IChkb2N1bWVudDogU2hvd2Nhc2VEb2N1bWVudCkgPT4gewogICAgY29uc3QgZW1wdHlNZW51ID0gZG9jdW1lbnQuc2NlbmVz
LmZpbmQoCiAgICAgIChzY2VuZSkgPT4gc2NlbmUuZW5hYmxlZCAmJiBzY2VuZS50eXBlID09PSAibWVudSIgJiYgIShzY2VuZS5tZW51Q2F0ZWdvcmllcyB8
fCBbXSkubGVuZ3RoLAogICAgKTsKICAgIGlmIChlbXB0eU1lbnUpIHsKICAgICAgc2V0U2VsZWN0ZWRJZChlbXB0eU1lbnUuaWQpOwogICAgICBzZXRFcnJv
cihg4oCcJHtlbXB0eU1lbnUubmFtZX3igJ0gc2FobmVzaW5kZSBlbiBheiBiaXIgZGlqaXRhbCBtZW7DvCBncnVidSBzZcOnbWVsaXNpbi5gKTsKICAgICAg
cmV0dXJuIGZhbHNlOwogICAgfQogICAgcmV0dXJuIHRydWU7CiAgfTsKCiAgY29uc3Qgc2F2ZURyYWZ0ID0gYXN5bmMgKCkgPT4gewogICAgaWYgKCFkcmFm
dCB8fCAhdmFsaWRhdGVEcmFmdChkcmFmdCkpIHJldHVybjsKICAgIHNldEJ1c3kodHJ1ZSk7CiAgICBzZXRFcnJvcigiIik7CiAgICBzZXRNZXNzYWdlKCIi
KTsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQganNvbkZldGNoKCIvYXBpL2FkbWluL3Nob3djYXNlIiwgewogICAgICAgIG1ldGhv
ZDogIlBVVCIsCiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkb2N1bWVudDogZHJhZnQgfSksCiAgICAgIH0pOwogICAgICBzZXREcmFmdChyZXNw
b25zZS5kcmFmdCk7CiAgICAgIHNldE1lc3NhZ2UoIlRhc2xhayBrYXlkZWRpbGRpLiBUViBla3JhbsSxbmRha2kgeWF5xLFuIGhlbsO8eiBkZcSfacWfdGly
aWxtZWRpLiIpOwogICAgfSBjYXRjaCAoc2F2ZUVycm9yOiBhbnkpIHsKICAgICAgc2V0RXJyb3Ioc2F2ZUVycm9yPy5tZXNzYWdlIHx8ICJUYXNsYWsga2F5
ZGVkaWxlbWVkaS4iKTsKICAgIH0gZmluYWxseSB7CiAgICAgIHNldEJ1c3koZmFsc2UpOwogICAgfQogIH07CgogIGNvbnN0IHB1Ymxpc2ggPSBhc3luYyAo
KSA9PiB7CiAgICBpZiAoIWRyYWZ0IHx8ICF2YWxpZGF0ZURyYWZ0KGRyYWZ0KSkgcmV0dXJuOwogICAgaWYgKCF3aW5kb3cuY29uZmlybSgiQnUgc8O8csO8
bSDFn2ltZGkgVFYgdml0cmluIGVrcmFuxLFuZGEgeWF5xLFubGFuc8SxbiBtxLE/IikpIHJldHVybjsKICAgIHNldEJ1c3kodHJ1ZSk7CiAgICBzZXRFcnJv
cigiIik7CiAgICBzZXRNZXNzYWdlKCIiKTsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQganNvbkZldGNoKCIvYXBpL2FkbWluL3No
b3djYXNlIiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgYWN0aW9uOiAicHVibGlzaCIsIGRvY3Vt
ZW50OiBkcmFmdCB9KSwKICAgICAgfSk7CiAgICAgIHNldERyYWZ0KHJlc3BvbnNlLmRyYWZ0KTsKICAgICAgc2V0RGF0YSgoY3VycmVudCkgPT4gKGN1cnJl
bnQgPyB7IC4uLmN1cnJlbnQsIGRyYWZ0OiByZXNwb25zZS5kcmFmdCwgcHVibGlzaGVkOiByZXNwb25zZS5wdWJsaXNoZWQgfSA6IGN1cnJlbnQpKTsKICAg
ICAgc2lnbmFsU2hvd2Nhc2VQdWJsaXNoZWQocmVzcG9uc2UucHVibGlzaGVkPy52ZXJzaW9uKTsKICAgICAgc2V0TWVzc2FnZSgiWWF5xLFubGFuZMSxLiBB
w6fEsWsgU2hvd2Nhc2UgZWtyYW5sYXLEsSAy4oCTNSBzYW5peWUgacOnaW5kZSB5ZW5pbGVubWVkZW4gZ8O8bmNlbGxlbmVjZWsuIik7CiAgICB9IGNhdGNo
IChwdWJsaXNoRXJyb3I6IGFueSkgewogICAgICBzZXRFcnJvcihwdWJsaXNoRXJyb3I/Lm1lc3NhZ2UgfHwgIllhecSxbmxhbWEgYmHFn2FyxLFzxLF6IG9s
ZHUuIik7CiAgICB9IGZpbmFsbHkgewogICAgICBzZXRCdXN5KGZhbHNlKTsKICAgIH0KICB9OwoKICBjb25zdCByZXN0b3JlUHVibGlzaGVkID0gYXN5bmMg
KCkgPT4gewogICAgaWYgKCF3aW5kb3cuY29uZmlybSgiVGFzbGFrIHNpbGluaXAgc29uIHlhecSxbmxhbmFuIHPDvHLDvG0gecO8a2xlbnNpbiBtaT8iKSkg
cmV0dXJuOwogICAgc2V0QnVzeSh0cnVlKTsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQganNvbkZldGNoKCIvYXBpL2FkbWluL3No
b3djYXNlIiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgYWN0aW9uOiAicmVzdG9yZVB1Ymxpc2hl
ZCIgfSksCiAgICAgIH0pOwogICAgICBzZXREcmFmdChyZXNwb25zZS5kcmFmdCk7CiAgICAgIHNldFNlbGVjdGVkSWQocmVzcG9uc2UuZHJhZnQuc2NlbmVz
WzBdPy5pZCB8fCAiIik7CiAgICAgIHNldE1lc3NhZ2UoIlNvbiB5YXnEsW5sYW5hbiBzw7xyw7xtIHRhc2xhayBvbGFyYWsgecO8a2xlbmRpLiIpOwogICAg
fSBjYXRjaCAocmVzdG9yZUVycm9yOiBhbnkpIHsKICAgICAgc2V0RXJyb3IocmVzdG9yZUVycm9yPy5tZXNzYWdlIHx8ICJHZXJpIHnDvGtsZW1lIGJhxZ9h
csSxc8SxeiBvbGR1LiIpOwogICAgfSBmaW5hbGx5IHsKICAgICAgc2V0QnVzeShmYWxzZSk7CiAgICB9CiAgfTsKCiAgY29uc3QgdXBsb2FkTWVkaWEgPSBh
c3luYyAoZmlsZTogRmlsZSkgPT4gewogICAgY29uc3QgY3VycmVudFNjZW5lID0gc2VsZWN0ZWQ7CiAgICBpZiAoIWN1cnJlbnRTY2VuZSkgcmV0dXJuOwog
ICAgaWYgKCFkYXRhPy5zdG9yYWdlPy5jb25maWd1cmVkKSB7CiAgICAgIHNldEVycm9yKCJDbG91ZGluYXJ5IGhlbsO8eiBWZXJjZWwgw7x6ZXJpbmRlIGF5
YXJsYW5tYWTEsS4iKTsKICAgICAgcmV0dXJuOwogICAgfQogICAgaWYgKGZpbGUuc2l6ZSA+IGRhdGEuc3RvcmFnZS5tYXhVcGxvYWRCeXRlcykgewogICAg
ICBzZXRFcnJvcihgRG9zeWEgw6dvayBiw7x5w7xrLiBFbiBmYXpsYSAke2Zvcm1hdEJ5dGVzKGRhdGEuc3RvcmFnZS5tYXhVcGxvYWRCeXRlcyl9IHnDvGts
ZXllYmlsaXJzaW4uYCk7CiAgICAgIHJldHVybjsKICAgIH0KICAgIHNldFVwbG9hZFByb2dyZXNzKDApOwogICAgc2V0RXJyb3IoIiIpOwogICAgc2V0TWVz
c2FnZSgiIik7CgogICAgdHJ5IHsKICAgICAgY29uc3Qgc2lnbmVkID0gYXdhaXQganNvbkZldGNoKCIvYXBpL2FkbWluL3Nob3djYXNlL21lZGlhIiwgewog
ICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsKICAgICAgICAgIGFjdGlvbjogInNpZ24iLAogICAgICAgICAg
bmFtZTogZmlsZS5uYW1lLAogICAgICAgICAgbWltZVR5cGU6IGZpbGUudHlwZSwKICAgICAgICAgIHNpemU6IGZpbGUuc2l6ZSwKICAgICAgICB9KSwKICAg
ICAgfSk7CiAgICAgIGNvbnN0IHVwbG9hZCA9IGF3YWl0IHVwbG9hZENsb3VkaW5hcnlXaXRoUHJvZ3Jlc3MoCiAgICAgICAgc2lnbmVkLnVwbG9hZFVybCwK
ICAgICAgICBzaWduZWQuZmllbGRzLAogICAgICAgIGZpbGUsCiAgICAgICAgc2V0VXBsb2FkUHJvZ3Jlc3MsCiAgICAgICk7CiAgICAgIGNvbnN0IG1ldGFk
YXRhID0gYXdhaXQgaW5zcGVjdEZpbGUoZmlsZSk7CiAgICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSBhd2FpdCBqc29uRmV0Y2goIi9hcGkvYWRtaW4vc2hvd2Nh
c2UvbWVkaWEiLCB7CiAgICAgICAgbWV0aG9kOiAiUE9TVCIsCiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoewogICAgICAgICAgYWN0aW9uOiAicmVn
aXN0ZXIiLAogICAgICAgICAgbmFtZTogZmlsZS5uYW1lLAogICAgICAgICAgbWltZVR5cGU6IGZpbGUudHlwZSwKICAgICAgICAgIHNpemU6IGZpbGUuc2l6
ZSwKICAgICAgICAgIHVwbG9hZCwKICAgICAgICAgIC4uLm1ldGFkYXRhLAogICAgICAgIH0pLAogICAgICB9KTsKICAgICAgc2V0RGF0YSgoY3VycmVudCkg
PT4gKGN1cnJlbnQgPyB7IC4uLmN1cnJlbnQsIG1lZGlhOiByZWdpc3RlcmVkLm1lZGlhIH0gOiBjdXJyZW50KSk7CiAgICAgIHVwZGF0ZVNjZW5lKHsKICAg
ICAgICBtZWRpYVVybDogcmVnaXN0ZXJlZC5pdGVtLnVybCwKICAgICAgICBkdXJhdGlvblNlY29uZHM6IG1ldGFkYXRhLmR1cmF0aW9uU2Vjb25kcwogICAg
ICAgICAgPyBNYXRoLm1heCg1LCBNYXRoLmNlaWwobWV0YWRhdGEuZHVyYXRpb25TZWNvbmRzKSkKICAgICAgICAgIDogY3VycmVudFNjZW5lLmR1cmF0aW9u
U2Vjb25kcywKICAgICAgfSk7CiAgICAgIHNldE1lc3NhZ2UoYCR7ZmlsZS5uYW1lfSB5w7xrbGVuZGkgdmUgc2XDp2lsaSBzYWhuZXllIGF0YW5kxLEuYCk7
CiAgICB9IGNhdGNoICh1cGxvYWRFcnJvcjogYW55KSB7CiAgICAgIHNldEVycm9yKAogICAgICAgIHVwbG9hZEVycm9yPy5tZXNzYWdlID09PSAiQ0xPVURJ
TkFSWV9VUExPQURfTkVUV09SS19FUlJPUiIKICAgICAgICAgID8gIlnDvGtsZW1lIGJhxZ9hcsSxc8SxeiBvbGR1LiDEsG50ZXJuZXQgYmHEn2xhbnTEsXPE
sW7EsSBrb250cm9sIGVkaXAgeWVuaWRlbiBkZW5lLiIKICAgICAgICAgIDogdXBsb2FkRXJyb3I/Lm1lc3NhZ2UgfHwgIlnDvGtsZW1lIGJhxZ9hcsSxc8Sx
eiBvbGR1LiIsCiAgICAgICk7CiAgICB9IGZpbmFsbHkgewogICAgICBzZXRVcGxvYWRQcm9ncmVzcyhudWxsKTsKICAgICAgaWYgKGZpbGVSZWYuY3VycmVu
dCkgZmlsZVJlZi5jdXJyZW50LnZhbHVlID0gIiI7CiAgICB9CiAgfTsKCiAgY29uc3QgZGVsZXRlTWVkaWEgPSBhc3luYyAoaXRlbTogU2hvd2Nhc2VNZWRp
YUl0ZW0pID0+IHsKICAgIGlmICghd2luZG93LmNvbmZpcm0oYCR7aXRlbS5uYW1lfSBDbG91ZGluYXJ5IMO8emVyaW5kZW4ga2FsxLFjxLEgb2xhcmFrIHNp
bGluc2luIG1pP2ApKSByZXR1cm47CiAgICB0cnkgewogICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGpzb25GZXRjaCgiL2FwaS9hZG1pbi9zaG93Y2Fz
ZS9tZWRpYSIsIHsKICAgICAgICBtZXRob2Q6ICJERUxFVEUiLAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgaWQ6IGl0ZW0uaWQgfSksCiAgICAg
IH0pOwogICAgICBzZXREYXRhKChjdXJyZW50KSA9PiAoY3VycmVudCA/IHsgLi4uY3VycmVudCwgbWVkaWE6IHJlc3BvbnNlLm1lZGlhIH0gOiBjdXJyZW50
KSk7CiAgICAgIHNldE1lc3NhZ2UoIk1lZHlhIGRvc3lhc8SxIHNpbGluZGkuIik7CiAgICB9IGNhdGNoIChkZWxldGVFcnJvcjogYW55KSB7CiAgICAgIHNl
dEVycm9yKAogICAgICAgIGRlbGV0ZUVycm9yPy5tZXNzYWdlID09PSAiTUVESUFfSVNfSU5fVVNFIgogICAgICAgICAgPyAiQnUgZG9zeWEgYmlyIHRhc2xh
a3RhIHZleWEgeWF5xLFubGFuYW4gc8O8csO8bWRlIGjDomzDoiBrdWxsYW7EsWzEsXlvci4gw5ZuY2UgaWxnaWxpIHNhaG5lbGVyZGVuIGthbGTEsXIuIgog
ICAgICAgICAgOiBkZWxldGVFcnJvcj8ubWVzc2FnZSB8fCAiRG9zeWEgc2lsaW5lbWVkaS4iLAogICAgICApOwogICAgfQogIH07CgogIGlmICghZHJhZnQg
fHwgIWRhdGEgfHwgIXNlbGVjdGVkIHx8ICFwcmV2aWV3U25hcHNob3QpIHsKICAgIHJldHVybiAoCiAgICAgIDxkaXYgY2xhc3NOYW1lPSJncmlkIG1pbi1o
LVs1NXZoXSBwbGFjZS1pdGVtcy1jZW50ZXIiPgogICAgICAgIDxkaXYgY2xhc3NOYW1lPSJ0ZXh0LWNlbnRlciI+CiAgICAgICAgICA8ZGl2IGNsYXNzTmFt
ZT0ibXgtYXV0byBoLTEwIHctMTAgYW5pbWF0ZS1zcGluIHJvdW5kZWQtZnVsbCBib3JkZXItNCBib3JkZXItc3RvbmUtNzAwIGJvcmRlci10LW9yYW5nZS00
MDAiIC8+CiAgICAgICAgICA8cCBjbGFzc05hbWU9Im10LTQgdGV4dC1zdG9uZS00MDAiPlZpdHJpbiBla3JhbsSxIHnDvGtsZW5peW9y4oCmPC9wPgogICAg
ICAgICAge2Vycm9yID8gPHAgY2xhc3NOYW1lPSJtdC0zIHRleHQtcmVkLTQwMCI+e2Vycm9yfTwvcD4gOiBudWxsfQogICAgICAgIDwvZGl2PgogICAgICA8
L2Rpdj4KICAgICk7CiAgfQoKICBjb25zdCBzZWxlY3RlZFByb2R1Y3QgPSBzZWxlY3RlZFByb2R1Y3RzWzBdIHx8IG51bGw7CiAgY29uc3Qgc2VsZWN0ZWRT
Y2VuZUR1cmF0aW9uID0gZWZmZWN0aXZlU2hvd2Nhc2VTY2VuZUR1cmF0aW9uKHNlbGVjdGVkLCBwcmV2aWV3U25hcHNob3QpOwoKICByZXR1cm4gKAogICAg
PGRpdiBjbGFzc05hbWU9Im14LWF1dG8gbWF4LXctWzE5MDBweF0gc3BhY2UteS01Ij4KICAgICAgPGhlYWRlciBjbGFzc05hbWU9ImZsZXggZmxleC13cmFw
IGl0ZW1zLWNlbnRlciBnYXAtMyByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05MDAvNjAgcC00IHNoYWRvdy14bCI+CiAg
ICAgICAgPGRpdj4KICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJ0ZXh0LXhzIGZvbnQtYm9sZCB1cHBlcmNhc2UgdHJhY2tpbmctWy4yZW1dIHRleHQtb3Jh
bmdlLTQwMCI+RGlqaXRhbCBWaXRyaW48L2Rpdj4KICAgICAgICAgIDxoMSBjbGFzc05hbWU9Im10LTEgdGV4dC0yeGwgZm9udC1ibGFjayB0ZXh0LXdoaXRl
Ij5WaXRyaW4gWcO2bmV0aW1pPC9oMT4KICAgICAgICAgIDxwIGNsYXNzTmFtZT0idGV4dC1zbSB0ZXh0LXN0b25lLTQwMCI+U2FobmVsZXJpIGhhesSxcmxh
LCBjYW5sxLEgw7ZuaXpsZSB2ZSBrb250cm9sIGV0dGlrdGVuIHNvbnJhIHlhecSxbmxhLjwvcD4KICAgICAgICA8L2Rpdj4KICAgICAgICA8ZGl2IGNsYXNz
TmFtZT0ibWwtYXV0byBmbGV4IGZsZXgtd3JhcCBnYXAtMiI+CiAgICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHZvaWQgcmVm
cmVzaExpdmVTb3VyY2VzKCl9CiAgICAgICAgICAgIGRpc2FibGVkPXtidXN5fQogICAgICAgICAgICBjbGFzc05hbWU9InJvdW5kZWQteGwgYm9yZGVyIGJv
cmRlci1za3ktNTAwLzQwIGJnLXNreS01MDAvMTAgcHgtNCBweS0yLjUgdGV4dC1zbSBmb250LXNlbWlib2xkIHRleHQtc2t5LTEwMCBob3ZlcjpiZy1za3kt
NTAwLzIwIGRpc2FibGVkOm9wYWNpdHktNTAiCiAgICAgICAgICA+CiAgICAgICAgICAgIFNpdGUgdmVyaWxlcmluaSB5ZW5pbGUKICAgICAgICAgIDwvYnV0
dG9uPgogICAgICAgICAgPGEKICAgICAgICAgICAgaHJlZj0iL3Nob3djYXNlIgogICAgICAgICAgICB0YXJnZXQ9Il9ibGFuayIKICAgICAgICAgICAgcmVs
PSJub3JlZmVycmVyIgogICAgICAgICAgICBjbGFzc05hbWU9InJvdW5kZWQteGwgYm9yZGVyIGJvcmRlci1zdG9uZS03MDAgYmctc3RvbmUtOTUwIHB4LTQg
cHktMi41IHRleHQtc20gZm9udC1zZW1pYm9sZCBob3Zlcjpib3JkZXItc3RvbmUtNTAwIgogICAgICAgICAgPgogICAgICAgICAgICBUViBla3JhbsSxbsSx
IGHDpyDihpcKICAgICAgICAgIDwvYT4KICAgICAgICAgIDxidXR0b24gb25DbGljaz17cmVzdG9yZVB1Ymxpc2hlZH0gZGlzYWJsZWQ9e2J1c3l9IGNsYXNz
TmFtZT0icm91bmRlZC14bCBib3JkZXIgYm9yZGVyLXN0b25lLTcwMCBweC00IHB5LTIuNSB0ZXh0LXNtIGZvbnQtc2VtaWJvbGQgaG92ZXI6Ymctc3RvbmUt
ODAwIGRpc2FibGVkOm9wYWNpdHktNTAiPgogICAgICAgICAgICBTb24geWF5xLFubGFuYW7EsSB5w7xrbGUKICAgICAgICAgIDwvYnV0dG9uPgogICAgICAg
ICAgPGJ1dHRvbiBvbkNsaWNrPXtzYXZlRHJhZnR9IGRpc2FibGVkPXtidXN5fSBjbGFzc05hbWU9InJvdW5kZWQteGwgYm9yZGVyIGJvcmRlci1vcmFuZ2Ut
NTAwLzUwIGJnLW9yYW5nZS01MDAvMTAgcHgtNCBweS0yLjUgdGV4dC1zbSBmb250LWJvbGQgdGV4dC1vcmFuZ2UtMjAwIGhvdmVyOmJnLW9yYW5nZS01MDAv
MjAgZGlzYWJsZWQ6b3BhY2l0eS01MCI+CiAgICAgICAgICAgIFRhc2xhxJ/EsSBrYXlkZXQKICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgPGJ1dHRv
biBvbkNsaWNrPXtwdWJsaXNofSBkaXNhYmxlZD17YnVzeX0gY2xhc3NOYW1lPSJyb3VuZGVkLXhsIGJnLW9yYW5nZS01MDAgcHgtNSBweS0yLjUgdGV4dC1z
bSBmb250LWJsYWNrIHRleHQtYmxhY2sgc2hhZG93LWxnIHNoYWRvdy1vcmFuZ2UtNTAwLzIwIGhvdmVyOmJnLW9yYW5nZS00MDAgZGlzYWJsZWQ6b3BhY2l0
eS01MCI+CiAgICAgICAgICAgIFlhecSxbmxhCiAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9oZWFkZXI+CgogICAgICB7bWVz
c2FnZSA/IDxkaXYgY2xhc3NOYW1lPSJyb3VuZGVkLXhsIGJvcmRlciBib3JkZXItZW1lcmFsZC03MDAvNTAgYmctZW1lcmFsZC05NTAvNDAgcHgtNCBweS0z
IHRleHQtc20gdGV4dC1lbWVyYWxkLTIwMCI+e21lc3NhZ2V9PC9kaXY+IDogbnVsbH0KICAgICAge2Vycm9yID8gPGRpdiBjbGFzc05hbWU9InJvdW5kZWQt
eGwgYm9yZGVyIGJvcmRlci1yZWQtNzAwLzUwIGJnLXJlZC05NTAvNDAgcHgtNCBweS0zIHRleHQtc20gdGV4dC1yZWQtMjAwIj57ZXJyb3J9PC9kaXY+IDog
bnVsbH0KCiAgICAgIDxkaXYgY2xhc3NOYW1lPSJncmlkIGdhcC01IHhsOmdyaWQtY29scy1bMzMwcHhfbWlubWF4KDAsMWZyKV9taW5tYXgoNTIwcHgsMS4x
NWZyKV0iPgogICAgICAgIDxhc2lkZSBjbGFzc05hbWU9InNwYWNlLXktNCByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05
MDAvNTUgcC00Ij4KICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5LWJldHdlZW4iPgogICAgICAgICAgICA8ZGl2
PgogICAgICAgICAgICAgIDxoMiBjbGFzc05hbWU9ImZvbnQtYmxhY2siPlNhaG5lbGVyPC9oMj4KICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9InRleHQt
eHMgdGV4dC1zdG9uZS01MDAiPntkcmFmdC5zY2VuZXMubGVuZ3RofSBzYWhuZTwvcD4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxsYWJlbCBj
bGFzc05hbWU9ImZsZXggaXRlbXMtY2VudGVyIGdhcC0yIHRleHQteHMgdGV4dC1zdG9uZS00MDAiPgogICAgICAgICAgICAgIEFrdGlmCiAgICAgICAgICAg
ICAgPGlucHV0IHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPXtkcmFmdC5lbmFibGVkfSBvbkNoYW5nZT17KGV2ZW50KSA9PiB1cGRhdGVEb2N1bWVudCh7IGVu
YWJsZWQ6IGV2ZW50LnRhcmdldC5jaGVja2VkIH0pfSAvPgogICAgICAgICAgICA8L2xhYmVsPgogICAgICAgICAgPC9kaXY+CgogICAgICAgICAgPGRpdiBj
bGFzc05hbWU9ImdyaWQgZ3JpZC1jb2xzLTQgZ2FwLTEuNSI+CiAgICAgICAgICAgIHsoT2JqZWN0LmtleXMoVFlQRV9MQUJFTFMpIGFzIFNob3djYXNlU2Nl
bmVUeXBlW10pLm1hcCgodHlwZSkgPT4gKAogICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgIGtleT17dHlwZX0KICAgICAgICAgICAgICAg
IG9uQ2xpY2s9eygpID0+IGFkZFNjZW5lKHR5cGUpfQogICAgICAgICAgICAgICAgdGl0bGU9e2Ake1RZUEVfTEFCRUxTW3R5cGVdfSBla2xlYH0KICAgICAg
ICAgICAgICAgIGNsYXNzTmFtZT0icm91bmRlZC14bCBib3JkZXIgYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05NTAgcHgtMiBweS0yIHRleHQtbGcgaG92
ZXI6Ym9yZGVyLW9yYW5nZS01MDAvNjAgaG92ZXI6Ymctc3RvbmUtOTAwIgogICAgICAgICAgICAgID4KICAgICAgICAgICAgICAgIHtUWVBFX0lDT05TW3R5
cGVdfQogICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICApKX0KICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJt
YXgtaC1bNjkwcHhdIHNwYWNlLXktMiBvdmVyZmxvdy15LWF1dG8gcHItMSI+CiAgICAgICAgICAgIHtkcmFmdC5zY2VuZXMubWFwKChzY2VuZSwgaW5kZXgp
ID0+ICgKICAgICAgICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgICAgICBrZXk9e3NjZW5lLmlkfQogICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4g
c2V0U2VsZWN0ZWRJZChzY2VuZS5pZCl9CiAgICAgICAgICAgICAgICBjbGFzc05hbWU9e1sKICAgICAgICAgICAgICAgICAgInctZnVsbCByb3VuZGVkLXhs
IGJvcmRlciBwLTMgdGV4dC1sZWZ0IHRyYW5zaXRpb24iLAogICAgICAgICAgICAgICAgICBzY2VuZS5pZCA9PT0gc2VsZWN0ZWQuaWQKICAgICAgICAgICAg
ICAgICAgICA/ICJib3JkZXItb3JhbmdlLTUwMCBiZy1vcmFuZ2UtNTAwLzEwIgogICAgICAgICAgICAgICAgICAgIDogImJvcmRlci1zdG9uZS04MDAgYmct
c3RvbmUtOTUwLzcwIGhvdmVyOmJvcmRlci1zdG9uZS02MDAiLAogICAgICAgICAgICAgICAgXS5qb2luKCIgIil9CiAgICAgICAgICAgICAgPgogICAgICAg
ICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXggaXRlbXMtc3RhcnQgZ2FwLTIiPgogICAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9ImdyaWQg
aC04IHctOCBzaHJpbmstMCBwbGFjZS1pdGVtcy1jZW50ZXIgcm91bmRlZC1sZyBiZy1zdG9uZS04MDAgdGV4dC1iYXNlIj57VFlQRV9JQ09OU1tzY2VuZS50
eXBlXX08L3NwYW4+CiAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0ibWluLXctMCBmbGV4LTEiPgogICAgICAgICAgICAgICAgICAgIDxzcGFu
IGNsYXNzTmFtZT0iYmxvY2sgdHJ1bmNhdGUgdGV4dC1zbSBmb250LWJvbGQiPntpbmRleCArIDF9LiB7c2NlbmUubmFtZX08L3NwYW4+CiAgICAgICAgICAg
ICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJtdC0xIGJsb2NrIHRleHQteHMgdGV4dC1zdG9uZS01MDAiPntUWVBFX0xBQkVMU1tzY2VuZS50eXBlXX0gwrcg
e2VmZmVjdGl2ZVNob3djYXNlU2NlbmVEdXJhdGlvbihzY2VuZSwgcHJldmlld1NuYXBzaG90KX0gc24uPC9zcGFuPgogICAgICAgICAgICAgICAgICA8L3Nw
YW4+CiAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT17YG10LTEgaC0yLjUgdy0yLjUgcm91bmRlZC1mdWxsICR7c2NlbmUuZW5hYmxlZCA/ICJi
Zy1lbWVyYWxkLTQwMCIgOiAiYmctc3RvbmUtNjAwIn1gfSAvPgogICAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgPC9idXR0b24+CiAgICAg
ICAgICAgICkpfQogICAgICAgICAgPC9kaXY+CgogICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImdyaWQgZ3JpZC1jb2xzLTQgZ2FwLTIgYm9yZGVyLXQgYm9y
ZGVyLXN0b25lLTgwMCBwdC0zIj4KICAgICAgICAgICAgPGJ1dHRvbiBvbkNsaWNrPXsoKSA9PiBtb3ZlU2NlbmUoLTEpfSBjbGFzc05hbWU9InJvdW5kZWQt
bGcgYmctc3RvbmUtODAwIHB4LTIgcHktMiB0ZXh0LXNtIGhvdmVyOmJnLXN0b25lLTcwMCI+4oaRPC9idXR0b24+CiAgICAgICAgICAgIDxidXR0b24gb25D
bGljaz17KCkgPT4gbW92ZVNjZW5lKDEpfSBjbGFzc05hbWU9InJvdW5kZWQtbGcgYmctc3RvbmUtODAwIHB4LTIgcHktMiB0ZXh0LXNtIGhvdmVyOmJnLXN0
b25lLTcwMCI+4oaTPC9idXR0b24+CiAgICAgICAgICAgIDxidXR0b24gb25DbGljaz17ZHVwbGljYXRlU2NlbmV9IGNsYXNzTmFtZT0icm91bmRlZC1sZyBi
Zy1zdG9uZS04MDAgcHgtMiBweS0yIHRleHQtc20gaG92ZXI6Ymctc3RvbmUtNzAwIj5Lb3B5YWxhPC9idXR0b24+CiAgICAgICAgICAgIDxidXR0b24gb25D
bGljaz17ZGVsZXRlU2NlbmV9IGNsYXNzTmFtZT0icm91bmRlZC1sZyBiZy1yZWQtOTUwLzcwIHB4LTIgcHktMiB0ZXh0LXNtIHRleHQtcmVkLTMwMCBob3Zl
cjpiZy1yZWQtOTAwIj5TaWw8L2J1dHRvbj4KICAgICAgICAgIDwvZGl2PgogICAgICAgIDwvYXNpZGU+CgogICAgICAgIDxtYWluIGNsYXNzTmFtZT0ic3Bh
Y2UteS00IHJvdW5kZWQtMnhsIGJvcmRlciBib3JkZXItc3RvbmUtODAwIGJnLXN0b25lLTkwMC81NSBwLTQiPgogICAgICAgICAgPGRpdiBjbGFzc05hbWU9
ImZsZXggZmxleC13cmFwIGl0ZW1zLWNlbnRlciBnYXAtMyBib3JkZXItYiBib3JkZXItc3RvbmUtODAwIHBiLTQiPgogICAgICAgICAgICA8ZGl2PgogICAg
ICAgICAgICAgIDxoMiBjbGFzc05hbWU9ImZvbnQtYmxhY2siPlNhaG5leWkgZMO8emVubGU8L2gyPgogICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT0idGV4
dC14cyB0ZXh0LXN0b25lLTUwMCI+e1RZUEVfTEFCRUxTW3NlbGVjdGVkLnR5cGVdfTwvcD4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxsYWJl
bCBjbGFzc05hbWU9Im1sLWF1dG8gZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIgdGV4dC1zbSBmb250LXNlbWlib2xkIj4KICAgICAgICAgICAgICBHw7ZzdGVy
CiAgICAgICAgICAgICAgPGlucHV0IHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPXtzZWxlY3RlZC5lbmFibGVkfSBvbkNoYW5nZT17KGV2ZW50KSA9PiB1cGRh
dGVTY2VuZSh7IGVuYWJsZWQ6IGV2ZW50LnRhcmdldC5jaGVja2VkIH0pfSAvPgogICAgICAgICAgICA8L2xhYmVsPgogICAgICAgICAgPC9kaXY+CgogICAg
ICAgICAgPGRpdiBjbGFzc05hbWU9ImdyaWQgZ2FwLTQgbWQ6Z3JpZC1jb2xzLTIiPgogICAgICAgICAgICA8RmllbGQgbGFiZWw9IkRhaGlsaSBhZCI+PGlu
cHV0IGNsYXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e3NlbGVjdGVkLm5hbWV9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgbmFtZTog
ZXZlbnQudGFyZ2V0LnZhbHVlIH0pfSAvPjwvRmllbGQ+CiAgICAgICAgICAgIDxGaWVsZCBsYWJlbD0iU2FobmUgdMO8csO8Ij4KICAgICAgICAgICAgICA8
c2VsZWN0IGNsYXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e3NlbGVjdGVkLnR5cGV9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IGNoYW5nZVNjZW5lVHlwZShl
dmVudC50YXJnZXQudmFsdWUgYXMgU2hvd2Nhc2VTY2VuZVR5cGUpfT4KICAgICAgICAgICAgICAgIHsoT2JqZWN0LmtleXMoVFlQRV9MQUJFTFMpIGFzIFNo
b3djYXNlU2NlbmVUeXBlW10pLm1hcCgodHlwZSkgPT4gPG9wdGlvbiBrZXk9e3R5cGV9IHZhbHVlPXt0eXBlfT57VFlQRV9MQUJFTFNbdHlwZV19PC9vcHRp
b24+KX0KICAgICAgICAgICAgICA8L3NlbGVjdD4KICAgICAgICAgICAgPC9GaWVsZD4KICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJCYcWfbMSxayIgaGlu
dD0iQm/FnyBixLFyYWvEsXJzYW4gZWtyYW5kYSBiYcWfbMSxayBnw7ZzdGVyaWxtZXouIj48aW5wdXQgY2xhc3NOYW1lPXtpbnB1dENsYXNzfSB2YWx1ZT17
c2VsZWN0ZWQudGl0bGUgPz8gIiJ9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgdGl0bGU6IGV2ZW50LnRhcmdldC52YWx1ZSB9KX0gLz48
L0ZpZWxkPgogICAgICAgICAgICA8RmllbGQgbGFiZWw9IkFsdCBiYcWfbMSxayIgaGludD0iQm/FnyBixLFyYWvEsXJzYW4gZWtyYW5kYSBhbHQgYmHFn2zE
sWsgZ8O2c3RlcmlsbWV6LiI+PGlucHV0IGNsYXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e3NlbGVjdGVkLnN1YnRpdGxlID8/ICIifSBvbkNoYW5nZT17
KGV2ZW50KSA9PiB1cGRhdGVTY2VuZSh7IHN1YnRpdGxlOiBldmVudC50YXJnZXQudmFsdWUgfSl9IC8+PC9GaWVsZD4KICAgICAgICAgICAgPEZpZWxkIGxh
YmVsPSJSb3pldCAvIGvDvMOnw7xrIGJhxZ9sxLFrIiBoaW50PSJCb8WfIGLEsXJha8SxcnNhbiByb3pldCBnw7ZzdGVyaWxtZXouIj48aW5wdXQgY2xhc3NO
YW1lPXtpbnB1dENsYXNzfSB2YWx1ZT17c2VsZWN0ZWQuYmFkZ2UgPz8gIiJ9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgYmFkZ2U6IGV2
ZW50LnRhcmdldC52YWx1ZSB9KX0gLz48L0ZpZWxkPgogICAgICAgICAgICB7c2VsZWN0ZWQudHlwZSA9PT0gInByb2R1Y3QiIHx8IHNlbGVjdGVkLnR5cGUg
PT09ICJtZW51IiA/ICgKICAgICAgICAgICAgICA8RmllbGQgbGFiZWw9IlRvcGxhbSBzYWhuZSBzw7xyZXNpIiBoaW50PSJTZcOnaWxlbiDDvHLDvG4gdmV5
YSBtZW7DvCBzYXlmYWxhcsSxbmEgZ8O2cmUgb3RvbWF0aWsgaGVzYXBsYW7EsXIuIj4KICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPXtgJHtpbnB1
dENsYXNzfSBjdXJzb3ItZGVmYXVsdCB0ZXh0LXN0b25lLTMwMGB9PntzZWxlY3RlZFNjZW5lRHVyYXRpb259IHNhbml5ZTwvZGl2PgogICAgICAgICAgICAg
IDwvRmllbGQ+CiAgICAgICAgICAgICkgOiAoCiAgICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJTw7xyZSAoc2FuaXllKSIgaGludD0iVmlkZW9sYXJkYSBi
dSBkZcSfZXIgYXluxLEgemFtYW5kYSBnw7x2ZW5saWsgc8O8cmVzaSBvbGFyYWsga3VsbGFuxLFsxLFyLiI+CiAgICAgICAgICAgICAgICA8aW5wdXQgdHlw
ZT0ibnVtYmVyIiBtaW49ezV9IG1heD17MzYwMH0gY2xhc3NOYW1lPXtpbnB1dENsYXNzfSB2YWx1ZT17c2VsZWN0ZWQuZHVyYXRpb25TZWNvbmRzfSBvbkNo
YW5nZT17KGV2ZW50KSA9PiB1cGRhdGVTY2VuZSh7IGR1cmF0aW9uU2Vjb25kczogTnVtYmVyKGV2ZW50LnRhcmdldC52YWx1ZSkgfSl9IC8+CiAgICAgICAg
ICAgICAgPC9GaWVsZD4KICAgICAgICAgICAgKX0KICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im1kOmNvbC1zcGFuLTIiPgogICAgICAgICAgICAgIDxG
aWVsZAogICAgICAgICAgICAgICAgbGFiZWw9e3NlbGVjdGVkLnR5cGUgPT09ICJtZXNzYWdlIiA/ICJEdXl1cnUgbWV0bmkiIDogIkVrIG1ldGluIn0KICAg
ICAgICAgICAgICAgIGhpbnQ9e3NlbGVjdGVkLnR5cGUgPT09ICJtZXNzYWdlIgogICAgICAgICAgICAgICAgICA/ICJBbHQgYmHFn2zEsWt0YW4gYmHEn8Sx
bXPEsXogZ8O2csO8bsO8ci4gQm/FnyBixLFyYWvEsXJzYW4gZWsgbWV0aW4gZ8O2c3RlcmlsbWV6LiIKICAgICAgICAgICAgICAgICAgOiAiQm/FnyBixLFy
YWvEsXJzYW4gZWsgbWV0aW4gZ8O2c3RlcmlsbWV6LiJ9CiAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAgPHRleHRhcmVhIHJvd3M9e3NlbGVjdGVk
LnR5cGUgPT09ICJtZXNzYWdlIiA/IDUgOiAzfSBjbGFzc05hbWU9e2lucHV0Q2xhc3N9IHZhbHVlPXtzZWxlY3RlZC5ib2R5ID8/ICIifSBvbkNoYW5nZT17
KGV2ZW50KSA9PiB1cGRhdGVTY2VuZSh7IGJvZHk6IGV2ZW50LnRhcmdldC52YWx1ZSB9KX0gLz4KICAgICAgICAgICAgICA8L0ZpZWxkPgogICAgICAgICAg
ICA8L2Rpdj4KICAgICAgICAgICAge3NlbGVjdGVkLnR5cGUgPT09ICJtZXNzYWdlIiA/ICgKICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibWQ6Y29s
LXNwYW4tMiByb3VuZGVkLXhsIGJvcmRlciBib3JkZXItb3JhbmdlLTUwMC8yNSBiZy1vcmFuZ2UtNTAwLzUgcC0zIHRleHQteHMgbGVhZGluZy01IHRleHQt
c3RvbmUtMzAwIj4KICAgICAgICAgICAgICAgIEJ1IHNhaG5lOyBnZcOnaWNpIGthcGFuxLHFnywgw7Z6ZWwgw6dhbMSxxZ9tYSBzYWF0aSwgeW/En3VubHVr
LCB0ZXNsaW1hdCBnZWNpa21lc2kgdmV5YSDDtnplbCBnw7xuIGJpbGdpbGVuZGlybWVzaSBpw6dpbiBrdWxsYW7EsWzEsXIuIEJhxZ9sxLFrLCBhbHQgYmHF
n2zEsWsgdmUgZHV5dXJ1IG1ldG5pIGFydMSxayBla3JhbmRhIGF5csSxIGF5csSxIGfDtnN0ZXJpbGlyLgogICAgICAgICAgICAgIDwvZGl2PgogICAgICAg
ICAgICApIDogbnVsbH0KCiAgICAgICAgICAgIDxGaWVsZCBsYWJlbD0iR2XDp2nFnyBlZmVrdGkiPgogICAgICAgICAgICAgIDxzZWxlY3QgY2xhc3NOYW1l
PXtpbnB1dENsYXNzfSB2YWx1ZT17c2VsZWN0ZWQudHJhbnNpdGlvbn0gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2NlbmUoeyB0cmFuc2l0aW9uOiBl
dmVudC50YXJnZXQudmFsdWUgYXMgU2hvd2Nhc2VTY2VuZVsidHJhbnNpdGlvbiJdIH0pfT4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9ImZhZGUi
Pll1bXXFn2FrIGdlw6dpxZ88L29wdGlvbj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InNsaWRlIj5ZYW5kYW4gZ2XDp2nFnzwvb3B0aW9uPgog
ICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT0iem9vbSI+WXVtdcWfYWsgeWFrxLFubGHFn3TEsXJtYTwvb3B0aW9uPgogICAgICAgICAgICAgICAgPG9w
dGlvbiB2YWx1ZT0ibm9uZSI+RWZla3RzaXo8L29wdGlvbj4KICAgICAgICAgICAgICA8L3NlbGVjdD4KICAgICAgICAgICAgPC9GaWVsZD4KICAgICAgICAg
ICAgPEZpZWxkIGxhYmVsPSJWdXJndSByZW5naSI+PGlucHV0IHR5cGU9ImNvbG9yIiBjbGFzc05hbWU9e2Ake2lucHV0Q2xhc3N9IGgtMTEgcC0xYH0gdmFs
dWU9e3NlbGVjdGVkLmFjY2VudCB8fCAiI2ZmOWQyZSJ9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgYWNjZW50OiBldmVudC50YXJnZXQu
dmFsdWUgfSl9IC8+PC9GaWVsZD4KCiAgICAgICAgICAgIHtzZWxlY3RlZC50eXBlID09PSAidmlkZW8iID8gKAogICAgICAgICAgICAgIDxGaWVsZCBsYWJl
bD0iVmlkZW95YSBiYcSfbMSxIMO8csO8biI+CiAgICAgICAgICAgICAgICA8c2VsZWN0IGNsYXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e3NlbGVjdGVk
LnByb2R1Y3RJZCB8fCAiIn0gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2NlbmUoeyBwcm9kdWN0SWQ6IGV2ZW50LnRhcmdldC52YWx1ZSB8fCB1bmRl
ZmluZWQsIHByb2R1Y3RJZHM6IGV2ZW50LnRhcmdldC52YWx1ZSA/IFtldmVudC50YXJnZXQudmFsdWVdIDogW10gfSl9PgogICAgICAgICAgICAgICAgICA8
b3B0aW9uIHZhbHVlPSIiPsOccsO8biBiYcSfbGFtYTwvb3B0aW9uPgogICAgICAgICAgICAgICAgICB7ZGF0YS5wcm9kdWN0cy5tYXAoKHByb2R1Y3QpID0+
IDxvcHRpb24ga2V5PXtwcm9kdWN0LmlkfSB2YWx1ZT17cHJvZHVjdC5pZH0+e3Byb2R1Y3QubmFtZX0gwrcgeyhwcm9kdWN0LmRpc3BsYXlQcmljZSA/PyBw
cm9kdWN0LnByaWNlKS50b0ZpeGVkKDIpfSDigqw8L29wdGlvbj4pfQogICAgICAgICAgICAgICAgPC9zZWxlY3Q+CiAgICAgICAgICAgICAgPC9GaWVsZD4K
ICAgICAgICAgICAgKSA6IG51bGx9CgogICAgICAgICAgICB7c2VsZWN0ZWQudHlwZSA9PT0gImNhbXBhaWduIiA/ICgKICAgICAgICAgICAgICA8RmllbGQg
bGFiZWw9IlZlcml0YWJhbsSxbmRhbiBrYW1wYW55YSI+CiAgICAgICAgICAgICAgICA8c2VsZWN0IGNsYXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e3Nl
bGVjdGVkLmNhbXBhaWduSWQgfHwgIiJ9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgY2FtcGFpZ25JZDogZXZlbnQudGFyZ2V0LnZhbHVl
IHx8IHVuZGVmaW5lZCB9KX0+CiAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9IiI+S2FtcGFueWEgYmHEn2xhbWE8L29wdGlvbj4KICAgICAgICAg
ICAgICAgICAge2RhdGEuY2FtcGFpZ25zLm1hcCgoY2FtcGFpZ24pID0+IDxvcHRpb24ga2V5PXtjYW1wYWlnbi5pZH0gdmFsdWU9e2NhbXBhaWduLmlkfT57
Y2FtcGFpZ24udGl0bGV9PC9vcHRpb24+KX0KICAgICAgICAgICAgICAgIDwvc2VsZWN0PgogICAgICAgICAgICAgIDwvRmllbGQ+CiAgICAgICAgICAgICkg
OiBudWxsfQoKICAgICAgICAgICAge3NlbGVjdGVkLnR5cGUgIT09ICJwcm9kdWN0IiAmJiBzZWxlY3RlZC50eXBlICE9PSAibWVudSIgPyAoCiAgICAgICAg
ICAgICAgPEZpZWxkIGxhYmVsPSJNZWR5YSB5ZXJsZcWfaW1pIj4KICAgICAgICAgICAgICAgIDxzZWxlY3QgY2xhc3NOYW1lPXtpbnB1dENsYXNzfSB2YWx1
ZT17c2VsZWN0ZWQuZml0IHx8ICJjb3ZlciJ9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgZml0OiBldmVudC50YXJnZXQudmFsdWUgYXMg
ImNvdmVyIiB8ICJjb250YWluIiB9KX0+CiAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9ImNvdmVyIj5Fa3JhbsSxIHRhbWFtZW4gZG9sZHVyPC9v
cHRpb24+CiAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9ImNvbnRhaW4iPkRvc3lhbsSxbiB0YW1hbcSxbsSxIGfDtnN0ZXI8L29wdGlvbj4KICAg
ICAgICAgICAgICAgIDwvc2VsZWN0PgogICAgICAgICAgICAgIDwvRmllbGQ+CiAgICAgICAgICAgICkgOiBudWxsfQoKICAgICAgICAgICAgPEZpZWxkIGxh
YmVsPSJCYcWfbGFuZ8Sxw6cgemFtYW7EsSAoaXN0ZcSfZSBiYcSfbMSxKSI+PGlucHV0IHR5cGU9ImRhdGV0aW1lLWxvY2FsIiBjbGFzc05hbWU9e2lucHV0
Q2xhc3N9IHZhbHVlPXtsb2NhbERhdGUoc2VsZWN0ZWQuc3RhcnRBdCl9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgc3RhcnRBdDogaXNv
RGF0ZShldmVudC50YXJnZXQudmFsdWUpIH0pfSAvPjwvRmllbGQ+CiAgICAgICAgICAgIDxGaWVsZCBsYWJlbD0iQml0acWfIHphbWFuxLEgKGlzdGXEn2Ug
YmHEn2zEsSkiPjxpbnB1dCB0eXBlPSJkYXRldGltZS1sb2NhbCIgY2xhc3NOYW1lPXtpbnB1dENsYXNzfSB2YWx1ZT17bG9jYWxEYXRlKHNlbGVjdGVkLmVu
ZEF0KX0gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2NlbmUoeyBlbmRBdDogaXNvRGF0ZShldmVudC50YXJnZXQudmFsdWUpIH0pfSAvPjwvRmllbGQ+
CgogICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibWQ6Y29sLXNwYW4tMiByb3VuZGVkLXhsIGJvcmRlciBib3JkZXItc3RvbmUtODAwIGJnLXN0b25lLTk1
MC82MCBwLTMiPgogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJncmlkIGdhcC0zIHNtOmdyaWQtY29scy0zIj4KICAgICAgICAgICAgICAgIHtzZWxl
Y3RlZC50eXBlID09PSAicHJvZHVjdCIgfHwgc2VsZWN0ZWQudHlwZSA9PT0gIm1lbnUiID8gKAogICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0i
ZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0zIHRleHQtc20gdGV4dC1zdG9uZS00MDAiPgogICAgICAgICAgICAgICAgICAgIDxzcGFu
PkxvZ288L3NwYW4+CiAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJyb3VuZGVkLWZ1bGwgYm9yZGVyIGJvcmRlci1zdG9uZS03MDAgYmct
c3RvbmUtOTAwIHB4LTIgcHktMSB0ZXh0LVsxMXB4XSBmb250LWJvbGQgdGV4dC1zdG9uZS0zMDAiPkJ1IHNhaG5lZGUga2FwYWzEsTwvc3Bhbj4KICAgICAg
ICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICApIDogKAogICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNl
bnRlciBqdXN0aWZ5LWJldHdlZW4gZ2FwLTMgdGV4dC1zbSI+TG9nb3l1IGfDtnN0ZXI8aW5wdXQgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ9e3NlbGVjdGVk
LnNob3dMb2dvICE9PSBmYWxzZX0gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2NlbmUoeyBzaG93TG9nbzogZXZlbnQudGFyZ2V0LmNoZWNrZWQgfSl9
IC8+PC9sYWJlbD4KICAgICAgICAgICAgICAgICl9CiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5
LWJldHdlZW4gZ2FwLTMgdGV4dC1zbSI+UVIga29kdSBnw7ZzdGVyPGlucHV0IHR5cGU9ImNoZWNrYm94IiBjaGVja2VkPXtzZWxlY3RlZC5zaG93UXIgPT09
IHRydWV9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgc2hvd1FyOiBldmVudC50YXJnZXQuY2hlY2tlZCB9KX0gLz48L2xhYmVsPgogICAg
ICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0iZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0zIHRleHQtc20iPkZpeWF0xLEgZ8O2
c3RlcjxpbnB1dCB0eXBlPSJjaGVja2JveCIgY2hlY2tlZD17c2VsZWN0ZWQuc2hvd1ByaWNlICE9PSBmYWxzZX0gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBk
YXRlU2NlbmUoeyBzaG93UHJpY2U6IGV2ZW50LnRhcmdldC5jaGVja2VkIH0pfSAvPjwvbGFiZWw+CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAg
IDwvZGl2PgoKICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJRUiBoZWRlZmkgKGJvxZ8gPSB2YXJzYXnEsWxhbikiPjxpbnB1dCBjbGFzc05hbWU9e2lucHV0
Q2xhc3N9IHZhbHVlPXtzZWxlY3RlZC5xclVybCB8fCAiIn0gcGxhY2Vob2xkZXI9e2RyYWZ0LnNldHRpbmdzLnFyVXJsfSBvbkNoYW5nZT17KGV2ZW50KSA9
PiB1cGRhdGVTY2VuZSh7IHFyVXJsOiBldmVudC50YXJnZXQudmFsdWUgfSl9IC8+PC9GaWVsZD4KICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJRUiBhw6fE
sWtsYW1hc8SxIiBoaW50PSJCb8WfIGLEsXJha8SxcnNhbiBRUiBrb2R1bnVuIGFsdMSxbmRhIGHDp8Sxa2xhbWEgZ8O2c3RlcmlsbWV6LiI+PGlucHV0IGNs
YXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e3NlbGVjdGVkLnFyTGFiZWwgPz8gIiJ9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgcXJM
YWJlbDogZXZlbnQudGFyZ2V0LnZhbHVlIH0pfSAvPjwvRmllbGQ+CiAgICAgICAgICA8L2Rpdj4KCiAgICAgICAgICB7c2VsZWN0ZWQudHlwZSA9PT0gInBy
b2R1Y3QiID8gKAogICAgICAgICAgICA8c2VjdGlvbiBjbGFzc05hbWU9InJvdW5kZWQtMnhsIGJvcmRlciBib3JkZXItb3JhbmdlLTcwMC80MCBiZy1vcmFu
Z2UtOTUwLzIwIHAtNCI+CiAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXggZmxleC13cmFwIGl0ZW1zLXN0YXJ0IGp1c3RpZnktYmV0d2VlbiBn
YXAtMyI+CiAgICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0idGV4dC14cyBmb250LWJsYWNrIHVwcGVyY2Fz
ZSB0cmFja2luZy1bLjE2ZW1dIHRleHQtb3JhbmdlLTMwMCI+w4dva2x1IMO8csO8biBha8SxxZ/EsTwvZGl2PgogICAgICAgICAgICAgICAgICA8aDMgY2xh
c3NOYW1lPSJtdC0xIGZvbnQtYmxhY2sgdGV4dC13aGl0ZSI+w5xyw7xubGVyaSBzZcOnIHZlIGfDtnN0ZXJpbSBzxLFyYXPEsW7EsSBiZWxpcmxlPC9oMz4K
ICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPSJtdC0xIG1heC13LTN4bCB0ZXh0LXNtIGxlYWRpbmctcmVsYXhlZCB0ZXh0LXN0b25lLTMwMCI+CiAg
ICAgICAgICAgICAgICAgICAgSGVyIMO8csO8biB0ZWsgdmUgZMO8emVubGkgYmlyIGthcnR0YSBnw7ZzdGVyaWxpcjogw7xzdHRlIMO8csO8biBnw7Zyc2Vs
aSwgYWx0dGEgw7xyw7xuIGFkxLEsIGnDp2luZGVraWxlciwgYWxlcmplbmxlciB2ZSBnw7xuY2VsIGZpeWF0LiBTw7xyZSBkb2x1bmNhIHPEsXJhZGFraSDD
vHLDvG4gYXluxLEgZMO8emVubGUgZ2VsaXIuCiAgICAgICAgICAgICAgICAgIDwvcD4KICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAg
PGRpdiBjbGFzc05hbWU9InJvdW5kZWQteGwgYm9yZGVyIGJvcmRlci1vcmFuZ2UtNzAwLzQwIGJnLWJsYWNrLzI1IHB4LTMgcHktMiB0ZXh0LXhzIHRleHQt
b3JhbmdlLTEwMCI+CiAgICAgICAgICAgICAgICAgIHtzZWxlY3RlZFByb2R1Y3RzLmxlbmd0aH0gw7xyw7xuIMK3IHRvcGxhbSB7c2VsZWN0ZWRTY2VuZUR1
cmF0aW9ufSBzYW5peWUKICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0i
bXQtNCBncmlkIGdhcC0zIG1kOmdyaWQtY29scy1bbWlubWF4KDAsMWZyKV8xOTBweF0iPgogICAgICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSLDnHLDvG4g
ZWtsZSI+CiAgICAgICAgICAgICAgICAgIDxzZWxlY3QKICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9e2lucHV0Q2xhc3N9CiAgICAgICAgICAgICAg
ICAgICAgdmFsdWU9IiIKICAgICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGV2ZW50KSA9PiB7CiAgICAgICAgICAgICAgICAgICAgICBhZGRQcm9kdWN0
VG9TY2VuZShldmVudC50YXJnZXQudmFsdWUpOwogICAgICAgICAgICAgICAgICAgICAgZXZlbnQudGFyZ2V0LnZhbHVlID0gIiI7CiAgICAgICAgICAgICAg
ICAgICAgfX0KICAgICAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9IiI+TGlzdGVkZW4gw7xyw7xuIHNlw6figKY8
L29wdGlvbj4KICAgICAgICAgICAgICAgICAgICB7ZGF0YS5wcm9kdWN0cwogICAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigocHJvZHVjdCkgPT4gIXNl
bGVjdGVkUHJvZHVjdHMuc29tZSgoc2VsZWN0ZWRQcm9kdWN0KSA9PiBzZWxlY3RlZFByb2R1Y3QuaWQgPT09IHByb2R1Y3QuaWQpKQogICAgICAgICAgICAg
ICAgICAgICAgLm1hcCgocHJvZHVjdCkgPT4gKAogICAgICAgICAgICAgICAgICAgICAgICA8b3B0aW9uIGtleT17cHJvZHVjdC5pZH0gdmFsdWU9e3Byb2R1
Y3QuaWR9PgogICAgICAgICAgICAgICAgICAgICAgICAgIHtwcm9kdWN0Lmdyb3VwTGFiZWwgJiYgcHJvZHVjdC5ncm91cExhYmVsICE9PSBwcm9kdWN0LmNh
dGVnb3J5TGFiZWwgPyBgJHtwcm9kdWN0Lmdyb3VwTGFiZWx9IMK3IGAgOiAiIn17cHJvZHVjdC5uYW1lfSDCtyB7KHByb2R1Y3QuZGlzcGxheVByaWNlID8/
IHByb2R1Y3QucHJpY2UpLnRvRml4ZWQoMil9IOKCrHtwcm9kdWN0LmNhbXBhaWduQmFkZ2UgPyBgIMK3ICR7cHJvZHVjdC5jYW1wYWlnbkJhZGdlfWAgOiAi
In0KICAgICAgICAgICAgICAgICAgICAgICAgPC9vcHRpb24+CiAgICAgICAgICAgICAgICAgICAgICApKX0KICAgICAgICAgICAgICAgICAgPC9zZWxlY3Q+
CiAgICAgICAgICAgICAgICA8L0ZpZWxkPgogICAgICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSLDnHLDvG4gYmHFn8SxbmEgc8O8cmUiIGhpbnQ9IkJ1IHPD
vHJlIGRvbHVuY2Egc8SxcmFkYWtpIMO8csO8biBheW7EsSB5ZXJsZcWfaW1sZSBvdG9tYXRpayBnZWxpci4iPgogICAgICAgICAgICAgICAgICA8aW5wdXQK
ICAgICAgICAgICAgICAgICAgICB0eXBlPSJudW1iZXIiCiAgICAgICAgICAgICAgICAgICAgbWluPXs2fQogICAgICAgICAgICAgICAgICAgIG1heD17MTIw
fQogICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT17aW5wdXRDbGFzc30KICAgICAgICAgICAgICAgICAgICB2YWx1ZT17c2VsZWN0ZWQucHJvZHVjdFNl
Y29uZHMgfHwgMTJ9CiAgICAgICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2NlbmUoeyBwcm9kdWN0U2Vjb25kczogTnVtYmVy
KGV2ZW50LnRhcmdldC52YWx1ZSkgfSl9CiAgICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAgICAgICA8L0ZpZWxkPgogICAgICAgICAgICAgIDwvZGl2
PgoKICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibXQtNCByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05NTAvNTUg
cC00Ij4KICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJmbGV4IGZsZXgtd3JhcCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0yIj4K
ICAgICAgICAgICAgICAgICAgPGRpdj4KICAgICAgICAgICAgICAgICAgICA8aDQgY2xhc3NOYW1lPSJmb250LWJsYWNrIHRleHQtd2hpdGUiPsOccsO8biBn
w7Zyc2VsaSB5ZXJsZcWfaW1pPC9oND4KICAgICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9InRleHQteHMgdGV4dC1zdG9uZS00MDAiPkfDtnJzZWwg
w7xzdCBhbGFuZGEgc2FiaXQga2FsxLFyOyBrxLFycG1hZGFuIGJveXV0dW51IHZlIG1lcmtlemluaSBheWFybGF5YWJpbGlyc2luLjwvcD4KICAgICAgICAg
ICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgICAgICB0eXBlPSJidXR0b24iCiAgICAgICAgICAgICAg
ICAgICAgb25DbGljaz17KCkgPT4gdXBkYXRlU2NlbmUoeyBwcm9kdWN0SW1hZ2VGaXQ6ICJjb250YWluIiwgcHJvZHVjdEltYWdlU2NhbGU6IDgyLCBwcm9k
dWN0SW1hZ2VYOiAwLCBwcm9kdWN0SW1hZ2VZOiAwIH0pfQogICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0icm91bmRlZC1sZyBib3JkZXIgYm9yZGVy
LXN0b25lLTcwMCBweC0zIHB5LTEuNSB0ZXh0LXhzIGZvbnQtYm9sZCB0ZXh0LXN0b25lLTIwMCBob3ZlcjpiZy1zdG9uZS04MDAiCiAgICAgICAgICAgICAg
ICAgID4KICAgICAgICAgICAgICAgICAgICBWYXJzYXnEsWxhbmEgZMO2bgogICAgICAgICAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgICAgICAgIDwv
ZGl2PgogICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im10LTQgZ3JpZCBnYXAtNCBtZDpncmlkLWNvbHMtMiI+CiAgICAgICAgICAgICAgICAgIDxG
aWVsZCBsYWJlbD0iR8O2cnNlbCBiacOnaW1pIj4KICAgICAgICAgICAgICAgICAgICA8c2VsZWN0CiAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9
e2lucHV0Q2xhc3N9CiAgICAgICAgICAgICAgICAgICAgICB2YWx1ZT17c2VsZWN0ZWQucHJvZHVjdEltYWdlRml0IHx8ICJjb250YWluIn0KICAgICAgICAg
ICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgcHJvZHVjdEltYWdlRml0OiBldmVudC50YXJnZXQudmFsdWUgYXMgImNv
bnRhaW4iIHwgImNvdmVyIiB9KX0KICAgICAgICAgICAgICAgICAgICA+CiAgICAgICAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJjb250YWluIj5H
w7Zyc2VsaW4gdGFtYW3EsW7EsSBnw7ZzdGVyPC9vcHRpb24+CiAgICAgICAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJjb3ZlciI+QWxhbsSxIGRv
bGR1ciB2ZSBrxLFycDwvb3B0aW9uPgogICAgICAgICAgICAgICAgICAgIDwvc2VsZWN0PgogICAgICAgICAgICAgICAgICA8L0ZpZWxkPgogICAgICAgICAg
ICAgICAgICA8RmllbGQgbGFiZWw9e2BHw7Zyc2VsIGJveXV0dTogJHtNYXRoLnJvdW5kKHNlbGVjdGVkLnByb2R1Y3RJbWFnZVNjYWxlIHx8IDgyKX0lYH0+
CiAgICAgICAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICAgICAgICB0eXBlPSJyYW5nZSIgbWluPXszNX0gbWF4PXsxMzB9IHN0ZXA9ezF9
CiAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBhY2NlbnQtb3JhbmdlLTUwMCIKICAgICAgICAgICAgICAgICAgICAgIHZhbHVlPXtz
ZWxlY3RlZC5wcm9kdWN0SW1hZ2VTY2FsZSB8fCA4Mn0KICAgICAgICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsg
cHJvZHVjdEltYWdlU2NhbGU6IE51bWJlcihldmVudC50YXJnZXQudmFsdWUpIH0pfQogICAgICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAgICAgICAg
IDwvRmllbGQ+CiAgICAgICAgICAgICAgICAgIDxGaWVsZCBsYWJlbD17YFlhdGF5IGtvbnVtOiAke01hdGgucm91bmQoc2VsZWN0ZWQucHJvZHVjdEltYWdl
WCB8fCAwKX0lYH0+CiAgICAgICAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICAgICAgICB0eXBlPSJyYW5nZSIgbWluPXstNDB9IG1heD17
NDB9IHN0ZXA9ezF9CiAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBhY2NlbnQtb3JhbmdlLTUwMCIKICAgICAgICAgICAgICAgICAg
ICAgIHZhbHVlPXtzZWxlY3RlZC5wcm9kdWN0SW1hZ2VYIHx8IDB9CiAgICAgICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGV2ZW50KSA9PiB1cGRhdGVT
Y2VuZSh7IHByb2R1Y3RJbWFnZVg6IE51bWJlcihldmVudC50YXJnZXQudmFsdWUpIH0pfQogICAgICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAgICAg
ICAgIDwvRmllbGQ+CiAgICAgICAgICAgICAgICAgIDxGaWVsZCBsYWJlbD17YERpa2V5IGtvbnVtOiAke01hdGgucm91bmQoc2VsZWN0ZWQucHJvZHVjdElt
YWdlWSB8fCAwKX0lYH0+CiAgICAgICAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICAgICAgICB0eXBlPSJyYW5nZSIgbWluPXstNDB9IG1h
eD17NDB9IHN0ZXA9ezF9CiAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBhY2NlbnQtb3JhbmdlLTUwMCIKICAgICAgICAgICAgICAg
ICAgICAgIHZhbHVlPXtzZWxlY3RlZC5wcm9kdWN0SW1hZ2VZIHx8IDB9CiAgICAgICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGV2ZW50KSA9PiB1cGRh
dGVTY2VuZSh7IHByb2R1Y3RJbWFnZVk6IE51bWJlcihldmVudC50YXJnZXQudmFsdWUpIH0pfQogICAgICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAg
ICAgICAgIDwvRmllbGQ+CiAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8L2Rpdj4KCiAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9
Im10LTQgc3BhY2UteS0yIj4KICAgICAgICAgICAgICAgIHtzZWxlY3RlZFByb2R1Y3RzLmxlbmd0aCA/IHNlbGVjdGVkUHJvZHVjdHMubWFwKChwcm9kdWN0
LCBpbmRleCkgPT4gKAogICAgICAgICAgICAgICAgICA8ZGl2IGtleT17cHJvZHVjdC5pZH0gY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMyBy
b3VuZGVkLXhsIGJvcmRlciBib3JkZXItc3RvbmUtODAwIGJnLXN0b25lLTk1MC83MCBwLTMiPgogICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1l
PSJoLTE0IHctMTQgc2hyaW5rLTAgb3ZlcmZsb3ctaGlkZGVuIHJvdW5kZWQtbGcgYmctYmxhY2siPgogICAgICAgICAgICAgICAgICAgICAge3Byb2R1Y3Qu
aW1hZ2VVcmwgPyA8aW1nIHNyYz17cHJvZHVjdC5pbWFnZVVybH0gYWx0PSIiIGNsYXNzTmFtZT0iaC1mdWxsIHctZnVsbCBvYmplY3QtY29udGFpbiIgLz4g
OiA8ZGl2IGNsYXNzTmFtZT0iZ3JpZCBoLWZ1bGwgcGxhY2UtaXRlbXMtY2VudGVyIHRleHQtMnhsIj7wn42UPC9kaXY+fQogICAgICAgICAgICAgICAgICAg
IDwvZGl2PgogICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJtaW4tdy0wIGZsZXgtMSI+CiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNs
YXNzTmFtZT0iZmxleCBmbGV4LXdyYXAgaXRlbXMtY2VudGVyIGdhcC0yIj4KICAgICAgICAgICAgICAgICAgICAgICAgPHN0cm9uZyBjbGFzc05hbWU9InRy
dW5jYXRlIHRleHQtc20gdGV4dC13aGl0ZSI+e2luZGV4ICsgMX0uIHtwcm9kdWN0Lmdyb3VwTGFiZWwgJiYgcHJvZHVjdC5ncm91cExhYmVsICE9PSBwcm9k
dWN0LmNhdGVnb3J5TGFiZWwgPyBgJHtwcm9kdWN0Lmdyb3VwTGFiZWx9IMK3IGAgOiAiIn17cHJvZHVjdC5uYW1lfTwvc3Ryb25nPgogICAgICAgICAgICAg
ICAgICAgICAgICB7cHJvZHVjdC5jYW1wYWlnbkJhZGdlID8gPHNwYW4gY2xhc3NOYW1lPSJyb3VuZGVkLWZ1bGwgYmctcmVkLTYwMCBweC0yIHB5LTAuNSB0
ZXh0LVsxMHB4XSBmb250LWJsYWNrIHRleHQtd2hpdGUiPntwcm9kdWN0LmNhbXBhaWduQmFkZ2V9PC9zcGFuPiA6IG51bGx9CiAgICAgICAgICAgICAgICAg
ICAgICA8L2Rpdj4KICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJtdC0xIHRleHQteHMgdGV4dC1zdG9uZS00MDAiPgogICAgICAgICAg
ICAgICAgICAgICAgICB7cHJvZHVjdC5vcmlnaW5hbFByaWNlID8gPHNwYW4gY2xhc3NOYW1lPSJtci0yIGxpbmUtdGhyb3VnaCI+e3Byb2R1Y3Qub3JpZ2lu
YWxQcmljZS50b0ZpeGVkKDIpfSDigqw8L3NwYW4+IDogbnVsbH0KICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJmb250LWJvbGQg
dGV4dC1vcmFuZ2UtMjAwIj57KHByb2R1Y3QuZGlzcGxheVByaWNlID8/IHByb2R1Y3QucHJpY2UpLnRvRml4ZWQoMil9IOKCrDwvc3Bhbj4KICAgICAgICAg
ICAgICAgICAgICAgICAge3Byb2R1Y3QuZGVzY3JpcHRpb24gPyA8c3Bhbj4gwrcgxLDDp2VyaWsgbWV0bmkgaGF6xLFyPC9zcGFuPiA6IDxzcGFuPiDCtyDE
sMOnZXJpayBtZXRuaSBla3Npazwvc3Bhbj59CiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAg
ICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxleCBzaHJpbmstMCBnYXAtMSI+CiAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIHR5cGU9ImJ1
dHRvbiIgb25DbGljaz17KCkgPT4gbW92ZVByb2R1Y3RJblNjZW5lKHByb2R1Y3QuaWQsIC0xKX0gZGlzYWJsZWQ9e2luZGV4ID09PSAwfSBjbGFzc05hbWU9
InJvdW5kZWQtbGcgYmctc3RvbmUtODAwIHB4LTIgcHktMS41IHRleHQteHMgZGlzYWJsZWQ6b3BhY2l0eS0zMCI+4oaRPC9idXR0b24+CiAgICAgICAgICAg
ICAgICAgICAgICA8YnV0dG9uIHR5cGU9ImJ1dHRvbiIgb25DbGljaz17KCkgPT4gbW92ZVByb2R1Y3RJblNjZW5lKHByb2R1Y3QuaWQsIDEpfSBkaXNhYmxl
ZD17aW5kZXggPT09IHNlbGVjdGVkUHJvZHVjdHMubGVuZ3RoIC0gMX0gY2xhc3NOYW1lPSJyb3VuZGVkLWxnIGJnLXN0b25lLTgwMCBweC0yIHB5LTEuNSB0
ZXh0LXhzIGRpc2FibGVkOm9wYWNpdHktMzAiPuKGkzwvYnV0dG9uPgogICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiB0eXBlPSJidXR0b24iIG9uQ2xp
Y2s9eygpID0+IHJlbW92ZVByb2R1Y3RGcm9tU2NlbmUocHJvZHVjdC5pZCl9IGNsYXNzTmFtZT0icm91bmRlZC1sZyBiZy1yZWQtOTUwIHB4LTIgcHktMS41
IHRleHQteHMgdGV4dC1yZWQtMzAwIj5TaWw8L2J1dHRvbj4KICAgICAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICAgICAgPC9kaXY+CiAg
ICAgICAgICAgICAgICApKSA6ICgKICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9InJvdW5kZWQteGwgYm9yZGVyIGJvcmRlci1kYXNoZWQgYm9y
ZGVyLXN0b25lLTcwMCBwLTUgdGV4dC1jZW50ZXIgdGV4dC1zbSB0ZXh0LXN0b25lLTQwMCI+CiAgICAgICAgICAgICAgICAgICAgSGVuw7x6IMO8csO8biBz
ZcOnaWxtZWRpLiDDnHN0dGVraSBsaXN0ZWRlbiBiaXJkZW4gZmF6bGEgw7xyw7xuIGVrbGV5ZWJpbGlyc2luLgogICAgICAgICAgICAgICAgICA8L2Rpdj4K
ICAgICAgICAgICAgICAgICl9CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDwvc2VjdGlvbj4KICAgICAgICAgICkgOiBudWxsfQoKICAgICAg
ICAgIHtzZWxlY3RlZC50eXBlID09PSAibWVudSIgPyAoCiAgICAgICAgICAgIDxzZWN0aW9uIGNsYXNzTmFtZT0icm91bmRlZC0yeGwgYm9yZGVyIGJvcmRl
ci12aW9sZXQtNzAwLzQwIGJnLXZpb2xldC05NTAvMjAgcC00Ij4KICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxleCBmbGV4LXdyYXAgaXRlbXMt
c3RhcnQganVzdGlmeS1iZXR3ZWVuIGdhcC0zIj4KICAgICAgICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJ0ZXh0
LXhzIGZvbnQtYmxhY2sgdXBwZXJjYXNlIHRyYWNraW5nLVsuMTZlbV0gdGV4dC12aW9sZXQtMzAwIj5HcnVwbHUgZGlqaXRhbCBtZW7DvDwvZGl2PgogICAg
ICAgICAgICAgICAgICA8aDMgY2xhc3NOYW1lPSJtdC0xIGZvbnQtYmxhY2sgdGV4dC13aGl0ZSI+TWVuw7wgc2F5ZmFsYXLEsW7EsSB2ZXJpdGFiYW7EsW5k
YW4gb3RvbWF0aWsgb2x1xZ90dXI8L2gzPgogICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9Im10LTEgbWF4LXctM3hsIHRleHQtc20gbGVhZGluZy1y
ZWxheGVkIHRleHQtc3RvbmUtMzAwIj4KICAgICAgICAgICAgICAgICAgICBBa3RpZiDDvHLDvG5sZXIga2F0ZWdvcmkgdmUgbWV2Y3V0IGnDp2VjZWsvZWtz
dHJhIGdydXBsYXLEsSBoYWxpbmRlIGxpc3RlbGVuaXIuIEZpeWF0bGFyLCBQZmFuZCBiaWxnaWxlcmkgdmUga2FtcGFueWFsYXIgY2FubMSxIHZlcmlkZW4g
Z2VsaXI7IMO8csO8biBzYXnEsXPEsSBmYXpsYXlzYSBla3JhbiBvdG9tYXRpayBvbGFyYWsgYmlyIHNvbnJha2kgbWVuw7wgc2F5ZmFzxLFuYSBnZcOnZXIu
CiAgICAgICAgICAgICAgICAgIDwvcD4KICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9InJvdW5kZWQteGwg
Ym9yZGVyIGJvcmRlci12aW9sZXQtNzAwLzQwIGJnLWJsYWNrLzI1IHB4LTMgcHktMiB0ZXh0LXhzIHRleHQtdmlvbGV0LTEwMCI+CiAgICAgICAgICAgICAg
ICAgIHtzZWxlY3RlZE1lbnVQYWdlcy5sZW5ndGh9IG1lbsO8IHNheWZhc8SxIMK3IHRvcGxhbSB7c2VsZWN0ZWRTY2VuZUR1cmF0aW9ufSBzYW5peWUKICAg
ICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibXQtNCBmbGV4IGZsZXgtd3Jh
cCBpdGVtcy1jZW50ZXIgZ2FwLTIgcm91bmRlZC14bCBib3JkZXIgYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05NTAvNTUgcC0zIj4KICAgICAgICAgICAg
ICAgIDxzcGFuIGNsYXNzTmFtZT0idGV4dC1zbSBmb250LWJvbGQgdGV4dC13aGl0ZSI+U2XDp2lsZW4gZ3J1cGxhcjo8L3NwYW4+CiAgICAgICAgICAgICAg
ICB7KHNlbGVjdGVkLm1lbnVDYXRlZ29yaWVzIHx8IFtdKS5sZW5ndGggPyAoc2VsZWN0ZWQubWVudUNhdGVnb3JpZXMgfHwgW10pLm1hcCgoY2F0ZWdvcnkp
ID0+ICgKICAgICAgICAgICAgICAgICAgPHNwYW4ga2V5PXtjYXRlZ29yeX0gY2xhc3NOYW1lPSJyb3VuZGVkLWZ1bGwgYmctdmlvbGV0LTUwMC8xNSBweC0z
IHB5LTEgdGV4dC14cyBmb250LWJvbGQgdGV4dC12aW9sZXQtMTAwIj4KICAgICAgICAgICAgICAgICAgICB7c2hvd2Nhc2VDYXRlZ29yeUxhYmVsKGNhdGVn
b3J5LCAidHIiKX0KICAgICAgICAgICAgICAgICAgPC9zcGFuPgogICAgICAgICAgICAgICAgKSkgOiA8c3BhbiBjbGFzc05hbWU9InRleHQteHMgdGV4dC1h
bWJlci0zMDAiPkhlbsO8eiBncnVwIHNlw6dpbG1lZGk8L3NwYW4+fQogICAgICAgICAgICAgICAgPGJ1dHRvbiB0eXBlPSJidXR0b24iIG9uQ2xpY2s9e2Ns
ZWFyTWVudUNhdGVnb3JpZXN9IGNsYXNzTmFtZT0ibWwtYXV0byByb3VuZGVkLWxnIGJvcmRlciBib3JkZXItc3RvbmUtNzAwIHB4LTMgcHktMS41IHRleHQt
eHMgZm9udC1ib2xkIHRleHQtc3RvbmUtMzAwIGhvdmVyOmJnLXN0b25lLTgwMCI+U2XDp2ltaSB0ZW1pemxlPC9idXR0b24+CiAgICAgICAgICAgICAgPC9k
aXY+CgogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJtdC00IGdyaWQgZ2FwLTIgc206Z3JpZC1jb2xzLTIgeGw6Z3JpZC1jb2xzLTMiPgogICAgICAg
ICAgICAgICAge2F2YWlsYWJsZUNhdGVnb3JpZXMubWFwKChjYXRlZ29yeSkgPT4gewogICAgICAgICAgICAgICAgICBjb25zdCBjb3VudCA9IGRhdGEucHJv
ZHVjdHMuZmlsdGVyKChwcm9kdWN0KSA9PiBwcm9kdWN0LmNhdGVnb3J5ID09PSBjYXRlZ29yeSkubGVuZ3RoOwogICAgICAgICAgICAgICAgICBjb25zdCBj
aGVja2VkID0gKHNlbGVjdGVkLm1lbnVDYXRlZ29yaWVzIHx8IFtdKS5pbmNsdWRlcyhjYXRlZ29yeSk7CiAgICAgICAgICAgICAgICAgIHJldHVybiAoCiAg
ICAgICAgICAgICAgICAgICAgPGRpdiBrZXk9e2NhdGVnb3J5fSBjbGFzc05hbWU9e2Byb3VuZGVkLXhsIGJvcmRlciBwLTIgdHJhbnNpdGlvbiAke2NoZWNr
ZWQgPyAiYm9yZGVyLXZpb2xldC00MDAgYmctdmlvbGV0LTUwMC8xNSIgOiAiYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05NTAvNzAifWB9PgogICAgICAg
ICAgICAgICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICAgICAgICAgICAgICB0eXBlPSJidXR0b24iCiAgICAgICAgICAgICAgICAgICAgICAgIGFyaWEt
cHJlc3NlZD17Y2hlY2tlZH0KICAgICAgICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gc2V0T25seU1lbnVDYXRlZ29yeShjYXRlZ29yeSl9CiAg
ICAgICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0iZmxleCB3LWZ1bGwgaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlbiByb3VuZGVkLWxnIHB4LTIg
cHktMS41IHRleHQtbGVmdCB0ZXh0LXNtIgogICAgICAgICAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9
e2Bmb250LWJvbGQgJHtjaGVja2VkID8gInRleHQtdmlvbGV0LTUwIiA6ICJ0ZXh0LXN0b25lLTMwMCJ9YH0+e2NoZWNrZWQgPyAi4pyTICIgOiAiIn17c2hv
d2Nhc2VDYXRlZ29yeUxhYmVsKGNhdGVnb3J5LCAidHIiKX08L3NwYW4+CiAgICAgICAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0icm91bmRl
ZC1mdWxsIGJnLWJsYWNrLzM1IHB4LTIgcHktMC41IHRleHQteHMgdGV4dC1zdG9uZS0zMDAiPntjb3VudH08L3NwYW4+CiAgICAgICAgICAgICAgICAgICAg
ICA8L2J1dHRvbj4KICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgICAgICAgICAgdHlwZT0iYnV0dG9uIgogICAgICAgICAg
ICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB0b2dnbGVNZW51Q2F0ZWdvcnkoY2F0ZWdvcnkpfQogICAgICAgICAgICAgICAgICAgICAgICBjbGFzc05h
bWU9Im10LTEgdy1mdWxsIHJvdW5kZWQtbGcgYm9yZGVyIGJvcmRlci1zdG9uZS03MDAvNzAgcHgtMiBweS0xIHRleHQtWzExcHhdIGZvbnQtYm9sZCB0ZXh0
LXN0b25lLTQwMCBob3Zlcjpib3JkZXItdmlvbGV0LTUwMC82MCBob3Zlcjp0ZXh0LXZpb2xldC0xMDAiCiAgICAgICAgICAgICAgICAgICAgICA+CiAgICAg
ICAgICAgICAgICAgICAgICAgIHtjaGVja2VkID8gIsOHb2tsdSBzZcOnaW1kZW4gw6fEsWthciIgOiAiw4dva2x1IHNlw6dpbWUgZWtsZSJ9CiAgICAgICAg
ICAgICAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgICAgIH0p
fQogICAgICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgICAgICB7KHNlbGVjdGVkLm1lbnVDYXRlZ29yaWVzIHx8IFtdKS5sZW5ndGggPT09IDAgPyAoCiAg
ICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibXQtMyByb3VuZGVkLXhsIGJvcmRlciBib3JkZXItYW1iZXItNzAwLzUwIGJnLWFtYmVyLTk1MC8zMCBw
LTMgdGV4dC1zbSB0ZXh0LWFtYmVyLTIwMCI+CiAgICAgICAgICAgICAgICAgIERpaml0YWwgbWVuw7wgYm/FnyBrYWzEsXIuIEJpciBncnVwIGFkxLFuYSB0
xLFrbGE7IHlhbG7EsXogbyBncnVwIHNlw6dpbGlyLiBCaXJkZW4gZmF6bGEgZ3J1cCBpw6dpbiDigJzDh29rbHUgc2XDp2ltZSBla2xl4oCdIGTDvMSfbWVz
aW5pIGt1bGxhbi4KICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICkgOiBudWxsfQoKICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0i
bXQtNCBncmlkIGdhcC0zIHNtOmdyaWQtY29scy0yIHhsOmdyaWQtY29scy0zIj4KICAgICAgICAgICAgICAgIDxGaWVsZCBsYWJlbD0iS29sb24gc2F5xLFz
xLEiPgogICAgICAgICAgICAgICAgICA8c2VsZWN0IGNsYXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e3NlbGVjdGVkLm1lbnVDb2x1bW5zIHx8IDJ9IG9u
Q2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgbWVudUNvbHVtbnM6IE51bWJlcihldmVudC50YXJnZXQudmFsdWUpID09PSAzID8gMyA6IDIgfSl9
PgogICAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9ezJ9PjIga29sb248L29wdGlvbj4KICAgICAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVl
PXszfT4zIGtvbG9uPC9vcHRpb24+CiAgICAgICAgICAgICAgICAgIDwvc2VsZWN0PgogICAgICAgICAgICAgICAgPC9GaWVsZD4KICAgICAgICAgICAgICAg
IDxGaWVsZCBsYWJlbD0iU2F5ZmEgYmHFn8SxbmEgw7xyw7xuIj4KICAgICAgICAgICAgICAgICAgPGlucHV0IHR5cGU9Im51bWJlciIgbWluPXs0fSBtYXg9
ezI0fSBjbGFzc05hbWU9e2lucHV0Q2xhc3N9IHZhbHVlPXtzZWxlY3RlZC5tZW51SXRlbXNQZXJQYWdlIHx8IDh9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVw
ZGF0ZVNjZW5lKHsgbWVudUl0ZW1zUGVyUGFnZTogTnVtYmVyKGV2ZW50LnRhcmdldC52YWx1ZSkgfSl9IC8+CiAgICAgICAgICAgICAgICA8L0ZpZWxkPgog
ICAgICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJTYXlmYSBzw7xyZXNpIj4KICAgICAgICAgICAgICAgICAgPGlucHV0IHR5cGU9Im51bWJlciIgbWluPXs2
fSBtYXg9ezEyMH0gY2xhc3NOYW1lPXtpbnB1dENsYXNzfSB2YWx1ZT17c2VsZWN0ZWQubWVudVBhZ2VTZWNvbmRzIHx8IDEyfSBvbkNoYW5nZT17KGV2ZW50
KSA9PiB1cGRhdGVTY2VuZSh7IG1lbnVQYWdlU2Vjb25kczogTnVtYmVyKGV2ZW50LnRhcmdldC52YWx1ZSkgfSl9IC8+CiAgICAgICAgICAgICAgICA8L0Zp
ZWxkPgogICAgICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJLw7zDp8O8ayDDvHLDvG4gZ8O2cnNlbGxlcmkiPgogICAgICAgICAgICAgICAgICA8YnV0dG9u
IHR5cGU9ImJ1dHRvbiIgb25DbGljaz17KCkgPT4gdXBkYXRlU2NlbmUoeyBtZW51U2hvd0ltYWdlczogc2VsZWN0ZWQubWVudVNob3dJbWFnZXMgPT09IGZh
bHNlIH0pfSBjbGFzc05hbWU9e2Ake2lucHV0Q2xhc3N9IHRleHQtbGVmdGB9PgogICAgICAgICAgICAgICAgICAgIHtzZWxlY3RlZC5tZW51U2hvd0ltYWdl
cyA9PT0gZmFsc2UgPyAiR2l6bGkiIDogIkfDtnN0ZXJpbGl5b3IifQogICAgICAgICAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgICAgICAgIDwvRmll
bGQ+CiAgICAgICAgICAgICAgICA8RmllbGQgbGFiZWw9e2BLw7zDp8O8ayBnw7Zyc2VsIGJveXV0dTogJHtNYXRoLnJvdW5kKHNlbGVjdGVkLm1lbnVJbWFn
ZVNpemUgfHwgNTgpfSBweGB9PgogICAgICAgICAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgICAgICAgICB0eXBlPSJyYW5nZSIKICAgICAgICAgICAg
ICAgICAgICBtaW49ezM2fQogICAgICAgICAgICAgICAgICAgIG1heD17MTA0fQogICAgICAgICAgICAgICAgICAgIHN0ZXA9ezJ9CiAgICAgICAgICAgICAg
ICAgICAgZGlzYWJsZWQ9e3NlbGVjdGVkLm1lbnVTaG93SW1hZ2VzID09PSBmYWxzZX0KICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBh
Y2NlbnQtb3JhbmdlLTUwMCBkaXNhYmxlZDpvcGFjaXR5LTQwIgogICAgICAgICAgICAgICAgICAgIHZhbHVlPXtzZWxlY3RlZC5tZW51SW1hZ2VTaXplIHx8
IDU4fQogICAgICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgbWVudUltYWdlU2l6ZTogTnVtYmVyKGV2ZW50LnRh
cmdldC52YWx1ZSkgfSl9CiAgICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAgICAgICA8L0ZpZWxkPgogICAgICAgICAgICAgICAgPEZpZWxkIGxhYmVs
PSJLxLFzYSBhw6fEsWtsYW1hbGFyIj4KICAgICAgICAgICAgICAgICAgPGJ1dHRvbiB0eXBlPSJidXR0b24iIG9uQ2xpY2s9eygpID0+IHVwZGF0ZVNjZW5l
KHsgbWVudVNob3dEZXNjcmlwdGlvbnM6ICFzZWxlY3RlZC5tZW51U2hvd0Rlc2NyaXB0aW9ucyB9KX0gY2xhc3NOYW1lPXtgJHtpbnB1dENsYXNzfSB0ZXh0
LWxlZnRgfT4KICAgICAgICAgICAgICAgICAgICB7c2VsZWN0ZWQubWVudVNob3dEZXNjcmlwdGlvbnMgPyAiR8O2c3RlcmlsaXlvciIgOiAiR2l6bGkifQog
ICAgICAgICAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgICAgICAgIDwvRmllbGQ+CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDwvc2Vj
dGlvbj4KICAgICAgICAgICkgOiBudWxsfQoKICAgICAgICAgIHtzZWxlY3RlZC50eXBlID09PSAiaGVybyIgPyAoCiAgICAgICAgICAgIDxzZWN0aW9uIGNs
YXNzTmFtZT0icm91bmRlZC0yeGwgYm9yZGVyIGJvcmRlci1za3ktNzAwLzQwIGJnLXNreS05NTAvMjUgcC00Ij4KICAgICAgICAgICAgICA8ZGl2IGNsYXNz
TmFtZT0iZmxleCBmbGV4LXdyYXAgaXRlbXMtc3RhcnQgZ2FwLTMiPgogICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im1pbi13LTAgZmxleC0xIj4K
ICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9InRleHQteHMgZm9udC1ibGFjayB1cHBlcmNhc2UgdHJhY2tpbmctWy4xNmVtXSB0ZXh0LXNreS0z
MDAiPldlYiBzaXRlc2l5bGUgb3RvbWF0aWsgYmHEn2xhbnTEsTwvZGl2PgogICAgICAgICAgICAgICAgICA8aDMgY2xhc3NOYW1lPSJtdC0xIGZvbnQtYmxh
Y2sgdGV4dC13aGl0ZSI+R2lyacWfIHNheWZhc8SxbmRha2kgdGVtYSwgdmlkZW8gdmUgbG9nbzwvaDM+CiAgICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFt
ZT0ibXQtMSB0ZXh0LXNtIGxlYWRpbmctcmVsYXhlZCB0ZXh0LXN0b25lLTMwMCI+CiAgICAgICAgICAgICAgICAgICAgQnUgc2FobmVkZSDDtnplbCBiaXIg
bWVkeWEgVVJM4oCZc2kgeW9rc2EgYW5hIGdpcmnFnyBzYXlmYXPEsW5kYSBha3RpZiBvbGFuIGFya2EgcGxhbiB2aWRlb3N1LAogICAgICAgICAgICAgICAg
ICAgIGV0a2lubGlrIHRlbWFzxLEsIGthciB2ZSBkacSfZXIgZWZla3RsZXIgaWxlIHRlbWF5YSBhaXQgbG9nbyBvdG9tYXRpayBrdWxsYW7EsWzEsXIuCiAg
ICAgICAgICAgICAgICAgICAgQW5hIHNpdGVkZSB0ZW1hecSxIGRlxJ9pxZ90aXJkacSfaW5kZSBUViBla3JhbsSxIGRhIHNvbnJha2kgeWVuaWxlbWVkZSBh
eW7EsSBnw7Zyw7xuw7xtZSBnZcOnZXIuCiAgICAgICAgICAgICAgICAgIDwvcD4KICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im10LTMgZmxl
eCBmbGV4LXdyYXAgZ2FwLTIgdGV4dC14cyI+CiAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJyb3VuZGVkLWZ1bGwgYm9yZGVyIGJvcmRl
ci1za3ktNzAwLzUwIGJnLWJsYWNrLzI1IHB4LTMgcHktMS41Ij5Ba3RpZiB0ZW1hOiA8Yj57ZGF0YS5icmFuZGluZy50aGVtZUlkfTwvYj48L3NwYW4+CiAg
ICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJyb3VuZGVkLWZ1bGwgYm9yZGVyIGJvcmRlci1za3ktNzAwLzUwIGJnLWJsYWNrLzI1IHB4LTMg
cHktMS41Ij5Mb2dvOiA8Yj5hbmEgc2l0ZWRlbiBvdG9tYXRpazwvYj48L3NwYW4+CiAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJyb3Vu
ZGVkLWZ1bGwgYm9yZGVyIGJvcmRlci1za3ktNzAwLzUwIGJnLWJsYWNrLzI1IHB4LTMgcHktMS41Ij5BcmthIHBsYW46IDxiPntzZWxlY3RlZC5tZWRpYVVy
bCA/ICLDtnplbCBtZWR5YSIgOiAiYW5hIHNpdGVkZW4gb3RvbWF0aWsifTwvYj48L3NwYW4+CiAgICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAg
ICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICB7c2VsZWN0ZWQubWVkaWFVcmwgPyAoCiAgICAgICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAg
ICAgICAgICB0eXBlPSJidXR0b24iCiAgICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gewogICAgICAgICAgICAgICAgICAgICAgdXBkYXRlU2Nl
bmUoeyBtZWRpYVVybDogdW5kZWZpbmVkLCBwb3N0ZXJVcmw6IHVuZGVmaW5lZCwgZml0OiAiY292ZXIiIH0pOwogICAgICAgICAgICAgICAgICAgICAgc2V0
TWVzc2FnZSgiR2lyacWfIHNhaG5lc2kgeWVuaWRlbiBhbmEgd2ViIHNpdGVzaSB0ZW1hc8SxbmEgYmHEn2xhbmTEsS4iKTsKICAgICAgICAgICAgICAgICAg
ICB9fQogICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0icm91bmRlZC14bCBib3JkZXIgYm9yZGVyLXNreS01MDAvNTAgYmctc2t5LTUwMC8xMCBweC00
IHB5LTIgdGV4dC1zbSBmb250LWJvbGQgdGV4dC1za3ktMTAwIGhvdmVyOmJnLXNreS01MDAvMjAiCiAgICAgICAgICAgICAgICAgID4KICAgICAgICAgICAg
ICAgICAgICBTaXRlIHRlbWFzxLFuxLEga3VsbGFuCiAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICAgICAgKSA6IG51bGx9CiAgICAg
ICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDwvc2VjdGlvbj4KICAgICAgICAgICkgOiBudWxsfQoKICAgICAgICAgIHtzZWxlY3RlZC50eXBlICE9PSAi
cHJvZHVjdCIgJiYgc2VsZWN0ZWQudHlwZSAhPT0gIm1lbnUiID8gKAogICAgICAgICAgPHNlY3Rpb24gY2xhc3NOYW1lPSJyb3VuZGVkLTJ4bCBib3JkZXIg
Ym9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05NTAvNjAgcC00Ij4KICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXggZmxleC13cmFwIGl0ZW1zLWNl
bnRlciBnYXAtMyI+CiAgICAgICAgICAgICAgPGRpdj4KICAgICAgICAgICAgICAgIDxoMyBjbGFzc05hbWU9ImZvbnQtYmxhY2siPlZpZGVvIHZlIGfDtnJz
ZWxsZXI8L2gzPgogICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtc3RvbmUtNTAwIj5Eb3N5YWxhciBHaXRIdWIgdmV5YSBTdXBh
YmFzZSBTdG9yYWdlIHllcmluZSBkb8SfcnVkYW4gQ2xvdWRpbmFyeSBhbGFuxLFuYSB5w7xrbGVuaXIuPC9wPgogICAgICAgICAgICAgIDwvZGl2PgogICAg
ICAgICAgICAgIDxidXR0b24gb25DbGljaz17KCkgPT4gZmlsZVJlZi5jdXJyZW50Py5jbGljaygpfSBkaXNhYmxlZD17IWRhdGEuc3RvcmFnZS5jb25maWd1
cmVkIHx8IHVwbG9hZFByb2dyZXNzICE9PSBudWxsfSBjbGFzc05hbWU9Im1sLWF1dG8gcm91bmRlZC14bCBiZy1zdG9uZS0xMDAgcHgtNCBweS0yIHRleHQt
c20gZm9udC1ibGFjayB0ZXh0LWJsYWNrIGRpc2FibGVkOmN1cnNvci1ub3QtYWxsb3dlZCBkaXNhYmxlZDpvcGFjaXR5LTQwIj4KICAgICAgICAgICAgICAg
IERvc3lhIHnDvGtsZQogICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgICAgcmVmPXtmaWxlUmVmfQog
ICAgICAgICAgICAgICAgdHlwZT0iZmlsZSIKICAgICAgICAgICAgICAgIGhpZGRlbgogICAgICAgICAgICAgICAgYWNjZXB0PSJ2aWRlby9tcDQsdmlkZW8v
d2VibSxpbWFnZS9qcGVnLGltYWdlL3BuZyxpbWFnZS93ZWJwLGltYWdlL2F2aWYiCiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGV2ZW50KSA9PiB7CiAg
ICAgICAgICAgICAgICAgIGNvbnN0IGZpbGUgPSBldmVudC50YXJnZXQuZmlsZXM/LlswXTsKICAgICAgICAgICAgICAgICAgaWYgKGZpbGUpIHZvaWQgdXBs
b2FkTWVkaWEoZmlsZSk7CiAgICAgICAgICAgICAgICB9fQogICAgICAgICAgICAgIC8+CiAgICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgICAgeyFkYXRh
LnN0b3JhZ2UuY29uZmlndXJlZCA/ICgKICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibXQtMyByb3VuZGVkLXhsIGJvcmRlciBib3JkZXItYW1iZXIt
NzAwLzUwIGJnLWFtYmVyLTk1MC8zMCBwLTMgdGV4dC1zbSB0ZXh0LWFtYmVyLTIwMCI+CiAgICAgICAgICAgICAgICBDbG91ZGluYXJ5IGhlbsO8eiBheWFy
bGFubWFkxLEuIFZlcmNlbCBpw6dpbmRlIDxjb2RlPkNMT1VESU5BUllfQ0xPVURfTkFNRTwvY29kZT4sIDxjb2RlPkNMT1VESU5BUllfQVBJX0tFWTwvY29k
ZT4gdmUgPGNvZGU+Q0xPVURJTkFSWV9BUElfU0VDUkVUPC9jb2RlPiBkZcSfacWfa2VubGVyaSBidWx1bm1hbMSxLgogICAgICAgICAgICAgIDwvZGl2Pgog
ICAgICAgICAgICApIDogbnVsbH0KCiAgICAgICAgICAgIHt1cGxvYWRQcm9ncmVzcyAhPT0gbnVsbCA/ICgKICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFt
ZT0ibXQtMyI+CiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibWItMSBmbGV4IGp1c3RpZnktYmV0d2VlbiB0ZXh0LXhzIHRleHQtc3RvbmUtNDAw
Ij48c3Bhbj5Zw7xrbGVuaXlvcjwvc3Bhbj48c3Bhbj57dXBsb2FkUHJvZ3Jlc3N9JTwvc3Bhbj48L2Rpdj4KICAgICAgICAgICAgICAgIDxkaXYgY2xhc3NO
YW1lPSJoLTIgb3ZlcmZsb3ctaGlkZGVuIHJvdW5kZWQtZnVsbCBiZy1zdG9uZS04MDAiPjxkaXYgY2xhc3NOYW1lPSJoLWZ1bGwgYmctb3JhbmdlLTUwMCB0
cmFuc2l0aW9uLWFsbCIgc3R5bGU9e3sgd2lkdGg6IGAke3VwbG9hZFByb2dyZXNzfSVgIH19IC8+PC9kaXY+CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAg
ICAgICAgICkgOiBudWxsfQoKICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJEb8SfcnVkYW4gbWVkeWEgVVJM4oCZc2kiIGhpbnQ9IkhhcmljaSBiaXIgYWxh
bmRhIGJ1bHVuYW4gbWV2Y3V0IGRvc3lhIGnDp2luIGRlIGt1bGxhbsSxbGFiaWxpci4iPgogICAgICAgICAgICAgIDxpbnB1dCBjbGFzc05hbWU9e2Ake2lu
cHV0Q2xhc3N9IG10LTNgfSB2YWx1ZT17c2VsZWN0ZWQubWVkaWFVcmwgfHwgIiJ9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNjZW5lKHsgbWVkaWFV
cmw6IGV2ZW50LnRhcmdldC52YWx1ZSB9KX0gcGxhY2Vob2xkZXI9Imh0dHBzOi8vLi4uL3ZpZGVvLm1wNCIgLz4KICAgICAgICAgICAgPC9GaWVsZD4KCiAg
ICAgICAgICAgIHtzZWxlY3RlZC50eXBlID09PSAidmlkZW8iID8gKAogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJtdC0zIj48RmllbGQgbGFiZWw9
IkthcGFrIGfDtnJzZWxpIC8gUG9zdGVyIFVSTOKAmXNpIj48aW5wdXQgY2xhc3NOYW1lPXtpbnB1dENsYXNzfSB2YWx1ZT17c2VsZWN0ZWQucG9zdGVyVXJs
IHx8ICIifSBvbkNoYW5nZT17KGV2ZW50KSA9PiB1cGRhdGVTY2VuZSh7IHBvc3RlclVybDogZXZlbnQudGFyZ2V0LnZhbHVlIH0pfSAvPjwvRmllbGQ+PC9k
aXY+CiAgICAgICAgICAgICkgOiBudWxsfQoKICAgICAgICAgICAge2RhdGEubWVkaWEubGVuZ3RoID8gKAogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1l
PSJtdC00IGdyaWQgbWF4LWgtNzIgZ3JpZC1jb2xzLTIgZ2FwLTIgb3ZlcmZsb3cteS1hdXRvIHByLTEgc206Z3JpZC1jb2xzLTMiPgogICAgICAgICAgICAg
ICAge2RhdGEubWVkaWEubWFwKChpdGVtKSA9PiAoCiAgICAgICAgICAgICAgICAgIDxkaXYga2V5PXtpdGVtLmlkfSBjbGFzc05hbWU9e2Bncm91cCByZWxh
dGl2ZSBvdmVyZmxvdy1oaWRkZW4gcm91bmRlZC14bCBib3JkZXIgJHtzZWxlY3RlZC5tZWRpYVVybCA9PT0gaXRlbS51cmwgPyAiYm9yZGVyLW9yYW5nZS01
MDAiIDogImJvcmRlci1zdG9uZS04MDAifSBiZy1zdG9uZS05MDBgfT4KICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIG9uQ2xpY2s9eygpID0+IHVwZGF0
ZVNjZW5lKHsgbWVkaWFVcmw6IGl0ZW0udXJsIH0pfSBjbGFzc05hbWU9ImJsb2NrIHctZnVsbCB0ZXh0LWxlZnQiPgogICAgICAgICAgICAgICAgICAgICAg
PGRpdiBjbGFzc05hbWU9ImFzcGVjdC12aWRlbyBiZy1ibGFjayI+CiAgICAgICAgICAgICAgICAgICAgICAgIHtpdGVtLm1pbWVUeXBlLnN0YXJ0c1dpdGgo
ImltYWdlLyIpID8gPGltZyBzcmM9e2l0ZW0udXJsfSBhbHQ9IiIgY2xhc3NOYW1lPSJoLWZ1bGwgdy1mdWxsIG9iamVjdC1jb3ZlciIgLz4gOiA8dmlkZW8g
c3JjPXtpdGVtLnVybH0gbXV0ZWQgcHJlbG9hZD0ibWV0YWRhdGEiIGNsYXNzTmFtZT0iaC1mdWxsIHctZnVsbCBvYmplY3QtY292ZXIiIC8+fQogICAgICAg
ICAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0icC0yIj48ZGl2IGNsYXNzTmFtZT0idHJ1bmNhdGUg
dGV4dC14cyBmb250LWJvbGQiPntpdGVtLm5hbWV9PC9kaXY+PGRpdiBjbGFzc05hbWU9Im10LTEgdGV4dC1bMTBweF0gdGV4dC1zdG9uZS01MDAiPntmb3Jt
YXRCeXRlcyhpdGVtLnNpemUpfXtpdGVtLmR1cmF0aW9uU2Vjb25kcyA/IGAgwrcgJHtpdGVtLmR1cmF0aW9uU2Vjb25kc31zYCA6ICIifTwvZGl2PjwvZGl2
PgogICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICAgICAgICAgIDxidXR0b24gb25DbGljaz17KCkgPT4gdm9pZCBkZWxldGVNZWRp
YShpdGVtKX0gY2xhc3NOYW1lPSJhYnNvbHV0ZSByaWdodC0xLjUgdG9wLTEuNSByb3VuZGVkLWxnIGJnLWJsYWNrLzgwIHB4LTIgcHktMSB0ZXh0LXhzIHRl
eHQtcmVkLTMwMCBvcGFjaXR5LTAgdHJhbnNpdGlvbiBncm91cC1ob3ZlcjpvcGFjaXR5LTEwMCI+U2lsPC9idXR0b24+CiAgICAgICAgICAgICAgICAgIDwv
ZGl2PgogICAgICAgICAgICAgICAgKSl9CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICkgOiBudWxsfQogICAgICAgICAgPC9zZWN0aW9uPgog
ICAgICAgICAgKSA6IG51bGx9CiAgICAgICAgPC9tYWluPgoKICAgICAgICA8YXNpZGUgY2xhc3NOYW1lPSJzcGFjZS15LTQgeGw6c3RpY2t5IHhsOnRvcC01
IHhsOnNlbGYtc3RhcnQiPgogICAgICAgICAgPHNlY3Rpb24gY2xhc3NOYW1lPSJyb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9u
ZS05MDAvNTUgcC00Ij4KICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im1iLTMgZmxleCBmbGV4LXdyYXAgaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2Vl
biBnYXAtMiI+CiAgICAgICAgICAgICAgPGRpdj48aDIgY2xhc3NOYW1lPSJmb250LWJsYWNrIj5DYW5sxLEgw7ZuaXpsZW1lPC9oMj48cCBjbGFzc05hbWU9
InRleHQteHMgdGV4dC1zdG9uZS01MDAiPllhdGF5LCBkaWtleSB2ZSB1bHRyYSBnZW5pxZ8gZWtyYW7EsSBidXJhZGEgdGVzdCBldC48L3A+PC9kaXY+CiAg
ICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJyb3VuZGVkLWZ1bGwgYmctc3RvbmUtODAwIHB4LTMgcHktMSB0ZXh0LXhzIGZvbnQtYm9sZCI+e3NlbGVj
dGVkLnR5cGUgPT09ICJwcm9kdWN0IiA/IGAke3NlbGVjdGVkUHJvZHVjdHMubGVuZ3RofSDDvHLDvG5gIDogc2VsZWN0ZWQudHlwZSA9PT0gIm1lbnUiID8g
YCR7c2VsZWN0ZWRNZW51UGFnZXMubGVuZ3RofSBzYXlmYWAgOiBzZWxlY3RlZFByb2R1Y3Q/Lm5hbWUgfHwgVFlQRV9MQUJFTFNbc2VsZWN0ZWQudHlwZV19
PC9zcGFuPgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im1iLTMgZ3JpZCBncmlkLWNvbHMtMyBnYXAtMS41IHJvdW5k
ZWQteGwgYm9yZGVyIGJvcmRlci1zdG9uZS04MDAgYmctc3RvbmUtOTUwLzYwIHAtMS41Ij4KICAgICAgICAgICAgICB7KFsKICAgICAgICAgICAgICAgIFsi
bGFuZHNjYXBlIiwgIjE2OjkgWWF0YXkiXSwKICAgICAgICAgICAgICAgIFsicG9ydHJhaXQiLCAiOToxNiBEaWtleSJdLAogICAgICAgICAgICAgICAgWyJ1
bHRyYXdpZGUiLCAiMjE6OSBHZW5pxZ8iXSwKICAgICAgICAgICAgICBdIGFzIEFycmF5PFtTaG93Y2FzZVByZXZpZXdBc3BlY3QsIHN0cmluZ10+KS5tYXAo
KFt2YWx1ZSwgbGFiZWxdKSA9PiAoCiAgICAgICAgICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgICAgICAgIGtleT17dmFsdWV9CiAgICAgICAgICAgICAg
ICAgIHR5cGU9ImJ1dHRvbiIKICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gc2V0UHJldmlld0FzcGVjdCh2YWx1ZSl9CiAgICAgICAgICAgICAg
ICAgIGNsYXNzTmFtZT17YHJvdW5kZWQtbGcgcHgtMiBweS0xLjUgdGV4dC1bMTFweF0gZm9udC1ib2xkICR7cHJldmlld0FzcGVjdCA9PT0gdmFsdWUgPyAi
Ymctb3JhbmdlLTUwMCB0ZXh0LWJsYWNrIiA6ICJ0ZXh0LXN0b25lLTQwMCBob3ZlcjpiZy1zdG9uZS04MDAifWB9CiAgICAgICAgICAgICAgICA+CiAgICAg
ICAgICAgICAgICAgIHtsYWJlbH0KICAgICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICAgICkpfQogICAgICAgICAgICA8L2Rpdj4KICAgICAg
ICAgICAgPFNob3djYXNlU3RhZ2Ugc25hcHNob3Q9e3ByZXZpZXdTbmFwc2hvdH0gc2NlbmU9e3NlbGVjdGVkfSBzY2VuZUluZGV4PXtNYXRoLm1heCgwLCBz
ZWxlY3RlZEluZGV4KX0gc2NlbmVDb3VudD17ZHJhZnQuc2NlbmVzLmxlbmd0aH0gcHJldmlldyBwcmV2aWV3QXNwZWN0PXtwcmV2aWV3QXNwZWN0fSBvbmxp
bmUgLz4KICAgICAgICAgIDwvc2VjdGlvbj4KCiAgICAgICAgICA8c2VjdGlvbiBjbGFzc05hbWU9InJvdW5kZWQtMnhsIGJvcmRlciBib3JkZXItc3RvbmUt
ODAwIGJnLXN0b25lLTkwMC81NSBwLTQiPgogICAgICAgICAgICA8aDIgY2xhc3NOYW1lPSJmb250LWJsYWNrIj5HZW5lbCBla3JhbiBheWFybGFyxLE8L2gy
PgogICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibXQtNCBncmlkIGdhcC0zIHNtOmdyaWQtY29scy0yIj4KICAgICAgICAgICAgICA8RmllbGQgbGFiZWw9
IkFkIj48aW5wdXQgY2xhc3NOYW1lPXtpbnB1dENsYXNzfSB2YWx1ZT17ZHJhZnQuc2V0dGluZ3MubmFtZX0gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRl
U2V0dGluZ3MoeyBuYW1lOiBldmVudC50YXJnZXQudmFsdWUgfSl9IC8+PC9GaWVsZD4KICAgICAgICAgICAgICA8RmllbGQgbGFiZWw9IlZhcnNhecSxbGFu
IHPDvHJlIj48aW5wdXQgdHlwZT0ibnVtYmVyIiBtaW49ezV9IGNsYXNzTmFtZT17aW5wdXRDbGFzc30gdmFsdWU9e2RyYWZ0LnNldHRpbmdzLmRlZmF1bHRE
dXJhdGlvblNlY29uZHN9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNldHRpbmdzKHsgZGVmYXVsdER1cmF0aW9uU2Vjb25kczogTnVtYmVyKGV2ZW50
LnRhcmdldC52YWx1ZSkgfSl9IC8+PC9GaWVsZD4KICAgICAgICAgICAgICA8RmllbGQgbGFiZWw9IkNhbmzEsSBzZW5rcm9uIHPDvHJlc2kgKHNuLikiIGhp
bnQ9IllhecSxbmxhIGnFn2xlbWluZGVuIHNvbnJhIGHDp8SxayBUViBla3JhbmxhcsSxIHNheWZhIHllbmlsZW1lZGVuIGVuIGdlw6cgYnUgc8O8cmVkZSBn
w7xuY2VsbGVuaXIuIj4KICAgICAgICAgICAgICAgIDxpbnB1dCB0eXBlPSJudW1iZXIiIG1pbj17Mn0gbWF4PXs1fSBjbGFzc05hbWU9e2lucHV0Q2xhc3N9
IHZhbHVlPXtkcmFmdC5zZXR0aW5ncy5yZWZyZXNoU2Vjb25kc30gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2V0dGluZ3MoeyByZWZyZXNoU2Vjb25k
czogTnVtYmVyKGV2ZW50LnRhcmdldC52YWx1ZSkgfSl9IC8+CiAgICAgICAgICAgICAgPC9GaWVsZD4KICAgICAgICAgICAgICA8RmllbGQgbGFiZWw9IkFy
a2EgcGxhbiI+PHNlbGVjdCBjbGFzc05hbWU9e2lucHV0Q2xhc3N9IHZhbHVlPXtkcmFmdC5zZXR0aW5ncy5iYWNrZ3JvdW5kfSBvbkNoYW5nZT17KGV2ZW50
KSA9PiB1cGRhdGVTZXR0aW5ncyh7IGJhY2tncm91bmQ6IGV2ZW50LnRhcmdldC52YWx1ZSBhcyBTaG93Y2FzZURvY3VtZW50WyJzZXR0aW5ncyJdWyJiYWNr
Z3JvdW5kIl0gfSl9PjxvcHRpb24gdmFsdWU9InRoZW1lIj5Ba3RpZiB3ZWIgc2l0ZXNpIHRlbWFzxLE8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJkYXJrIj5L
b3l1PC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iYmxhY2siPlNpeWFoPC9vcHRpb24+PC9zZWxlY3Q+PC9GaWVsZD4KICAgICAgICAgICAgICA8ZGl2IGNsYXNz
TmFtZT0ic206Y29sLXNwYW4tMiI+PEZpZWxkIGxhYmVsPSJWYXJzYXnEsWxhbiBRUiBoZWRlZmkiPjxpbnB1dCBjbGFzc05hbWU9e2lucHV0Q2xhc3N9IHZh
bHVlPXtkcmFmdC5zZXR0aW5ncy5xclVybH0gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2V0dGluZ3MoeyBxclVybDogZXZlbnQudGFyZ2V0LnZhbHVl
IH0pfSAvPjwvRmllbGQ+PC9kaXY+CiAgICAgICAgICAgICAgPEZpZWxkIGxhYmVsPSJZZW5pIHNhaG5lbGVyIGnDp2luIFFSIGHDp8Sxa2xhbWFzxLEiIGhp
bnQ9IkJvxZ8gYsSxcmFrxLFyc2FuIHllbmkgc2FobmVsZXJkZSBRUiBhw6fEsWtsYW1hc8SxIGVrbGVubWV6LiI+PGlucHV0IGNsYXNzTmFtZT17aW5wdXRD
bGFzc30gdmFsdWU9e2RyYWZ0LnNldHRpbmdzLnFyTGFiZWx9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNldHRpbmdzKHsgcXJMYWJlbDogZXZlbnQu
dGFyZ2V0LnZhbHVlIH0pfSAvPjwvRmllbGQ+CiAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9InNtOmNvbC1zcGFuLTIiPjxGaWVsZCBsYWJlbD0iS2F5
YW4geWF6xLEiIGhpbnQ9IkJvxZ8gYsSxcmFrxLFyc2FuIGtheWFuIHlhesSxIHRhbWFtZW4gZ2l6bGVuaXIuIj48aW5wdXQgY2xhc3NOYW1lPXtpbnB1dENs
YXNzfSB2YWx1ZT17ZHJhZnQuc2V0dGluZ3MudGlja2VyfSBvbkNoYW5nZT17KGV2ZW50KSA9PiB1cGRhdGVTZXR0aW5ncyh7IHRpY2tlcjogZXZlbnQudGFy
Z2V0LnZhbHVlIH0pfSAvPjwvRmllbGQ+PC9kaXY+CiAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibXQtNCBncmlkIGdh
cC0yIHJvdW5kZWQteGwgYm9yZGVyIGJvcmRlci1zdG9uZS04MDAgYmctc3RvbmUtOTUwLzYwIHAtMyBzbTpncmlkLWNvbHMtMyI+CiAgICAgICAgICAgICAg
PGxhYmVsIGNsYXNzTmFtZT0iZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0yIHRleHQtc20iPlNhYXRpIGfDtnN0ZXI8aW5wdXQgdHlw
ZT0iY2hlY2tib3giIGNoZWNrZWQ9e2RyYWZ0LnNldHRpbmdzLnNob3dDbG9ja30gb25DaGFuZ2U9eyhldmVudCkgPT4gdXBkYXRlU2V0dGluZ3MoeyBzaG93
Q2xvY2s6IGV2ZW50LnRhcmdldC5jaGVja2VkIH0pfSAvPjwvbGFiZWw+CiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0iZmxleCBpdGVtcy1jZW50
ZXIganVzdGlmeS1iZXR3ZWVuIGdhcC0yIHRleHQtc20iPsSwbGVybGVtZSBnw7ZzdGVyZ2VzaTxpbnB1dCB0eXBlPSJjaGVja2JveCIgY2hlY2tlZD17ZHJh
ZnQuc2V0dGluZ3Muc2hvd1Byb2dyZXNzfSBvbkNoYW5nZT17KGV2ZW50KSA9PiB1cGRhdGVTZXR0aW5ncyh7IHNob3dQcm9ncmVzczogZXZlbnQudGFyZ2V0
LmNoZWNrZWQgfSl9IC8+PC9sYWJlbD4KICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5LWJldHdlZW4g
Z2FwLTIgdGV4dC1zbSI+QmHEn2xhbnTEsSBkdXJ1bXU8aW5wdXQgdHlwZT0iY2hlY2tib3giIGNoZWNrZWQ9e2RyYWZ0LnNldHRpbmdzLnNob3dDb25uZWN0
aW9uU3RhdGV9IG9uQ2hhbmdlPXsoZXZlbnQpID0+IHVwZGF0ZVNldHRpbmdzKHsgc2hvd0Nvbm5lY3Rpb25TdGF0ZTogZXZlbnQudGFyZ2V0LmNoZWNrZWQg
fSl9IC8+PC9sYWJlbD4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICA8L3NlY3Rpb24+CgogICAgICAgICAgPHNlY3Rpb24gY2xhc3NOYW1lPSJyb3Vu
ZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXN0b25lLTgwMCBiZy1zdG9uZS05MDAvNTUgcC00IHRleHQtc20iPgogICAgICAgICAgICA8aDIgY2xhc3NOYW1lPSJm
b250LWJsYWNrIj5TaXN0ZW0gZHVydW11PC9oMj4KICAgICAgICAgICAgPGRsIGNsYXNzTmFtZT0ibXQtMyBncmlkIGdyaWQtY29scy1bYXV0b18xZnJdIGdh
cC14LTQgZ2FwLXktMiB0ZXh0LXhzIj4KICAgICAgICAgICAgICA8ZHQgY2xhc3NOYW1lPSJ0ZXh0LXN0b25lLTUwMCI+WWF5xLFuIHRhcmloaTwvZHQ+PGRk
IGNsYXNzTmFtZT0idGV4dC1yaWdodCBmb250LXNlbWlib2xkIj57ZGF0YS5wdWJsaXNoZWQucHVibGlzaGVkQXQgPyBuZXcgRGF0ZShkYXRhLnB1Ymxpc2hl
ZC5wdWJsaXNoZWRBdCkudG9Mb2NhbGVTdHJpbmcoImRlLURFIikgOiAiSGVuw7x6IHlhecSxbmxhbm1hZMSxIn08L2RkPgogICAgICAgICAgICAgIDxkdCBj
bGFzc05hbWU9InRleHQtc3RvbmUtNTAwIj5Tw7xyw7xtPC9kdD48ZGQgY2xhc3NOYW1lPSJ0cnVuY2F0ZSB0ZXh0LXJpZ2h0IGZvbnQtbW9ubyB0ZXh0LXN0
b25lLTMwMCI+e2RhdGEucHVibGlzaGVkLnZlcnNpb259PC9kZD4KICAgICAgICAgICAgICA8ZHQgY2xhc3NOYW1lPSJ0ZXh0LXN0b25lLTUwMCI+w5xyw7xu
bGVyPC9kdD48ZGQgY2xhc3NOYW1lPSJ0ZXh0LXJpZ2h0IGZvbnQtc2VtaWJvbGQiPntkYXRhLnByb2R1Y3RzLmxlbmd0aH08L2RkPgogICAgICAgICAgICAg
IDxkdCBjbGFzc05hbWU9InRleHQtc3RvbmUtNTAwIj5LYW1wYW55YWxhcjwvZHQ+PGRkIGNsYXNzTmFtZT0idGV4dC1yaWdodCBmb250LXNlbWlib2xkIj57
ZGF0YS5jYW1wYWlnbnMubGVuZ3RofTwvZGQ+CiAgICAgICAgICAgICAgPGR0IGNsYXNzTmFtZT0idGV4dC1zdG9uZS01MDAiPk1lZHlhIGFsYW7EsTwvZHQ+
PGRkIGNsYXNzTmFtZT17YHRleHQtcmlnaHQgZm9udC1zZW1pYm9sZCAke2RhdGEuc3RvcmFnZS5jb25maWd1cmVkID8gInRleHQtZW1lcmFsZC00MDAiIDog
InRleHQtYW1iZXItNDAwIn1gfT57ZGF0YS5zdG9yYWdlLmNvbmZpZ3VyZWQgPyBgQ2xvdWRpbmFyeSDCtyAke2RhdGEuc3RvcmFnZS5jbG91ZE5hbWV9YCA6
ICJBeWFybGFubWFkxLEifTwvZGQ+CiAgICAgICAgICAgICAge2RhdGEuc3RvcmFnZS5tYXhVcGxvYWRCeXRlcyA/IDw+PGR0IGNsYXNzTmFtZT0idGV4dC1z
dG9uZS01MDAiPkVuIGLDvHnDvGsgZG9zeWE8L2R0PjxkZCBjbGFzc05hbWU9InRleHQtcmlnaHQgZm9udC1zZW1pYm9sZCI+e2Zvcm1hdEJ5dGVzKGRhdGEu
c3RvcmFnZS5tYXhVcGxvYWRCeXRlcyl9PC9kZD48Lz4gOiBudWxsfQogICAgICAgICAgICA8L2RsPgogICAgICAgICAgPC9zZWN0aW9uPgogICAgICAgIDwv
YXNpZGU+CiAgICAgIDwvZGl2PgogICAgPC9kaXY+CiAgKTsKfQo=
'@
    },
    [pscustomobject]@{
        Path = "package.json"
        GitPath = "package.json"
        OriginalSha256 = "B9AD0EE58981E044205DFD2FD832C1AD5D555148FA47273B0D1F3ABF3829E750"
        PatchedSha256 = "190BBB5B9F4D2E8C1F3CE344C928379D459B20F58172B0644FAB40D42A338C54"
        Base64 = @'
ewogICJuYW1lIjogImJ1cmdlci1icm90aGVycy1iZXJsaW4iLAogICJwcml2YXRlIjogdHJ1ZSwKICAic2NyaXB0cyI6IHsKICAgICJkZXYiOiAibmV4dCBk
ZXYiLAogICAgImRldjpodHRwcyI6ICJub2RlIHNlcnZlci5qcyIsCiAgICAiZGV2Om5leHQiOiAibmV4dCBkZXYiLAogICAgImJ1aWxkIjogInByaXNtYSBn
ZW5lcmF0ZSAmJiBuZXh0IGJ1aWxkIiwKICAgICJzdGFydCI6ICJuZXh0IHN0YXJ0IiwKICAgICJ0eXBlY2hlY2siOiAibmV4dCB0eXBlZ2VuICYmIHRzYyAt
LW5vRW1pdCIsCiAgICAicHJpc21hOmdlbmVyYXRlIjogInByaXNtYSBnZW5lcmF0ZSIsCiAgICAicHJpc21hOnB1c2giOiAicHJpc21hIGRiIHB1c2giLAog
ICAgInByaXNtYTptaWdyYXRlIjogInByaXNtYSBtaWdyYXRlIGRldiIsCiAgICAicHJpc21hOnN0dWRpbyI6ICJwcmlzbWEgc3R1ZGlvIiwKICAgICJkYjpo
ZWFsdGgiOiAidHMtbm9kZSB0b29scy9kYl9oZWFsdGgudHMiLAogICAgIm1pZ3JhdGU6anNvbiI6ICJ0cy1ub2RlIHRvb2xzL21pZ3JhdGVfanNvbl90b19k
Yi50cyIsCiAgICAidmVyY2VsOmRldiI6ICJ2ZXJjZWwgZGV2IiwKICAgICJwcmVwdXNoIjogIm5wbSBydW4gdHlwZWNoZWNrICYmIG5wbSBydW4gYnVpbGQi
LAogICAgImJvb3RzdHJhcCI6ICJjdXJsIC1YIFBPU1QgaHR0cDovL2xvY2FsaG9zdDozMDAwL2FwaS9ib290c3RyYXAgLUggXCJDb250ZW50LVR5cGU6IGFw
cGxpY2F0aW9uL2pzb25cIiAtZCBAYm9vdHN0cmFwLmpzb24iLAogICAgInNlY3VyaXR5OnRlc3QiOiAibm9kZSB0b29scy9zZWN1cml0eS10ZXN0cy5tanMg
JiYgbm9kZSB0b29scy9zZWN1cml0eS1yZWdyZXNzaW9uLXRlc3RzLm1qcyAmJiBub2RlIHRvb2xzL21pZGRsZXdhcmUtYWNjZXNzLXRlc3RzLmNqcyAmJiBu
b2RlIHRvb2xzL3JlbGVhc2Utc2VjdXJpdHktdGVzdHMubWpzICYmIG5vZGUgdG9vbHMvc2Vzc2lvbi1zZWN1cml0eS10ZXN0cy5janMgJiYgbm9kZSB0b29s
cy90di1sb2dpbi1yb3V0ZS10ZXN0cy5janMgJiYgbm9kZSB0b29scy9kcml2ZXItc2VjdXJpdHktdGVzdHMuY2pzICYmIG5vZGUgdG9vbHMvb3JkZXItcHJp
Y2luZy10ZXN0cy5janMgJiYgbm9kZSB0b29scy9vcmRlci1hY2Nlc3Mtc2VjdXJpdHktdGVzdHMuY2pzICYmIG5vZGUgdG9vbHMvb3JkZXItcm9sZS1yb3V0
ZS10ZXN0cy5janMgJiYgbm9kZSB0b29scy9vcmRlci1jbGFpbS1yb3V0ZS10ZXN0cy5janMgJiYgbm9kZSB0b29scy9yb3V0ZS1zY29wZS1zZWN1cml0eS10
ZXN0cy5janMgJiYgbm9kZSB0b29scy9wYXltZW50LWNsb3Nlb3V0LXRlc3RzLmNqcyAmJiBub2RlIHRvb2xzL3BheW1lbnQtY2VudGVyLWFyY2hpdGVjdHVy
ZS10ZXN0cy5janMgJiYgbm9kZSB0b29scy90cmFja2luZy10b2tlbi1yb2xlLXJlZ3Jlc3Npb24tdGVzdHMuY2pzICYmIG5vZGUgdG9vbHMvdHYtcmVmYWN0
b3ItcmVncmVzc2lvbi10ZXN0cy5janMgJiYgbm9kZSB0b29scy9jaGVja291dC1zYWZldHktcmVncmVzc2lvbi10ZXN0cy5janMiLAogICAgInNlY3VyaXR5
OmF1ZGl0IjogIm5wbSBhdWRpdCAtLWF1ZGl0LWxldmVsPWhpZ2giLAogICAgInZlcmlmeSI6ICJucG0gcnVuIHR5cGVjaGVjayAmJiBucG0gcnVuIHNlY3Vy
aXR5OnRlc3QgJiYgbnBtIHJ1biBidWlsZCIsCiAgICAicHJpY2luZzp0ZXN0IjogIm5vZGUgdG9vbHMvb3JkZXItcHJpY2luZy10ZXN0cy5janMiLAogICAg
InNlc3Npb246dGVzdCI6ICJub2RlIHRvb2xzL3Nlc3Npb24tc2VjdXJpdHktdGVzdHMuY2pzIiwKICAgICJkcml2ZXItc2VjdXJpdHk6dGVzdCI6ICJub2Rl
IHRvb2xzL2RyaXZlci1zZWN1cml0eS10ZXN0cy5janMiLAogICAgInJlbGVhc2U6dGVzdCI6ICJub2RlIHRvb2xzL3JlbGVhc2Utc2VjdXJpdHktdGVzdHMu
bWpzIiwKICAgICJzZWN1cmU6cmVsZWFzZSI6ICJwb3dlcnNoZWxsIC1FeGVjdXRpb25Qb2xpY3kgQnlwYXNzIC1GaWxlIHRvb2xzL2NyZWF0ZS1zZWN1cmUt
cmVsZWFzZS5wczEiLAogICAgInR2OnJlZmFjdG9yOnRlc3QiOiAibm9kZSB0b29scy90di1yZWZhY3Rvci1yZWdyZXNzaW9uLXRlc3RzLmNqcyIsCiAgICAi
c2hvd2Nhc2U6dGVzdCI6ICJub2RlIHRvb2xzL3Nob3djYXNlLXJlZ3Jlc3Npb24tdGVzdHMuY2pzICYmIG5vZGUgdG9vbHMvc2hvd2Nhc2UtZW1wdHktdGV4
dC1yZWdyZXNzaW9uLXRlc3RzLmNqcyIsCiAgICAiY2hlY2tvdXQ6c2FmZXR5OnRlc3QiOiAibm9kZSB0b29scy9jaGVja291dC1zYWZldHktcmVncmVzc2lv
bi10ZXN0cy5janMiCiAgfSwKICAicHJpc21hIjogewogICAgInNlZWQiOiAidHMtbm9kZSBwcmlzbWEvc2VlZC50cyIKICB9LAogICJkZXBlbmRlbmNpZXMi
OiB7CiAgICAiQHByaXNtYS9jbGllbnQiOiAiNi4xOS4zIiwKICAgICJAcmVhY3QtdGhyZWUvZHJlaSI6ICI5LjEyMi4wIiwKICAgICJAcmVhY3QtdGhyZWUv
ZmliZXIiOiAiXjguMTUuMTYiLAogICAgIkBzdXBhYmFzZS9zdXBhYmFzZS1qcyI6ICJeMi4xMDguMiIsCiAgICAiY2xzeCI6ICIyLjEuMSIsCiAgICAiaG93
bGVyIjogIl4yLjIuNCIsCiAgICAianNiYXJjb2RlIjogIl4zLjEyLjEiLAogICAgImx1Y2lkZS1yZWFjdCI6ICJeMC41NDUuMCIsCiAgICAibmV4dCI6ICIx
NS41LjIwIiwKICAgICJxcmNvZGUiOiAiXjEuNS40IiwKICAgICJyZWFjdCI6ICIxOC4zLjEiLAogICAgInJlYWN0LWRvbSI6ICIxOC4zLjEiLAogICAgInJl
YWN0LXFyLWNvZGUiOiAiXjIuMC4xOCIsCiAgICAic3RyaXBlIjogIl4yMi4zLjEiLAogICAgInRocmVlIjogIl4wLjE4MC4wIiwKICAgICJ6dXN0YW5kIjog
IjQuNS4yIgogIH0sCiAgImRldkRlcGVuZGVuY2llcyI6IHsKICAgICJAdHlwZXMvbm9kZSI6ICIyNC41LjIiLAogICAgImF1dG9wcmVmaXhlciI6ICIxMC40
LjE5IiwKICAgICJsb2NhbC1zc2wtcHJveHkiOiAiXjIuMC41IiwKICAgICJwb3N0Y3NzIjogIjguNS4xOSIsCiAgICAicHJpc21hIjogIjYuMTkuMyIsCiAg
ICAidGFpbHdpbmRjc3MiOiAiMy40LjEwIiwKICAgICJ0cy1ub2RlIjogIl4xMC45LjIiLAogICAgInR5cGVzY3JpcHQiOiAiNS40LjUiCiAgfSwKICAiZW5n
aW5lcyI6IHsKICAgICJub2RlIjogIj49MjAiCiAgfSwKICAib3ZlcnJpZGVzIjogewogICAgImJyYWNlLWV4cGFuc2lvbiI6ICIyLjAuMyIsCiAgICAiZm9s
bG93LXJlZGlyZWN0cyI6ICIxLjE2LjAiLAogICAgIm1pbmltYXRjaCI6ICI5LjAuNyIsCiAgICAicGljb21hdGNoIjogIjIuMy4yIiwKICAgICJ1dWlkIjog
IjExLjEuMSIsCiAgICAieWFtbCI6ICIyLjguMyIsCiAgICAiZ2xvYiI6ICIxMC41LjAiLAogICAgImRlZnUiOiAiNi4xLjciLAogICAgInBvc3Rjc3MiOiAi
JHBvc3Rjc3MiCiAgfQp9Cg==
'@
    },
    [pscustomobject]@{
        Path = "tools\showcase-empty-text-regression-tests.cjs"
        GitPath = "tools/showcase-empty-text-regression-tests.cjs"
        OriginalSha256 = ""
        PatchedSha256 = "38590B06A186199D7B687893BE9AA19A430F4D9E8ABAC287D22162CB1BE55BAD"
        Base64 = @'
Y29uc3QgZnMgPSByZXF1aXJlKCJub2RlOmZzIik7CmNvbnN0IHBhdGggPSByZXF1aXJlKCJub2RlOnBhdGgiKTsKY29uc3Qgdm0gPSByZXF1aXJlKCJub2Rl
OnZtIik7CmNvbnN0IHRzID0gcmVxdWlyZSgidHlwZXNjcmlwdCIpOwoKY29uc3Qgcm9vdCA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICIuLiIpOwpjb25z
dCByZWFkID0gKGZpbGUpID0+IGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4ocm9vdCwgZmlsZSksICJ1dGY4Iik7CmNvbnN0IGFzc2VydCA9IChjb25kaXRp
b24sIG1lc3NhZ2UpID0+IHsKICBpZiAoIWNvbmRpdGlvbikgdGhyb3cgbmV3IEVycm9yKG1lc3NhZ2UpOwp9OwoKZnVuY3Rpb24gdHJhbnNwaWxlKGZpbGUs
IGNvbXBpbGVyT3B0aW9ucyA9IHt9KSB7CiAgY29uc3Qgc291cmNlID0gcmVhZChmaWxlKTsKICBjb25zdCByZXN1bHQgPSB0cy50cmFuc3BpbGVNb2R1bGUo
c291cmNlLCB7CiAgICBmaWxlTmFtZTogZmlsZSwKICAgIHJlcG9ydERpYWdub3N0aWNzOiB0cnVlLAogICAgY29tcGlsZXJPcHRpb25zOiB7CiAgICAgIHRh
cmdldDogdHMuU2NyaXB0VGFyZ2V0LkVTMjAyMiwKICAgICAgbW9kdWxlOiB0cy5Nb2R1bGVLaW5kLkNvbW1vbkpTLAogICAgICBqc3g6IHRzLkpzeEVtaXQu
UmVhY3RKU1gsCiAgICAgIGVzTW9kdWxlSW50ZXJvcDogdHJ1ZSwKICAgICAgLi4uY29tcGlsZXJPcHRpb25zLAogICAgfSwKICB9KTsKCiAgY29uc3QgZXJy
b3JzID0gKHJlc3VsdC5kaWFnbm9zdGljcyB8fCBbXSkuZmlsdGVyKAogICAgKGRpYWdub3N0aWMpID0+IGRpYWdub3N0aWMuY2F0ZWdvcnkgPT09IHRzLkRp
YWdub3N0aWNDYXRlZ29yeS5FcnJvciwKICApOwogIGFzc2VydCgKICAgIGVycm9ycy5sZW5ndGggPT09IDAsCiAgICBgJHtmaWxlfSBzeW50YXggZXJyb3I6
ICR7ZXJyb3JzCiAgICAgIC5tYXAoKGRpYWdub3N0aWMpID0+IHRzLmZsYXR0ZW5EaWFnbm9zdGljTWVzc2FnZVRleHQoZGlhZ25vc3RpYy5tZXNzYWdlVGV4
dCwgIlxuIikpCiAgICAgIC5qb2luKCIgfCAiKX1gLAogICk7CgogIHJldHVybiByZXN1bHQub3V0cHV0VGV4dDsKfQoKZnVuY3Rpb24gbG9hZFNob3djYXNl
Q29uZmlnKCkgewogIGNvbnN0IG91dHB1dCA9IHRyYW5zcGlsZSgibGliL3Nob3djYXNlL2NvbmZpZy50cyIpOwogIGNvbnN0IG1vZHVsZSA9IHsgZXhwb3J0
czoge30gfTsKICBjb25zdCBzYW5kYm94ID0gewogICAgbW9kdWxlLAogICAgZXhwb3J0czogbW9kdWxlLmV4cG9ydHMsCiAgICByZXF1aXJlKHJlcXVlc3Qp
IHsKICAgICAgaWYgKHJlcXVlc3QgPT09ICIuL3J1bnRpbWUiKSB7CiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgIG5vcm1hbGl6ZVNob3djYXNlQ2F0ZWdv
cnkodmFsdWUpIHsKICAgICAgICAgICAgcmV0dXJuIFN0cmluZyh2YWx1ZSB8fCAiIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7CiAgICAgICAgICB9LAogICAg
ICAgIH07CiAgICAgIH0KICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHJlcXVpcmUgaW4gc2hvd2Nhc2UgY29uZmlnIHRlc3Q6ICR7cmVxdWVz
dH1gKTsKICAgIH0sCiAgICBjb25zb2xlLAogICAgVVJMLAogICAgRGF0ZSwKICAgIE1hdGgsCiAgICBTZXQsCiAgICBNYXAsCiAgICBBcnJheSwKICAgIE9i
amVjdCwKICAgIE51bWJlciwKICAgIFN0cmluZywKICAgIEJvb2xlYW4sCiAgfTsKCiAgdm0ucnVuSW5OZXdDb250ZXh0KG91dHB1dCwgc2FuZGJveCwgewog
ICAgZmlsZW5hbWU6ICJsaWIvc2hvd2Nhc2UvY29uZmlnLmpzIiwKICB9KTsKCiAgcmV0dXJuIG1vZHVsZS5leHBvcnRzOwp9Cgpmb3IgKGNvbnN0IGZpbGUg
b2YgWwogICJsaWIvc2hvd2Nhc2UvY29uZmlnLnRzIiwKICAiY29tcG9uZW50cy9zaG93Y2FzZS9TaG93Y2FzZVN0YWdlLnRzeCIsCiAgImFwcC9hZG1pbi9z
aG93Y2FzZS9wYWdlLnRzeCIsCl0pIHsKICB0cmFuc3BpbGUoZmlsZSk7Cn0KCmNvbnN0IGNvbmZpZyA9IGxvYWRTaG93Y2FzZUNvbmZpZygpOwoKY29uc3Qg
c2NlbmUgPSBjb25maWcubm9ybWFsaXplU2hvd2Nhc2VTY2VuZSh7CiAgaWQ6ICJibGFuay1jb3B5IiwKICB0eXBlOiAidmlkZW8iLAogIG5hbWU6ICJCbGFu
ayIsCiAgZW5hYmxlZDogdHJ1ZSwKICBkdXJhdGlvblNlY29uZHM6IDE1LAogIHRyYW5zaXRpb246ICJmYWRlIiwKICB0aXRsZTogIiIsCiAgc3VidGl0bGU6
ICIiLAogIGJvZHk6ICIiLAogIGJhZGdlOiAiIiwKICBxckxhYmVsOiAiIiwKfSk7Cgpmb3IgKGNvbnN0IGtleSBvZiBbInRpdGxlIiwgInN1YnRpdGxlIiwg
ImJvZHkiLCAiYmFkZ2UiLCAicXJMYWJlbCJdKSB7CiAgYXNzZXJ0KAogICAgc2NlbmVba2V5XSA9PT0gIiIsCiAgICBgRXhwbGljaXQgYmxhbmsgc2NlbmUg
ZmllbGQgbXVzdCByZW1haW4gYmxhbms6ICR7a2V5fWAsCiAgKTsKfQoKY29uc3QgZG9jdW1lbnQgPSBjb25maWcubm9ybWFsaXplU2hvd2Nhc2VEb2N1bWVu
dCh7CiAgc2NoZW1hVmVyc2lvbjogMSwKICB2ZXJzaW9uOiAidGVzdCIsCiAgZW5hYmxlZDogdHJ1ZSwKICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09T
dHJpbmcoKSwKICBzZXR0aW5nczogewogICAgbmFtZTogIlRlc3QiLAogICAgZGVmYXVsdER1cmF0aW9uU2Vjb25kczogNDUsCiAgICByZWZyZXNoU2Vjb25k
czogMywKICAgIHNob3dDbG9jazogdHJ1ZSwKICAgIHNob3dQcm9ncmVzczogdHJ1ZSwKICAgIHNob3dDb25uZWN0aW9uU3RhdGU6IGZhbHNlLAogICAgcXJV
cmw6ICJodHRwczovL3d3dy5idXJnZXItYnJvdGhlcnMuYmVybGluL21lbnUiLAogICAgcXJMYWJlbDogIiIsCiAgICB0aWNrZXI6ICIiLAogICAgYmFja2dy
b3VuZDogImJsYWNrIiwKICB9LAogIHNjZW5lczogW3NjZW5lXSwKfSk7Cgphc3NlcnQoZG9jdW1lbnQuc2V0dGluZ3MudGlja2VyID09PSAiIiwgIkJsYW5r
IHRpY2tlciBtdXN0IHJlbWFpbiBibGFuayIpOwphc3NlcnQoZG9jdW1lbnQuc2V0dGluZ3MucXJMYWJlbCA9PT0gIiIsICJCbGFuayBnbG9iYWwgUVIgbGFi
ZWwgbXVzdCByZW1haW4gYmxhbmsiKTsKCmNvbnN0IHN0YWdlID0gcmVhZCgiY29tcG9uZW50cy9zaG93Y2FzZS9TaG93Y2FzZVN0YWdlLnRzeCIpOwpmb3Ig
KGNvbnN0IGZvcmJpZGRlbiBvZiBbCiAgJ3NjZW5lLnRpdGxlIHx8ICJKRVRaVCBPTkxJTkUgQkVTVEVMTEVOIicsCiAgJ3NjZW5lLnN1YnRpdGxlIHx8ICJR
Ui1Db2RlIHNjYW5uZW4gdW5kIGRpcmVrdCB6dXIgU3BlaXNla2FydGUiJywKICAnc2NlbmUudGl0bGUgfHwgcHJvZHVjdD8ubmFtZSB8fCAiRnJpc2NoIGbD
vHIgU2llIHp1YmVyZWl0ZXQiJywKICAnc2NlbmUuYm9keSB8fCAiSmV0enQgb25saW5lIGJlc3RlbGxlbiInLAogICdzY2VuZS50aXRsZSB8fCAiVU5TRVJF
IFNQRUlTRUtBUlRFIicsCiAgJ3NjZW5lLmJhZGdlIHx8IGNhbXBhaWduPy5iYWRnZVRleHQgfHwgIkxJTUlUSUVSVEUgQUtUSU9OIicsCiAgJ3NjZW5lLnRp
dGxlIHx8IHNuYXBzaG90LmJyYW5kaW5nLnNob3BOYW1lJywKICAndGl0bGUgfHwgKGhhc0N1c3RvbUNvcHkgPyBudWxsIDogIldJQ0hUSUdFIE1JVFRFSUxV
TkciKScsCl0pIHsKICBhc3NlcnQoIXN0YWdlLmluY2x1ZGVzKGZvcmJpZGRlbiksIGBEaXNwbGF5IGZhbGxiYWNrIHN0aWxsIGV4aXN0czogJHtmb3JiaWRk
ZW59YCk7Cn0KCmFzc2VydCgKICBzdGFnZS5pbmNsdWRlcygKICAgICJ7dmlzaWJsZUxhYmVsID8gPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5xckxhYmVsfT57
dmlzaWJsZUxhYmVsfTwvZGl2PiA6IG51bGx9IiwKICApLAogICJCbGFuayBRUiBsYWJlbCBtdXN0IG5vdCByZW5kZXIgYW4gZW1wdHkvZGVmYXVsdCBsYWJl
bCIsCik7CmFzc2VydCgKICBzdGFnZS5pbmNsdWRlcygKICAgICJ7c25hcHNob3QuZG9jdW1lbnQuc2V0dGluZ3MudGlja2VyID8gKCIsCiAgKSwKICAiVGlj
a2VyIHZpc2liaWxpdHkgZ3VhcmQgbXVzdCByZW1haW4gcHJlc2VudCIsCik7Cgpjb25zdCBhZG1pbiA9IHJlYWQoImFwcC9hZG1pbi9zaG93Y2FzZS9wYWdl
LnRzeCIpOwphc3NlcnQoCiAgYWRtaW4uaW5jbHVkZXMoIkJvxZ8gYsSxcmFrxLFyc2FuIGVrcmFuZGEgYmHFn2zEsWsgZ8O2c3RlcmlsbWV6LiIpLAogICJB
ZG1pbiB0aXRsZSBibGFuayBiZWhhdmlvciBoaW50IGlzIG1pc3NpbmciLAopOwphc3NlcnQoCiAgYWRtaW4uaW5jbHVkZXMoIkJvxZ8gYsSxcmFrxLFyc2Fu
IGtheWFuIHlhesSxIHRhbWFtZW4gZ2l6bGVuaXIuIiksCiAgIkFkbWluIHRpY2tlciBibGFuayBiZWhhdmlvciBoaW50IGlzIG1pc3NpbmciLAopOwphc3Nl
cnQoCiAgYWRtaW4uaW5jbHVkZXMoIkJvxZ8gYsSxcmFrxLFyc2FuIFFSIGtvZHVudW4gYWx0xLFuZGEgYcOnxLFrbGFtYSBnw7ZzdGVyaWxtZXouIiksCiAg
IkFkbWluIFFSIGxhYmVsIGJsYW5rIGJlaGF2aW9yIGhpbnQgaXMgbWlzc2luZyIsCik7Cgpjb25zb2xlLmxvZygiU2hvd2Nhc2UgYm/FnyBtZXRpbiByZWdy
ZXN5b24gdGVzdGxlcmkgZ2XDp3RpLiIpOwo=
'@
    }
)

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd("\")

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Calisan proje bulunamadi: $ProjectRoot"
}

foreach ($command in @("node.exe", "npm.cmd", "npx.cmd")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command bulunamadi."
    }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $ProjectRoot ".showcase-empty-text-backups\$timestamp"
$localBackup = Join-Path $backupRoot "local"
$repoBackup = Join-Path $backupRoot "repo"

New-Item -ItemType Directory -Path $localBackup -Force | Out-Null

$localStates = @()
try {
    Write-Step "Showcase bos metin duzeltmesi calisan projeye uygulaniyor"
    $localStates = @(Apply-Payloads -Root $ProjectRoot -BackupRoot $localBackup -Payloads $Payloads)

    Test-PayloadSecrets -Root $ProjectRoot -Payloads $Payloads
    Invoke-ProjectValidation -Root $ProjectRoot -InstallWhenMissing $false
}
catch {
    Write-Host ""
    Write-Host "Yerel uygulama/test basarisiz. Dosyalar otomatik geri aliniyor..." -ForegroundColor Red
    if ($localStates.Count -gt 0) {
        Restore-Payloads -Root $ProjectRoot -States $localStates
    }
    throw
}

Write-Host ""
Write-Host "Yerel duzeltme, typecheck ve build basarili." -ForegroundColor Green
Write-Host "Yedek: $backupRoot" -ForegroundColor DarkGray

if ($LocalOnly) {
    Write-Host ""
    Write-Host "LocalOnly secildi; GitHub push yapilmadi." -ForegroundColor Yellow
    exit 0
}

if (-not (Get-Command "git.exe" -ErrorAction SilentlyContinue)) {
    throw "git.exe bulunamadi."
}

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
    throw "GitHub repo klasoru bulunamadi: $RepoRoot"
}

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git") -PathType Container)) {
    throw "$RepoRoot mevcut Git repository degil. git init KULLANILMAYACAK."
}

$gitPaths = @($Payloads | ForEach-Object { $_.GitPath })

Write-Step "GitHub repo guvenlik kontrolu"
Assert-RepoDirtyScope -Root $RepoRoot -AllowedPaths $gitPaths

Push-Location $RepoRoot
try {
    $branch = (& git.exe branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
        throw "Aktif branch '$branch'. Beklenen branch: main"
    }

    $origin = (& git.exe remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($origin)) {
        throw "origin remote bulunamadi."
    }

    Invoke-Native "Remote main bilgisi aliniyor" {
        git.exe fetch origin main
    }

    $head = (& git.exe rev-parse HEAD).Trim()
    $remoteHead = (& git.exe rev-parse origin/main).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "HEAD/origin-main okunamadi."
    }

    if ($head -ne $remoteHead) {
        $dirtyBeforePull = @(Get-RepoDirtyPaths -Root $RepoRoot)
        if ($dirtyBeforePull.Count -gt 0) {
            throw "Repo origin/main ile ayni degil ve yerel degisiklik var. Guvenli devam edilemez."
        }

        Invoke-Native "Repo origin/main ile guncelleniyor" {
            git.exe pull --ff-only origin main
        }
    }
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $repoBackup -Force | Out-Null
$repoStates = @()
$commitCreated = $false

try {
    Write-Step "Final dosyalar GitHub repo klasorune uygulaniyor"
    $repoStates = @(Apply-Payloads -Root $RepoRoot -BackupRoot $repoBackup -Payloads $Payloads)

    Test-PayloadSecrets -Root $RepoRoot -Payloads $Payloads
    Invoke-ProjectValidation -Root $RepoRoot -InstallWhenMissing $true

    Push-Location $RepoRoot
    try {
        Write-Step "Yalniz bu teslimatin dosyalari stage ediliyor"
        & git.exe add -A -- @gitPaths
        if ($LASTEXITCODE -ne 0) {
            throw "git add basarisiz."
        }

        $staged = @(& git.exe diff --cached --name-only -- @gitPaths)
        if ($LASTEXITCODE -ne 0) {
            throw "Stage listesi okunamadi."
        }

        if ($staged.Count -eq 0) {
            Write-Host ""
            Write-Host "GitHub repo zaten guncel. Yeni commit gerekmiyor." -ForegroundColor Yellow
            exit 0
        }

        $allDirty = @(Get-RepoDirtyPaths -Root $RepoRoot)
        $unexpected = @($allDirty | Where-Object { $gitPaths -notcontains $_ })
        if ($unexpected.Count -gt 0) {
            throw "Stage sonrasi teslimat disi degisiklik bulundu."
        }

        Write-Host ""
        Write-Host "Commit edilecek dosyalar:" -ForegroundColor Cyan
        $staged | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

        Invoke-Native "Git commit olusturuluyor" {
            git.exe commit -m $CommitMessage
        }
        $commitCreated = $true

        Invoke-Native "origin/main branch'ine gonderiliyor" {
            git.exe push origin main
        }

        $commitHash = (& git.exe rev-parse --short HEAD).Trim()

        Write-Host ""
        Write-Host "Hazir kankam - Showcase bos metin duzeltmesi GitHub'a gonderildi." -ForegroundColor Green
        Write-Host "Branch : main" -ForegroundColor Green
        Write-Host "Commit : $commitHash" -ForegroundColor Green
        Write-Host "Remote : $origin" -ForegroundColor Green
        Write-Host "Vercel yeni deployment'i otomatik baslatacak." -ForegroundColor Cyan
    }
    finally {
        Pop-Location
    }
}
catch {
    if (-not $commitCreated -and $repoStates.Count -gt 0) {
        Write-Host ""
        Write-Host "Repo testi/derlemesi basarisiz. Repo dosyalari otomatik geri aliniyor..." -ForegroundColor Red
        Restore-Payloads -Root $RepoRoot -States $repoStates
    }
    elseif ($commitCreated) {
        Write-Host ""
        Write-Host "Commit olustu ancak push tamamlanamadi. Commit repo icinde korunuyor." -ForegroundColor Yellow
    }
    throw
}
