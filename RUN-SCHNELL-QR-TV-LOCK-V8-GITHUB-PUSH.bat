@echo off
setlocal
title Burger Brothers Schnell QR + TV Lock V8

set "SCRIPT=C:\Web\burger\PUSH-SCHNELL-QR-TV-LOCK-V8-TO-GITHUB.ps1"

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
