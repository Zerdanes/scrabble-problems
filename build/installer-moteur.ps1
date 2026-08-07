# Recupere le moteur Node.js sous forme portable, dans runtime\node.exe.
#
# Le jeu tourne sur Node, mais on ne veut pas demander a l'utilisateur
# d'installer quoi que ce soit : pas d'installateur, pas de droits
# administrateur, rien d'ajoute au PATH. On telecharge donc l'archive officielle
# et on en extrait le seul fichier utile, dans le dossier du jeu.
#
# Appele par Scrabble.bat, jamais directement.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # sinon Invoke-WebRequest est tres lent

$racine = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $racine 'runtime'
$cible = Join-Path $runtime 'node.exe'

if (Test-Path $cible) {
  Write-Host "  Moteur deja present."
  exit 0
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'ARM64' { 'arm64' }
  'x86'   { 'x86' }
  default { 'x64' }
}

Write-Host "  Recherche de la derniere version stable..."
$catalogue = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -TimeoutSec 60
# Les versions au support long terme portent un nom de code ; les autres ont
# `lts: false`. Le test sur le type est donc plus sur qu'un test de verite.
$derniere = @($catalogue | Where-Object { $_.lts -is [string] })[0]
if (-not $derniere) { throw "Aucune version stable trouvee sur nodejs.org." }

$version = $derniere.version
$nom = "node-$version-win-$arch"
$url = "https://nodejs.org/dist/$version/$nom.zip"

New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$zip = Join-Path $runtime "$nom.zip"

Write-Host "  Telechargement de $version ($arch), environ 36 Mo..."
# curl.exe est fourni avec Windows et affiche une progression lisible.
& curl.exe -L --fail --silent --show-error -o $zip $url
if ($LASTEXITCODE -ne 0) { throw "Telechargement impossible. Verifiez la connexion internet." }

# On telecharge un executable : on verifie qu'il correspond bien a ce que
# nodejs.org publie avant de le lancer.
Write-Host "  Verification de l'empreinte..."
$sommes = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing -TimeoutSec 60).Content
$attendue = ($sommes -split "`n" | Where-Object { $_ -match [regex]::Escape("$nom.zip") } | Select-Object -First 1).Split(' ')[0]
$obtenue = (Get-FileHash $zip -Algorithm SHA256).Hash

if (-not $attendue) { throw "Empreinte de reference introuvable." }
if ($obtenue -ne $attendue.ToUpper()) {
  Remove-Item $zip -Force
  throw "Empreinte incorrecte : fichier corrompu ou altere. Rien n'a ete installe."
}

Write-Host "  Extraction..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  # Une seule entree nous interesse : l'archive complete pese 80 Mo decompressee.
  $entree = $archive.Entries | Where-Object { $_.FullName -eq "$nom/node.exe" }
  if (-not $entree) { throw "node.exe introuvable dans l'archive." }
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entree, $cible, $true)
} finally {
  $archive.Dispose()
}

Remove-Item $zip -Force
$taille = [math]::Round((Get-Item $cible).Length / 1MB, 0)
Write-Host "  Moteur installe ($taille Mo), dans le dossier du jeu."
