@echo off
setlocal
title Burger Brothers Schnellbestellung Final V3 GitHub Push

set "SCRIPT=C:\Web\burger\PUSH-SCHNELLBESTELLUNG-FINAL-V3-TO-GITHUB.ps1"

if not exist "%SCRIPT%" (
    echo.
    echo HATA: PowerShell dosyasi bulunamadi:
    echo %SCRIPT%
    echo.
    pause
    exit /b 1
)

echo PowerShell 5.1 parser kontrolu yapiliyor...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile('%SCRIPT%', [ref]$tokens, [ref]$errors) ^| Out-Null; if ($errors.Count -gt 0) { $errors ^| ForEach-Object { Write-Host ($_.Extent.Text + ' : ' + $_.Message) -ForegroundColor Red }; exit 1 }"

if errorlevel 1 (
    echo.
    echo HATA: PowerShell dosyasi parser kontrolunden gecemedi.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
    echo ISLEM HATA ILE DURDU. Yukaridaki kirmizi mesaji kontrol et.
) else (
    echo ISLEM TAMAMLANDI.
)
echo.
pause
exit /b %EXITCODE%
