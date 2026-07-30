$ErrorActionPreference = "Stop"

$project = "C:\Web\burger"
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$payloadFile = Join-Path $packageRoot "payload\app\tv\login\page.tsx"
$targetFile = Join-Path $project "app\tv\login\page.tsx"
$envLocal = Join-Path $project ".env.local"
$backupRoot = Join-Path "C:\Web\burger-security-backups" ("tv-session-secret-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$backupFile = Join-Path $backupRoot "app\tv\login\page.tsx"

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function New-SessionSecret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

  try {
    $rng.GetBytes($bytes)
  }
  finally {
    $rng.Dispose()
  }

  return [Convert]::ToBase64String($bytes)
}

function Read-EnvValue {
  param(
    [string]$Content,
    [string]$Name
  )

  $pattern = "(?m)^\s*" + [regex]::Escape($Name) + "\s*=\s*(.*?)\s*$"
  $match = [regex]::Match($Content, $pattern)

  if (!$match.Success) {
    return ""
  }

  return $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}

if (!(Test-Path -LiteralPath $project -PathType Container)) {
  Write-Host "Çalışan proje bulunamadı: $project" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath $payloadFile -PathType Leaf)) {
  Write-Host "Paket dosyası bulunamadı: $payloadFile" -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath $targetFile -PathType Leaf)) {
  Write-Host "TV login sayfası bulunamadı: $targetFile" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "TV login oturum ayarı düzeltiliyor..." -ForegroundColor Cyan

# Kod dosyasını yedekle.
New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null
Copy-Item -LiteralPath $targetFile -Destination $backupFile -Force

# Güvenli SESSION_SECRET oluştur veya mevcut güvenli değeri koru.
$existingContent = ""
if (Test-Path -LiteralPath $envLocal -PathType Leaf) {
  $existingContent = [System.IO.File]::ReadAllText($envLocal)
}

$sessionSecret = Read-EnvValue -Content $existingContent -Name "SESSION_SECRET"
$authSecret = Read-EnvValue -Content $existingContent -Name "AUTH_SECRET"
$effectiveSecret = ""

if ($sessionSecret.Length -ge 32) {
  $effectiveSecret = $sessionSecret
  Write-Host "Güvenli SESSION_SECRET zaten mevcut; değiştirilmedi." -ForegroundColor Green
}
elseif ($authSecret.Length -ge 32) {
  $effectiveSecret = $authSecret
  Write-Host "Güvenli AUTH_SECRET bulundu; SESSION_SECRET olarak da kullanılacak." -ForegroundColor Green
}
else {
  $effectiveSecret = New-SessionSecret
  Write-Host "Yeni güçlü SESSION_SECRET oluşturuldu." -ForegroundColor Green
}

$secretLine = "SESSION_SECRET=$effectiveSecret"
$secretPattern = New-Object System.Text.RegularExpressions.Regex("(?m)^\s*SESSION_SECRET\s*=.*$")

if ($secretPattern.IsMatch($existingContent)) {
  $updatedContent = $secretPattern.Replace($existingContent, $secretLine, 1)
}
else {
  $separator = if ([string]::IsNullOrEmpty($existingContent) -or $existingContent.EndsWith("`n")) { "" } else { "`r`n" }
  $updatedContent = $existingContent + $separator + "`r`n# Signed admin / TV / driver sessions`r`n" + $secretLine + "`r`n"
}

Write-Utf8NoBom -Path $envLocal -Content $updatedContent
$env:SESSION_SECRET = $effectiveSecret
Write-Host ".env.local güvenli oturum anahtarıyla hazırlandı. Değer ekrana yazdırılmadı." -ForegroundColor Green

# Yalnızca hata mesajı ayrımını düzelten tek kod dosyasını uygula.
Copy-Item -LiteralPath $payloadFile -Destination $targetFile -Force
Write-Host "Kopyalandı: app\tv\login\page.tsx" -ForegroundColor Green

Set-Location $project
Remove-Item -LiteralPath (Join-Path $project ".next") -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "TypeScript kontrolü çalışıyor..." -ForegroundColor Cyan
npm.cmd run typecheck

if ($LASTEXITCODE -ne 0) {
  Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
  Write-Host ""
  Write-Host "TYPECHECK HATALI — Kod dosyası geri alındı." -ForegroundColor Red
  Write-Host "SESSION_SECRET güvenli şekilde .env.local içinde bırakıldı." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "Production build çalışıyor..." -ForegroundColor Cyan
npm.cmd run build

if ($LASTEXITCODE -ne 0) {
  Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
  Write-Host ""
  Write-Host "BUILD HATALI — Kod dosyası geri alındı." -ForegroundColor Red
  Write-Host "SESSION_SECRET güvenli şekilde .env.local içinde bırakıldı." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "TV LOGIN OTURUM DÜZELTMESİ TAMAMLANDI ✅" -ForegroundColor Green
Write-Host "Yedek: $backupRoot" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "Şimdi çalışan npm dev terminalini CTRL+C ile kapatıp yeniden başlat:" -ForegroundColor Yellow
Write-Host 'cd "C:\Web\burger"' -ForegroundColor Cyan
Write-Host "npm.cmd run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "TV PIN: 19051905" -ForegroundColor Green
