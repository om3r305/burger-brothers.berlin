#requires -version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Source = $PSScriptRoot
$Repo = 'C:\Web\burger-github'
$ExpectedRemote = 'om3r305/burger-brothers.berlin'
$CommitMessage = 'feat: add secure mobile Schnellbestellung QR channel'
$Changed = @(
'app/admin/AdminShell.tsx','app/admin/schnellbestellung/page.tsx','app/api/admin/schnellbestellung/route.ts',
'app/api/schnellbestellung/access-token/route.ts','app/api/schnellbestellung/catalog/route.ts','app/api/schnellbestellung/location/verify/route.ts','app/api/schnellbestellung/orders/route.ts','app/api/schnellbestellung/session/route.ts',
'app/api/orders/status/route.ts','app/api/print/jobs/route.ts','app/schnellbestellung/access-display/page.tsx','app/schnellbestellung/enter/page.tsx','app/schnellbestellung/page.tsx','app/schnellbestellung/success/page.tsx',
'components/schnellbestellung/SchnellClient.tsx','components/tv/OrderCard.tsx','lib/server/schnellbestellung.ts','print-proxy/index.cjs','tools/schnellbestellung-regression-tests.cjs','types/tv.ts','package.json',
'README-SCHNELLBESTELLUNG.md','VERIFY-SCHNELLBESTELLUNG.md','CHANGED-FILES-SCHNELLBESTELLUNG.txt'
)
function Run([string]$File,[string[]]$Args,[string]$At=$Repo){Push-Location $At;try{& $File @Args;if($LASTEXITCODE -ne 0){throw "$File failed: $LASTEXITCODE"}}finally{Pop-Location}}
if(-not(Test-Path -LiteralPath $Source)){throw "Source missing: $Source"}
if(-not(Test-Path -LiteralPath $Repo)){throw "Repo missing: $Repo"}
if(-not(Test-Path -LiteralPath (Join-Path $Repo '.git'))){throw 'Repo .git missing. git init will not be used.'}
$remote=(& git -C $Repo remote get-url origin 2>$null)
if($LASTEXITCODE -ne 0 -or $remote -notmatch [regex]::Escape($ExpectedRemote)){throw "Wrong remote: $remote"}
$dirty=& git -C $Repo status --porcelain
if($dirty){throw "Repo is dirty. Commit/stash existing changes first.`n$($dirty -join "`n")"}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$Backup=Join-Path $env:TEMP "bb-schnell-backup-$stamp";New-Item -ItemType Directory -Path $Backup -Force|Out-Null
try{
 foreach($rel in $Changed){$src=Join-Path $Source ($rel -replace '/','\');if(-not(Test-Path -LiteralPath $src)){throw "Missing source file: $rel"};$dst=Join-Path $Repo ($rel -replace '/','\');$bak=Join-Path $Backup ($rel -replace '/','\');if(Test-Path -LiteralPath $dst){New-Item -ItemType Directory -Path (Split-Path $bak) -Force|Out-Null;Copy-Item $dst $bak -Force};New-Item -ItemType Directory -Path (Split-Path $dst) -Force|Out-Null;Copy-Item $src $dst -Force}
 $forbidden=Get-ChildItem $Repo -Recurse -Force -File|Where-Object{$_.Name -in @('.env','.env.local','.env.production')};if($forbidden){throw 'Forbidden environment file detected in repository.'}
 Remove-Item (Join-Path $Repo '.next') -Recurse -Force -ErrorAction SilentlyContinue;Remove-Item (Join-Path $Repo 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue
 if(-not(Test-Path (Join-Path $Repo 'node_modules'))){Run 'npm.cmd' @('ci')}
 Run 'npx.cmd' @('prisma','generate');Run 'npm.cmd' @('run','typecheck');Run 'npm.cmd' @('run','schnell:test');Run 'npm.cmd' @('run','security:test');Run 'npm.cmd' @('run','build')
 foreach($rel in $Changed){Run 'git' @('add','--',$rel)}
 Run 'git' @('diff','--cached','--check')
 $cached=& git -C $Repo diff --cached --name-only;if(-not $cached){throw 'No staged changes.'}
 Run 'git' @('commit','-m',$CommitMessage)
 $branch=(& git -C $Repo branch --show-current).Trim();$hash=(& git -C $Repo rev-parse HEAD).Trim()
 try{Run 'git' @('push','origin',$branch)}catch{Write-Host "Commit created but push failed. Retry: git -C `"$Repo`" push origin $branch" -ForegroundColor Yellow;throw}
 Write-Host "SUCCESS branch=$branch commit=$hash" -ForegroundColor Green
}catch{
 if(-not(& git -C $Repo rev-parse HEAD 2>$null)){ }
 & git -C $Repo reset --hard HEAD | Out-Null
 foreach($rel in $Changed){$bak=Join-Path $Backup ($rel -replace '/','\');$dst=Join-Path $Repo ($rel -replace '/','\');if(Test-Path $bak){New-Item -ItemType Directory -Path (Split-Path $dst) -Force|Out-Null;Copy-Item $bak $dst -Force}}
 throw
}finally{Remove-Item $Backup -Recurse -Force -ErrorAction SilentlyContinue}
