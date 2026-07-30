$ErrorActionPreference = "Stop"

$DefaultSourceRoot = "C:\Web\burger"
$SourceRoot = if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "package.json"))) {
    $PSScriptRoot
} else {
    $DefaultSourceRoot
}

$RepoRoot = "C:\Web\burger-github"
$Branch = "main"
$CommitMessage = "Fix automatic menu image normalization on mobile"

$Files = @(
    "app\menu\page.tsx",
    "components\menu\ProductCard.tsx",
    "app\api\menu-image-alpha-probe\route.ts"
)

if (-not (Test-Path (Join-Path $SourceRoot "package.json"))) {
    throw "Kaynak proje bulunamadı: $SourceRoot"
}

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    throw "GitHub repo klasörü bulunamadı veya .git eksik: $RepoRoot"
}

foreach ($RelativePath in $Files) {
    $Source = Join-Path $SourceRoot $RelativePath
    if (-not (Test-Path $Source)) {
        throw "Kaynak dosya eksik: $Source"
    }

    $Destination = Join-Path $RepoRoot $RelativePath
    $DestinationParent = Split-Path $Destination -Parent
    New-Item -ItemType Directory -Path $DestinationParent -Force | Out-Null
    Copy-Item $Source $Destination -Force
    Write-Host "Repo'ya kopyalandı: $RelativePath" -ForegroundColor Green
}

Push-Location $RepoRoot
try {
    $CurrentBranch = (& git branch --show-current).Trim()
    if ($CurrentBranch -ne $Branch) {
        throw "Repo branch '$CurrentBranch'. Beklenen branch: '$Branch'."
    }

    if (Test-Path ".next") {
        Remove-Item ".next" -Recurse -Force
    }

    Write-Host "TypeScript kontrolü çalışıyor..." -ForegroundColor Cyan
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) {
        throw "TypeScript kontrolü başarısız oldu; GitHub gönderimi durduruldu."
    }

    Write-Host "Temiz production build çalışıyor..." -ForegroundColor Cyan
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Production build başarısız oldu; GitHub gönderimi durduruldu."
    }

    & git add -- `
        "app/menu/page.tsx" `
        "components/menu/ProductCard.tsx" `
        "app/api/menu-image-alpha-probe/route.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "git add başarısız oldu."
    }

    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Gönderilecek yeni değişiklik yok." -ForegroundColor Yellow
        exit 0
    }

    & git commit -m $CommitMessage
    if ($LASTEXITCODE -ne 0) {
        throw "git commit başarısız oldu."
    }

    & git push origin $Branch
    if ($LASTEXITCODE -ne 0) {
        throw "git push başarısız oldu."
    }

    Write-Host "GitHub gönderimi tamamlandı." -ForegroundColor Green
}
finally {
    Pop-Location
}
