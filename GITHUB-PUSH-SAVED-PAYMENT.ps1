$ErrorActionPreference = "Stop"

$src = "C:\Web\burger"
$repo = "C:\Web\burger-github"
$commitMessage = "feat(payments): improve saved payment reuse and returning checkout"

$files = @(
  "app\checkout\page.tsx",
  "app\api\payments\prepare\route.ts",
  "app\api\payments\profile\route.ts",
  "lib\server\payment-checkout.ts"
)

if (!(Test-Path -LiteralPath $src -PathType Container)) {
  throw "Kaynak proje bulunamadi: $src"
}

if (!(Test-Path -LiteralPath (Join-Path $repo ".git") -PathType Container)) {
  throw "GitHub repository bulunamadi: $repo"
}

Set-Location $repo

$existing = @(git status --porcelain)
if ($existing.Count -gt 0) {
  git status --short
  throw "C:\Web\burger-github temiz degil."
}

git pull --ff-only
if ($LASTEXITCODE -ne 0) {
  throw "git pull basarisiz oldu."
}

foreach ($file in $files) {
  $sourceFile = Join-Path $src $file
  $targetFile = Join-Path $repo $file

  if (!(Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Kaynak dosya bulunamadi: $sourceFile"
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
  Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
  Write-Host "Kopyalandi: $file" -ForegroundColor Green
}

$envFile = Join-Path $src ".env.local"
if (Test-Path -LiteralPath $envFile -PathType Leaf) {
  foreach ($rawLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $line = $rawLine.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { continue }

    $parts = $line -split "=", 2
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") { continue }

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      if ($value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$env:NEXT_TELEMETRY_DISABLED = "1"

Remove-Item ".next" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "tsconfig.tsbuildinfo" -Force -ErrorAction SilentlyContinue

& cmd.exe /d /s /c "npx.cmd prisma generate"
if ($LASTEXITCODE -ne 0) {
  throw "Prisma generate basarisiz oldu."
}

& cmd.exe /d /s /c "npm.cmd run verify"
if ($LASTEXITCODE -ne 0) {
  throw "npm run verify basarisiz oldu."
}

$gitFiles = @($files | ForEach-Object { $_ -replace "\\", "/" })

git add -- $gitFiles
if ($LASTEXITCODE -ne 0) {
  throw "git add basarisiz oldu."
}

git diff --cached --check
if ($LASTEXITCODE -ne 0) {
  throw "Staged diff kontrolu basarisiz oldu."
}

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "Yeni degisiklik bulunamadi." -ForegroundColor Yellow
  exit 0
}

git status --short
git -c core.pager=cat diff --cached --stat

git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) {
  throw "git commit basarisiz oldu."
}

$branch = (git branch --show-current).Trim()
git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
  throw "git push basarisiz oldu."
}

Write-Host ""
Write-Host "KAYITLI ODEME GUNCELLEMESI GITHUB'A GONDERILDI" -ForegroundColor Green
