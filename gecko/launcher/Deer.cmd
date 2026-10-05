@echo off
rem Deer, development launcher (script form): runs launcher\Deer.exe (launcher\Launcher.cs), building
rem it first when it is missing (node tools\build-launcher.mjs; rebuild it by hand after changing
rem Launcher.cs or installer\ProfileMigration.cs).
rem   Deer.cmd                 start Deer, or open a window in the instance that is already running
rem   Deer.cmd https://...     open the URL (handed to the running instance: one instance per profile)
rem   Deer.cmd -private-window
rem
rem Deer.exe always passes -profile with Deer's development profile, %LOCALAPPDATA%\Deer Dev\Profile
rem (copied from the old %LOCALAPPDATA%\Vitre\Profile on first use; never the installed Deer's
rem %LOCALAPPDATA%\Deer\Profile), so the runtime never looks at the user's Firefox (%APPDATA%\Mozilla);
rem DEER_PROFILE (or the older VITRE_PROFILE) names another folder (tests).
rem Exit codes are Deer.exe's: 0 started, 1 bad -osint shape, 2 runtime or package missing (or the
rem launcher could not be built), 3 any other failure.
setlocal
if not exist "%~dp0Deer.exe" (
  node "%~dp0..\tools\build-launcher.mjs" >nul || (
    echo Deer: launcher\Deer.exe is missing and could not be built. Run: node tools\build-launcher.mjs
    exit /b 2
  )
)
"%~dp0Deer.exe" %*
if errorlevel 3 exit /b 3
if errorlevel 2 (
  echo Deer: runtime\vitre.exe or the chrome package is missing. Run: python tools\setup-runtime.py, then node tools\build.mjs
  exit /b 2
)
if errorlevel 1 exit /b 1
exit /b 0
