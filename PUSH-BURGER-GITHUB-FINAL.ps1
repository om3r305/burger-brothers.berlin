#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SourceRoot = "C:\Web\burger",
    [string]$GitRoot = "C:\Web\burger-github",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Text)
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function ConvertTo-NativeArgument {
    param([AllowEmptyString()][string]$Value)

    if ($null -eq $Value -or $Value.Length -eq 0) {
        return '""'
    }

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashCount = 0

    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashCount++
            continue
        }

        if ($character -eq '"') {
            if ($backslashCount -gt 0) {
                [void]$builder.Append(('\' * ($backslashCount * 2)))
            }
            [void]$builder.Append('\\"')
            $backslashCount = 0
            continue
        }

        if ($backslashCount -gt 0) {
            [void]$builder.Append(('\' * $backslashCount))
            $backslashCount = 0
        }

        [void]$builder.Append($character)
    }

    if ($backslashCount -gt 0) {
        [void]$builder.Append(('\' * ($backslashCount * 2)))
    }

    [void]$builder.Append('"')
    return $builder.ToString()
}

function Join-NativeArguments {
    param([string[]]$Arguments = @())

    return (($Arguments | ForEach-Object {
        ConvertTo-NativeArgument -Value ([string]$_)
    }) -join " ")
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = ""
    )

    if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
        $WorkingDirectory = (Get-Location).Path
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = Join-NativeArguments -Arguments $Arguments
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo

    try {
        if (-not $process.Start()) {
            throw "Komut baslatilamadi: $FilePath"
        }

        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()

        $process.WaitForExit()

        $stdout = [string]$stdoutTask.Result
        $stderr = [string]$stderrTask.Result
        $exitCode = $process.ExitCode

        if (-not [string]::IsNullOrEmpty($stdout)) {
            [Console]::Out.Write($stdout)
        }

        if ($exitCode -ne 0) {
            throw "Komut hata verdi ($exitCode): $FilePath $($Arguments -join ' ')`n$stderr"
        }

        if (-not [string]::IsNullOrWhiteSpace($stderr)) {
            Write-Host $stderr.TrimEnd() -ForegroundColor DarkYellow
        }

        return $stdout
    }
    finally {
        $process.Dispose()
    }
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$FullPath
    )

    return $FullPath.Substring($Root.Length).TrimStart("\", "/").Replace("\", "/")
}

function Test-SafeSourceFile {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $path = $RelativePath.Replace("\", "/")
    $lower = $path.ToLowerInvariant()
    $name = [System.IO.Path]::GetFileName($lower)

    $blockedDirectories = @(
        ".git/",
        "node_modules/",
        ".next/",
        ".vercel/",
        "coverage/",
        "logs/",
        "tmp/",
        "temp/"
    )

    foreach ($blocked in $blockedDirectories) {
        if ($lower.StartsWith($blocked) -or $lower.Contains("/$blocked")) {
            return $false
        }
    }

    if ($name -eq ".env" -or $name.StartsWith(".env.")) {
        return $false
    }

    if ($name -match '\.(pem|key|p12|pfx|jks|keystore|db|sqlite|sqlite3|zip|zipchunk)$') {
        return $false
    }

    if ($name -match '^push-burger-github-final.*\.ps1$') {
        return $false
    }

    if ($name -match '^burger-brothers-github-publish.*\.ps1$') {
        return $false
    }

    if ($name -match '\.sha256\.txt$') {
        return $false
    }

    return $true
}

function Import-DotEnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return 0
    }

    $count = 0

    foreach ($rawLine in [System.IO.File]::ReadAllLines($Path)) {
        $line = $rawLine.Trim()

        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }

        if ($line.StartsWith("export ")) {
            $line = $line.Substring(7).Trim()
        }

        $separator = $line.IndexOf("=")
        if ($separator -le 0) {
            continue
        }

        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()

        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            continue
        }

        if ($value.Length -ge 2) {
            $first = $value[0]
            $last = $value[$value.Length - 1]

            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        [Environment]::SetEnvironmentVariable(
            $name,
            $value,
            [EnvironmentVariableTarget]::Process
        )

        $count++
    }

    return $count
}

function Import-SourceEnvironment {
    param([Parameter(Mandatory = $true)][string]$Root)

    $files = @(
        ".env",
        ".env.production",
        ".env.local",
        ".env.production.local"
    )

    $total = 0

    foreach ($file in $files) {
        $path = Join-Path $Root $file
        $loaded = Import-DotEnvFile -Path $path

        if ($loaded -gt 0) {
            Write-Host "  Yuklendi: $file ($loaded kayit, degerler gizli)"
            $total += $loaded
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
        throw "DATABASE_URL bulunamadi. C:\Web\burger icindeki .env veya .env.local dosyasini kontrol et."
    }

    return $total
}

function Apply-AfterResponseFix {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$NodeExe
    )

    $tempScript = Join-Path $env:TEMP ("bb-after-fix-" + [Guid]::NewGuid().ToString("N") + ".cjs")

    $nodeScript = @'
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2]);
const apiRoot = path.join(root, "app", "api");
const helperPath = path.join(root, "lib", "server", "after-response.ts");

const helper = `import { after } from "next/server";

type AfterResponseTask = () => void | Promise<void>;

function isMissingRequestScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("called outside a request scope") ||
    message.includes("next-dynamic-api-wrong-context")
  );
}

export function runAfterResponse(task: AfterResponseTask): void {
  const guardedTask = async () => {
    try {
      await task();
    } catch (error) {
      console.error("[after-response] background task failed", error);
    }
  };

  try {
    after(guardedTask);
  } catch (error) {
    if (!isMissingRequestScopeError(error)) {
      throw error;
    }

    void Promise.resolve().then(guardedTask);
  }
}
`;

fs.mkdirSync(path.dirname(helperPath), { recursive: true });
if (!fs.existsSync(helperPath) || fs.readFileSync(helperPath, "utf8").replace(/\r\n/g, "\n") !== helper) {
  fs.writeFileSync(helperPath, helper, "utf8");
  console.log("FIXED lib/server/after-response.ts");
}

function walk(directory) {
  const output = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      output.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name === "route.ts") {
      output.push(fullPath);
    }
  }

  return output;
}

if (!fs.existsSync(apiRoot)) {
  throw new Error(`API directory not found: ${apiRoot}`);
}

let changedRoutes = 0;
let changedCalls = 0;

for (const file of walk(apiRoot)) {
  let source = fs.readFileSync(file, "utf8");
  const original = source;

  const callPattern = /\bafter\s*\(\s*async\s*\(\s*\)\s*=>\s*\{/g;
  const matches = source.match(callPattern);

  if (!matches || matches.length === 0) {
    continue;
  }

  const importPattern = /import\s*\{\s*([^}]*)\s*\}\s*from\s*["']next\/server["'];?/;
  const importMatch = source.match(importPattern);

  if (!importMatch) {
    throw new Error(`next/server import not found: ${path.relative(root, file)}`);
  }

  const members = importMatch[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== "after");

  const replacementImport =
    members.length > 0
      ? `import { ${members.join(", ")} } from "next/server";`
      : "";

  source = source.replace(importPattern, replacementImport);

  const helperImport =
    'import { runAfterResponse } from "@/lib/server/after-response";';

  if (!source.includes(helperImport)) {
    if (replacementImport) {
      source = source.replace(
        replacementImport,
        `${replacementImport}\n${helperImport}`
      );
    } else {
      source = `${helperImport}\n${source}`;
    }
  }

  source = source.replace(callPattern, "runAfterResponse(async () => {");

  if (/\bafter\s*\(\s*async\s*\(\s*\)\s*=>\s*\{/.test(source)) {
    throw new Error(`raw after call remains: ${path.relative(root, file)}`);
  }

  if (source !== original) {
    fs.writeFileSync(file, source, "utf8");
    changedRoutes++;
    changedCalls += matches.length;
    console.log(
      `FIXED ${path.relative(root, file).replace(/\\/g, "/")} (${matches.length} call)`
    );
  }
}

console.log(`AFTER_FIX_OK routes=${changedRoutes} calls=${changedCalls}`);
'@

    try {
        [System.IO.File]::WriteAllText(
            $tempScript,
            $nodeScript,
            (New-Object System.Text.UTF8Encoding($false))
        )

        Invoke-Native `
            -FilePath $NodeExe `
            -Arguments @($tempScript, $Root) `
            -WorkingDirectory $Root | Out-Null
    }
    finally {
        Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
    }
}

$source = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd("\")
$repository = [System.IO.Path]::GetFullPath($GitRoot).TrimEnd("\")

if ($Branch -cne "main") {
    throw "Bu script yalniz main branch icin calisir."
}

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Kaynak klasor bulunamadi: $source"
}

if (-not (Test-Path -LiteralPath $repository -PathType Container)) {
    throw "GitHub klon klasoru bulunamadi: $repository"
}

if (-not (Test-Path -LiteralPath (Join-Path $source "package.json") -PathType Leaf)) {
    throw "Kaynak package.json bulunamadi."
}

if (-not (Test-Path -LiteralPath (Join-Path $repository ".git") -PathType Container)) {
    throw "C:\Web\burger-github bir Git klonu degil. Bu klasor mevcut klon olmalidir."
}

$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $gitCommand) {
    $gitCommand = Get-Command git -ErrorAction Stop
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction Stop
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction Stop
}

$gitExe = $gitCommand.Source
$npmExe = $npmCommand.Source
$nodeExe = $nodeCommand.Source

Write-Step "GitHub klonu temizleniyor ve origin main ile esitleniyor"

$origin = (Invoke-Native `
    -FilePath $gitExe `
    -Arguments @("remote", "get-url", "origin") `
    -WorkingDirectory $repository).Trim()

if ($origin -notmatch '(?i)(^|[:/])om3r305/burger-brothers\.berlin(?:\.git)?$') {
    throw "Yanlis GitHub origin bulundu: $origin"
}

Invoke-Native -FilePath $gitExe -Arguments @("fetch", "origin", $Branch) -WorkingDirectory $repository | Out-Null
Invoke-Native -FilePath $gitExe -Arguments @("checkout", $Branch) -WorkingDirectory $repository | Out-Null
Invoke-Native -FilePath $gitExe -Arguments @("reset", "--hard", "origin/$Branch") -WorkingDirectory $repository | Out-Null
Invoke-Native -FilePath $gitExe -Arguments @("clean", "-fd") -WorkingDirectory $repository | Out-Null

Write-Step "Next.js after request-scope duzeltmesi uygulanıyor"
Apply-AfterResponseFix -Root $source -NodeExe $nodeExe

Write-Step "Yalniz yeni veya icerigi degisen guvenli dosyalar kopyalaniyor"

$copied = New-Object System.Collections.Generic.List[string]
$sourceFiles = Get-ChildItem -LiteralPath $source -Recurse -File -Force |
    Where-Object {
        -not ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    }

foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath -Root $source -FullPath $file.FullName

    if (-not (Test-SafeSourceFile -RelativePath $relative)) {
        continue
    }

    $destination = Join-Path $repository ($relative.Replace("/", "\"))
    $copyRequired = -not (Test-Path -LiteralPath $destination -PathType Leaf)

    if (-not $copyRequired) {
        $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        $copyRequired = $sourceHash -ne $destinationHash
    }

    if ($copyRequired) {
        $destinationDirectory = Split-Path -Parent $destination

        if (-not (Test-Path -LiteralPath $destinationDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        }

        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        $copied.Add($relative)
        Write-Host "  COPY $relative"
    }
}

Write-Host ""
Write-Host "Kopyalanan dosya sayisi: $($copied.Count)" -ForegroundColor Green

if ($copied.Count -eq 0) {
    Write-Host "Kaynak ile GitHub klonu zaten ayni. Push edilecek degisiklik yok." -ForegroundColor Yellow
    exit 0
}

Write-Step "Kaynak env degerleri yalniz bu PowerShell isleminin bellegine yukleniyor"
$loadedEnvironmentCount = Import-SourceEnvironment -Root $source
Write-Host "  Yuklenen toplam env kaydi: $loadedEnvironmentCount"
Write-Host "  Env dosyalari GitHub klasorune kopyalanmadi." -ForegroundColor DarkGray

Write-Step "Temiz npm kurulumu"
Invoke-Native -FilePath $npmExe -Arguments @("ci", "--no-audit", "--no-fund") -WorkingDirectory $repository | Out-Null

$packageJson = Get-Content -LiteralPath (Join-Path $repository "package.json") -Raw | ConvertFrom-Json
$scriptNames = @($packageJson.scripts.PSObject.Properties.Name)

$requiredScripts = @(
    "prisma:generate",
    "typecheck",
    "security:test",
    "schnell:test",
    "notifications:test",
    "build"
)

foreach ($requiredScript in $requiredScripts) {
    if ($scriptNames -notcontains $requiredScript) {
        throw "Zorunlu npm scripti bulunamadi: $requiredScript"
    }
}

Write-Step "Prisma Client uretiliyor"
Invoke-Native -FilePath $npmExe -Arguments @("run", "prisma:generate") -WorkingDirectory $repository | Out-Null

Write-Step "TypeScript kontrolu"
Invoke-Native -FilePath $npmExe -Arguments @("run", "typecheck") -WorkingDirectory $repository | Out-Null

if ($scriptNames -contains "test") {
    Write-Step "Genel test paketi"
    Invoke-Native -FilePath $npmExe -Arguments @("test") -WorkingDirectory $repository | Out-Null
}

Write-Step "Guvenlik ve regresyon testleri"
Invoke-Native -FilePath $npmExe -Arguments @("run", "security:test") -WorkingDirectory $repository | Out-Null
Invoke-Native -FilePath $npmExe -Arguments @("run", "schnell:test") -WorkingDirectory $repository | Out-Null
Invoke-Native -FilePath $npmExe -Arguments @("run", "notifications:test") -WorkingDirectory $repository | Out-Null

Write-Step "Production build"
Invoke-Native -FilePath $npmExe -Arguments @("run", "build") -WorkingDirectory $repository | Out-Null

Write-Step "Yalniz kopyalanan dosyalar stage ediliyor"

foreach ($relative in $copied) {
    Invoke-Native `
        -FilePath $gitExe `
        -Arguments @("add", "--", $relative) `
        -WorkingDirectory $repository | Out-Null
}

Invoke-Native -FilePath $gitExe -Arguments @("diff", "--cached", "--check") -WorkingDirectory $repository | Out-Null

$stagedText = Invoke-Native `
    -FilePath $gitExe `
    -Arguments @("diff", "--cached", "--name-only") `
    -WorkingDirectory $repository

$staged = @(
    $stagedText -split '\r?\n' |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

if ($staged.Count -eq 0) {
    Write-Host "Git acisindan commit edilecek fark kalmadi." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Stage edilen dosyalar:" -ForegroundColor White
$staged | ForEach-Object { Write-Host "  $_" }

Invoke-Native `
    -FilePath $gitExe `
    -Arguments @("diff", "--cached", "--stat") `
    -WorkingDirectory $repository | Out-Null

$commitMessage = Read-Host "Commit mesaji (bos birakirsan varsayilan kullanilir)"

if ([string]::IsNullOrWhiteSpace($commitMessage)) {
    $commitMessage = "feat: complete automatic web push notifications"
}

Write-Host ""
Write-Host "Prisma generate, typecheck, testler ve production build BASARILI." -ForegroundColor Green

$approval = Read-Host "Commit ve GitHub main push icin EVET yaz"

if ($approval -cne "EVET") {
    Invoke-Native `
        -FilePath $gitExe `
        -Arguments @("reset", "--quiet") `
        -WorkingDirectory $repository | Out-Null

    Write-Host "Iptal edildi. Commit ve push yapilmadi." -ForegroundColor Yellow
    exit 0
}

Write-Step "Commit olusturuluyor"
Invoke-Native `
    -FilePath $gitExe `
    -Arguments @("commit", "-m", $commitMessage) `
    -WorkingDirectory $repository | Out-Null

Write-Step "GitHub main branch push"
Invoke-Native `
    -FilePath $gitExe `
    -Arguments @("push", "origin", "HEAD:$Branch") `
    -WorkingDirectory $repository | Out-Null

Write-Host ""
Write-Host "TAMAMLANDI: om3r305/burger-brothers.berlin main branch guncellendi." -ForegroundColor Green
