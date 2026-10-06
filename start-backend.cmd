@echo off
rem Double-click to start the Atlas GIS backend. All steps live in scripts\start-backend.ps1.
rem Keep this file ASCII-only: cmd.exe parses batch files in the OEM code page.
rem Extra arguments are passed through, e.g. start-backend.cmd -ResetPassword
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-backend.ps1" -PauseOnError %*
