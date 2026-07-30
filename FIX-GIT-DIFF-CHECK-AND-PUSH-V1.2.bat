@echo off
setlocal
cd /d "%~dp0"

echo.
echo Burger Brothers Git whitespace duzeltmesi uygulanacak.
echo schema.prisma EOF hatasi giderilecek, typecheck/build calisacak
echo ve degisiklikler onaydan sonra GitHub'a gonderilecek.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIX-GIT-DIFF-CHECK-AND-PUSH-V1.2.ps1"
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
