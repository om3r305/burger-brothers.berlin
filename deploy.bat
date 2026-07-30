@echo off
title Burger Brothers Berlin - Deploy Helper
echo.
echo 1) Bu klasoru GitHub reponuza yukleyin veya VS Code ile acin.
echo 2) GitHub bagli Vercel projesi otomatik build alir.
echo 3) Domain (burger-brothers.berlin) zaten IONOS A @ -> 76.76.21.21 ile bagli olmali.
echo.
echo Git komutlari (opsiyonel):
echo    git init
echo    git add .
echo    git commit -m "Prod hazir paket - Burger Brothers Berlin"
echo    git branch -M main
echo    git remote add origin YOUR_GITHUB_REPO_URL
echo    git push -u origin main
echo.
pause
