' Lance exactement la meme chose que Scrabble.bat, mais sans le bref
' clignotement de la console au demarrage.
'
' Si Windows bloque les fichiers .vbs (certaines politiques d'entreprise le
' font), utilisez Scrabble.bat : le resultat est identique.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dossier = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dossier
shell.Run """" & fso.BuildPath(dossier, "Scrabble.bat") & """", 0, False
