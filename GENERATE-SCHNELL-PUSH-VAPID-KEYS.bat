@echo off
setlocal
title Burger Brothers Schnellbestellung VAPID Keys
cd /d C:\Web\burger

echo.
echo ============================================================
echo  SCHNELLBESTELLUNG VAPID KEY OLUSTURMA
echo ============================================================
echo.
echo DİKKAT: VAPID_PRIVATE_KEY gizlidir. GitHub'a veya sohbete koymayin.
echo.

npm.cmd run schnell:vapid
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo HATA: Key olusturma basarisiz oldu.
) else (
  echo Yukaridaki 3 degeri Vercel Environment Variables alanina ekleyin.
  echo Sonra Production redeploy yapin.
)
echo.
pause
exit /b %EXITCODE%
