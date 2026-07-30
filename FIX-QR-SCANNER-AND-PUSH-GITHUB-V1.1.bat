@echo off
setlocal
cd /d "%~dp0"

echo.
echo Burger Brothers qr-scanner duzeltmesi uygulanacak,
echo test ve build calistirilacak, sonra GitHub main branch'ine gonderilecek.
echo.
echo NOT: git init calistirilmaz. .env ve secret dosyalari kopyalanmaz.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIX-QR-SCANNER-AND-PUSH-GITHUB-V1.1.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo Islem tamamlandi.
) else if "%EXITCODE%"=="2" (
    echo Commit kullanici tarafindan iptal edildi.
) else (
    echo Islem hata ile durdu.
)
echo.
pause
exit /b %EXITCODE%
