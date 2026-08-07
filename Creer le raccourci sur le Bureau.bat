@echo off
rem Pose un raccourci "Scrabble - Le Defi" sur le Bureau, avec l'icone du jeu.
rem A lancer une seule fois. Ce n'est pas le lanceur du jeu : pour jouer, c'est
rem Scrabble.bat.
rem
rem Ce fichier est un .bat et non un .ps1 : Windows n'associe aucun programme
rem aux .ps1 par defaut, un double-clic dessus n'aurait rien lance.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable. Installez-le depuis https://nodejs.org
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $here='%~dp0'; $ico=Join-Path $here 'app\icon.ico'; if (-not (Test-Path $ico)) { node (Join-Path $here 'build\make-icon.js') | Out-Null }; $lnk=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Scrabble - Le Defi.lnk'; $sc=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $sc.TargetPath=(Join-Path $here 'Scrabble.bat'); $sc.WorkingDirectory=$here; $sc.Description='Entrainement au Scrabble : problemes et dictionnaire ODS'; $sc.WindowStyle=7; if (Test-Path $ico) { $sc.IconLocation=($ico + ',0') }; $sc.Save(); Write-Host ''; Write-Host ('  Raccourci cree sur le Bureau : ' + $lnk)"

echo.
echo   Vous pouvez fermer cette fenetre.
echo.
pause
