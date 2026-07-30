@echo off
setlocal
title Burger Brothers Schnellbestellung Complete V2.1 GitHub Push
set "SCRIPT=C:\Web\burger\PUSH-SCHNELLBESTELLUNG-COMPLETE-V2.1-TO-GITHUB.ps1"
if not exist "%SCRIPT%" (
  echo HATA: PowerShell dosyasi bulunamadi:
  echo %SCRIPT%
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
pause
exit /b %EXITCODE%
