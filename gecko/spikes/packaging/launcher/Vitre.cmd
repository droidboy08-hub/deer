@echo off
rem Vitre launcher (script form). Lives next to runtime\ . A console window flashes; Vitre.exe
rem (launcher\Launcher.cs) does the same without one.
rem   Vitre.cmd                 start Vitre (or focus/open a window in the running instance)
rem   Vitre.cmd https://...     open the URL in the running instance (single instance per profile)
setlocal
if not defined VITRE_PROFILE set "VITRE_PROFILE=%APPDATA%\Vitre\Profile"
if not exist "%VITRE_PROFILE%" mkdir "%VITRE_PROFILE%"
set MOZ_CRASHREPORTER_DISABLE=1
rem Optional renamed identity (must be the same for EVERY launch path, or remoting will not match):
if defined VITRE_APP_INI set "XUL_APP_FILE=%VITRE_APP_INI%"
rem No -no-remote: Gecko's remoting is keyed by profile, so this never talks to the user's Firefox.
start "" "%~dp0runtime\firefox.exe" -profile "%VITRE_PROFILE%" %*
endlocal
