@echo off
setlocal
cd /d "%~dp0"
echo.
echo Burger Brothers genel bildirim sistemi test edilip GitHub main branch'ine gonderilecek.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0PUSH-GENERAL-NOTIFICATIONS-TO-GITHUB.ps1"
set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" (
  echo GitHub islemi tamamlandi.
) else if "%EXITCODE%"=="2" (
  echo Commit kullanici tarafindan iptal edildi.
) else (
  echo Islem hata ile durdu.
)
echo.
pause
exit /b %EXITCODE%
