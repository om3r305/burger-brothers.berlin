@echo off
setlocal
title Burger Brothers Schnellbestellung iOS Push Prompt V7.1

set "SCRIPT=C:\Web\burger\PUSH-SCHNELL-IOS-PUSH-PROMPT-V7.1-TO-GITHUB.ps1"

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
    echo ISLEM HATA ILE DURDU.
) else (
    echo ISLEM TAMAMLANDI.
)
echo.
pause
exit /b %EXITCODE%
