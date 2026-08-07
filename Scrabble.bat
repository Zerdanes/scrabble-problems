@echo off
rem Lance le jeu. La fenetre noire se reduit toute seule dans la barre des taches
rem et se ferme quand on quitte le jeu.
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

start "Scrabble - Le Defi" /min cmd /c node server.js
exit
