# Vitre launcher (PowerShell form). Same behaviour as Vitre.cmd / Vitre.exe.
#   powershell -NoProfile -ExecutionPolicy Bypass -File Vitre.ps1 [url or firefox arguments...]
$home_ = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = $env:VITRE_PROFILE
if (-not $profileDir) { $profileDir = Join-Path $env:APPDATA 'Vitre\Profile' }
New-Item -ItemType Directory -Force $profileDir | Out-Null
$env:MOZ_CRASHREPORTER_DISABLE = '1'
if ($env:VITRE_APP_INI) { $env:XUL_APP_FILE = $env:VITRE_APP_INI }
$argList = @('-profile', ('"{0}"' -f $profileDir)) + $args
Start-Process -FilePath (Join-Path $home_ 'runtime\firefox.exe') -ArgumentList $argList
