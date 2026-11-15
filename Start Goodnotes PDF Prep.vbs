Option Explicit

Dim shell
Dim scriptPath
Dim command

Set shell = CreateObject("WScript.Shell")

scriptPath = "C:\Users\xande\Documents\GitHub\goodnotes-pdf-prep\Start-Goodnotes-App.ps1"

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"

shell.Run command, 0, False