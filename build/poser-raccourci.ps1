# Pose le raccourci du jeu sur le Bureau.
#
# Appele par « Creer le raccourci sur le Bureau.bat », jamais directement.

$ErrorActionPreference = 'Stop'

$racine = Split-Path -Parent $PSScriptRoot
$bureau = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

# --- Le raccourci du jeu -----------------------------------------------------
$lien = Join-Path $bureau 'Scrabble - Le Defi.lnk'
$icone = Join-Path $racine 'app\icon.ico'

$raccourci = $shell.CreateShortcut($lien)
$raccourci.TargetPath = Join-Path $racine 'Scrabble.bat'
$raccourci.WorkingDirectory = $racine
$raccourci.Description = 'Entrainement au Scrabble : problemes et dictionnaire ODS'
$raccourci.WindowStyle = 7   # reduit : evite le bref clignotement de la console
if (Test-Path $icone) { $raccourci.IconLocation = "$icone,0" }
$raccourci.Save()

Write-Host ''
Write-Host "  Raccourci pose sur le Bureau : $lien"

# --- Le piege laisse par le navigateur ---------------------------------------
# Installer le jeu comme application fait deposer par Edge son propre raccourci
# sur le Bureau. Il ouvre bien la fenetre, mais ne demarre pas le moteur : on
# tombe alors sur « localhost a refuse de se connecter ». Pire, son nom
# ressemble au notre, donc on clique dessus par erreur.
#
# On l'ecarte, en le deplacant plutot qu'en le supprimant.
$suspects = Get-ChildItem $bureau -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object {
  $_.FullName -ne $lien -and $_.BaseName -like '*crabble*'
}

foreach ($suspect in $suspects) {
  $cible = $shell.CreateShortcut($suspect.FullName)
  if ($cible.TargetPath -notlike '*msedge*.exe') { continue }

  # Range hors du dossier du jeu : ce raccourci ne vaut que pour ce profil et
  # cette machine, alors que le dossier est fait pour etre copie ailleurs.
  $garde = Join-Path $env:LOCALAPPDATA 'ScrabbleDefi'
  New-Item -ItemType Directory -Force -Path $garde | Out-Null
  Move-Item $suspect.FullName (Join-Path $garde $suspect.Name) -Force
  Write-Host ''
  Write-Host "  Ecarte : $($suspect.Name)"
  Write-Host '    Ce raccourci avait ete cree par le navigateur. Il ouvrait la'
  Write-Host '    fenetre sans demarrer le moteur du jeu, donc une page d''erreur.'
  Write-Host "    Il est range dans $garde, rien n'est perdu."
}

Write-Host ''
Write-Host '  Utilisez desormais l''icone du Bureau pour jouer.'
