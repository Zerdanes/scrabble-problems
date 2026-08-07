# Cree un raccourci "Scrabble - Le Defi" sur le Bureau.
# A lancer une seule fois : clic droit sur ce fichier > Executer avec PowerShell.

$source = Join-Path $PSScriptRoot 'Scrabble.bat'
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'Scrabble - Le Defi.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $source
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Entrainement au Scrabble : problemes, dictionnaire ODS'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
$shortcut.Save()

Write-Host "Raccourci cree : $link"
