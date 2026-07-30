$src = "C:\Web\burger-seasonal-theme-pro"
$dst = "C:\Web\burger"

$files = @(
  "lib\themes.ts",
  "lib\settings.ts",
  "components\SeasonalThemeEditor.tsx",
  "app\admin\settings\page.tsx",
  "app\api\settings\route.ts",
  "app\theme-client.tsx",
  "app\layout.tsx",
  "app\globals.css",
  "app\page.tsx"
)

foreach ($file in $files) {
  $sourceFile = Join-Path $src $file
  $targetFile = Join-Path $dst $file
  New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force | Out-Null
  Copy-Item $sourceFile $targetFile -Force
}

Write-Host "Tema sistemi C:\Web\burger içine kopyalandı." -ForegroundColor Green
