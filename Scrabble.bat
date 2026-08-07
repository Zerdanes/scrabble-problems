@echo off
rem Lance le jeu. Une seule fenetre s'ouvre : celle du jeu.
rem Le moteur tourne sans fenetre, il s'arrete tout seul quand on quitte.
rem
rem Rien n'a besoin d'etre installe sur l'ordinateur : si Node.js n'est pas
rem present, une version portable est deposee dans le sous-dossier runtime.
cd /d "%~dp0"

rem --- 1. Trouver le moteur ---------------------------------------------------
set "NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto moteur_ok

set "NODE=%~dp0runtime\node.exe"
if exist "%NODE%" goto moteur_ok

echo.
echo   Premiere installation : recuperation du moteur du jeu.
echo   Une connexion internet est necessaire, uniquement cette fois-ci.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\installer-moteur.ps1"
if not exist "%NODE%" (
  echo.
  echo   Echec de l'installation. Verifiez la connexion internet,
  echo   puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

:moteur_ok

rem --- 2. Construire le dictionnaire au premier lancement ----------------------
if not exist "app\data\dict.bin" (
  echo.
  echo   Telechargement de la liste officielle des mots et construction
  echo   du dictionnaire. Comptez une minute.
  echo.
  "%NODE%" build\build-dict.js
  if errorlevel 1 (
    echo.
    echo   Echec. Verifiez votre connexion puis relancez ce fichier.
    echo.
    pause
    exit /b 1
  )
)

rem --- 3. Demarrer sans console ------------------------------------------------
rem Sans cela une fenetre noire resterait dans la barre des taches a cote de
rem celle du jeu.
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NODE%' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
exit
