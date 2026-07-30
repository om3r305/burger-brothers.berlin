@echo off
setlocal
title Burger Brothers Schnellbestellung Complete V2 GitHub Push

set "SCRIPT=C:\Web\burger\PUSH-SCHNELLBESTELLUNG-COMPLETE-V2-TO-GITHUB.ps1"

if not exist "%SCRIPT%" (
    echo.
    echo HATA: PowerShell dosyasi bulunamadi:
    echo %SCRIPT%
    echo.
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
