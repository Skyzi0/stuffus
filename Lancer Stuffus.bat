@echo off
chcp 65001 >nul
title Stuffus
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installé sur ce PC.
  echo Installer la version LTS depuis https://nodejs.org puis relancer ce fichier.
  echo.
  pause
  exit /b 1
)

rem Démarre le site (les données du jeu sont téléchargées au premier lancement) et ouvre le navigateur.
node server.js --ouvrir
echo.
pause
