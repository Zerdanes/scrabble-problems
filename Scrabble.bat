@echo off
rem Lance le jeu. Une seule fenetre s'ouvre : celle du jeu.
rem Le moteur tourne sans fenetre, il s'arrete tout seul quand on quitte.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable sur cet ordinateur.
  echo   Installez-le depuis https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "app\data\dict.bin" (
  echo.
  echo   Premier lancement : telechargement de la liste officielle des mots
  echo   et construction du dictionnaire. Une connexion internet est necessaire,
  echo   uniquement cette fois-ci. Comptez une minute.
  echo.
  node build\build-dict.js
  if errorlevel 1 (
    echo.
    echo   Echec. Verifiez votre connexion puis relancez ce fichier.
    echo.
    pause
    exit /b 1
  )
)

rem Le moteur est demarre sans console : sans cela une fenetre noire resterait
rem dans la barre des taches a cote de celle du jeu.
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
exit
