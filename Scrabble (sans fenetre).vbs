' Meme chose que Scrabble.bat, mais sans aucune fenetre noire.
' Si Windows bloque les fichiers .vbs, utilisez Scrabble.bat a la place.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd /c node server.js", 0, False
