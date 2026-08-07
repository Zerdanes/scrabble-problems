@echo off
rem Pose le raccourci du jeu sur le Bureau. A lancer une seule fois.
rem Ce n'est pas le lanceur du jeu : pour jouer, c'est Scrabble.bat.
rem
rem Ce fichier est un .bat et non un .ps1 : Windows n'associe aucun programme
rem aux .ps1 par defaut, un double-clic dessus n'aurait rien lance.
rem
rem L'icone est fournie avec le jeu : ce script n'a besoin que de Windows.

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\poser-raccourci.ps1"

echo.
echo   Vous pouvez fermer cette fenetre.
echo.
pause
