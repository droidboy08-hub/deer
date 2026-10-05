# Building Deer

Deer is a layer of privileged JavaScript, CSS and HTML (the `chrome://vitre/` package, built from
`gecko/src`) that runs inside Mozilla's Firefox engine. Building Deer means building that package
and putting it next to an engine. Nothing is compiled from Mozilla's source.

All commands below run from the `gecko` folder unless they say otherwise.

## Requirements

- 64-bit Windows. Deer is developed and tested on Windows 11.
- Node.js with npm (developed with Node.js 24). `npm ci` installs the only two build tools,
  esbuild and TypeScript.
- Python 3 (developed with 3.14), standard library only. `tools/make-icon.py` also needs Pillow.
- About 1 GB of free space for the engine.
- The .NET Framework 4 compiler (`csc.exe`) that ships with Windows, to build the launcher
  executables (`launcher\Deer.cmd` builds `launcher\Deer.exe` with it when it is missing).

## The engine

Deer is written against Firefox 157. Every Firefox internal it uses names its source file in a
comment, and those internals change between versions, so use this exact build:

| | |
|---|---|
| Build | Mozilla's unbranded Firefox 157.0 for Windows x64 (`win64-add-on-devel`, opt), build ID 20260924084938 |
| Source | <https://hg.mozilla.org/releases/mozilla-release/rev/8eb25af4acf031ab1e06abf1a912275083c820ed> |
| Download | <https://firefox-ci-tc.services.mozilla.com/api/queue/v1/task/K0so5SbiTVaKAaB0XN3Oqw/artifacts/public/build/target.zip> |
| Task index | `gecko.v2.mozilla-release.revision.8eb25af4acf031ab1e06abf1a912275083c820ed.firefox.win64-add-on-devel` |
| Size | 136,349,179 bytes |
| SHA-256 | `030804b8dbef328e10ea3357e0da806fb8f29e9bb3b93d286636d0928ee5731f` |

The unbranded build is Mozilla's own build of the release source without the Firefox name and logo
(it calls itself Nightly). It is the engine Deer's releases ship. Never use an installed Firefox:
Deer changes the engine folder it runs from.

Download the zip, check its hash, and unpack its `firefox` folder as `gecko\runtime` (PowerShell):

```
Get-FileHash .\target.zip -Algorithm SHA256
Expand-Archive .\target.zip -DestinationPath .\engine-tmp
Move-Item .\engine-tmp\firefox .\runtime
Remove-Item .\engine-tmp
```

Then wire it for Deer:

```
python tools\setup-runtime.py
```

The script copies `tools/runtime-overlay/` into the engine folder (the AutoConfig loader
`config.js`, default preferences, `distribution/policies.json` and the window icon), makes
`runtime\vitre.exe` (a copy of `firefox.exe`; Deer runs under that name) and links
`runtime\vitre` to the `build` folder. Run it again after changing the overlay or replacing the
engine; `--check` only reports what is out of date.

## Build and run

```
npm ci
node tools\build.mjs            (or: npm run build; --watch rebuilds on change)
launcher\Deer.exe               (or launcher\Deer.cmd from a console; npm start builds first)
```

The development launcher starts `runtime\vitre.exe` on the profile `%LOCALAPPDATA%\Deer Dev\Profile`
(on first use a copy of `%LOCALAPPDATA%\Vitre\Profile`, the profile from before the rename, which
is left as it is); set `DEER_PROFILE` to use another folder. It never uses the installed Deer's
profile, `%LOCALAPPDATA%\Deer\Profile`: the development engine and the release engine are different
programs (an updated release engine can be newer than `gecko\runtime`, and a newer engine's profile
cannot be opened by an older one), and uninstalling Deer with "Also delete my Deer data" deletes
`%LOCALAPPDATA%\Deer` only. An installed Deer makes its own copy of the old profile on its first
start, so after that the two profiles are separate. `launcher\Vitre.cmd` still works: it runs
`Deer.cmd`; `launcher\Vitre.exe`, on old taskbar pins, is a copy of `Deer.exe`.
Never start `runtime\firefox.exe` or `runtime\vitre.exe`
yourself: the engine must always get `-profile`, otherwise it opens the Firefox profiles in
`%APPDATA%\Mozilla`. As a second line of defence `config.js` refuses to run in a profile without
the marker file `vitre-profile`, which the launchers create.

`.sys.mjs` modules, actors and the window script are cached for the life of the process: restart
Deer to load a new build. `node tools\build-launcher.mjs` (or `npm run launcher`) compiles
`launcher\Launcher.cs` into `launcher\Deer.exe`; build it again after changing the launcher's source.

ffmpeg, yt-dlp and Deno are not part of Deer. Deer downloads them only when the person asks in
Settings > Video downloads, into `%LOCALAPPDATA%\Deer\ffmpeg` and `%LOCALAPPDATA%\Deer\tools`, and
installs them only when they match their published SHA-256. Copies downloaded before the rename, in
`%LOCALAPPDATA%\Vitre`, are used where they are. Tests never look there: `tools\run.py` points the
pref `vitre.localAppData` into each throwaway profile.

Type-check after a build (the build writes the module indexes, `_generated.ts`, that the
type-check reads):

```
npx tsc --noEmit -p .           (or: npm run typecheck)
```

## Tests

The tests start the engine on throwaway profiles in `%TEMP%`, run a script inside the browser
window and take real screenshots of it, so they need the engine in `gecko\runtime` and an
interactive Windows desktop. [gecko/SPIKES.md](../gecko/SPIKES.md) describes the harness and
[gecko/ARCHITECTURE.md](../gecko/ARCHITECTURE.md) ("Tests and captures") lists the suites.

```
python tools\run.py --test tests\core\smoke.js --name core-smoke --url https://example.com --env VITRE_SELFTEST=1 --timeout 150
python tests\core\all.py
```

The first line runs one test script (the header of each script gives its exact command); the
second runs the core suite. Each suite runner's docstring says which builds it makes and whether
it needs the network.
Captures and logs go to `out/` folders, which are not part of the repository.

## Firefox's own interface source

When code touches a Firefox internal, the ground truth is the engine's own UI source. Extract it
from the engine's `omni.ja` archives (about 116 MB, not part of the repository):

```
python tools\extract-reference.py
```

It reads `gecko\runtime` (or the newest `gecko\engines\firefox-*` folder; `--engine` picks
another) and writes `gecko\reference\omni\gre` and `gecko\reference\omni\browser`, plus
`SOURCE.txt` with the engine version and the archives' SHA-256. `--force` replaces an existing
extraction.

## Release engine and installer

A release does not use `gecko\runtime`. `tools/setup-engine.py` turns the unbranded build,
unpacked under `gecko\engines\`, into Deer's release engine folder: the same overlay, the
program renamed `deer.exe` with Deer's icon, Mozilla's updater, crash reporter, telemetry sender
and other helpers a release does not use left out, and a real copy of the chrome package. The
options are in the script's header. `gecko/installer/` holds the release launcher (`Deer.exe`)
and the installer; `python installer\build.py --engine <unbranded engine folder>` builds the
release folder and `Deer-Setup.exe` into `gecko\installer\out\` (git-ignored), and refuses an
engine that carries Firefox's branding. Its header lists the options and the files it leaves out.
`setup-engine.py` records every file of the engine it writes (size and SHA-256) in
`deer-engine.json`; `setup-engine.py --check` and `build.py` refuse an engine with a file missing,
added or changed since (an interrupted copy, a DLL an antivirus quarantined), so make the engine
again with `setup-engine.py` rather than repairing it by hand. `python installer\tests\engine_check.py`
shows what is refused.

The source of a release is the tagged commit of this repository plus the Mozilla revision
listed above for the engine.

Installed copies update from this repository's GitHub releases (`gecko/ARCHITECTURE.md`, "Updates").
For the updater to offer a release: tag it `vX.Y.Z` with the version in `gecko/package.json`, upload
`installer\out\Deer-Setup.exe` and `installer\out\SHA256SUMS.txt` from the same build as its assets,
and publish it as the latest release (not a draft or a prerelease; those are never offered). The tag
must be the setup's own version (`installer\out\build.json` "version"): the updater trusts the tag,
and a release whose setup turns out to be another version is dropped after its first install attempt
and not offered again until its setup changes. Never rename the GitHub account or the repository
without first shipping a release that points the updater (`vitre.update.repo`) at the new name.

Signing releases (do this once, before the first public release): until `gecko/update-key.txt`
exists, an installed Deer trusts whatever this repository's latest release holds, checked only
against the `SHA256SUMS.txt` beside it, so anyone who could publish a release here (a stolen account
or token, a repository name claimed after a rename) could ship an update. Make the release key once:

```
node tools\release-key.mjs new D:\offline\deer-release-key.pem
```

The private key goes to the file you name, which must be outside the repository: keep it offline and
backed up (without it, installed copies can only be updated by downloading the setup by hand). The
public half goes to `gecko/update-key.txt`; commit it. From then on every build carries it and
installed copies download an update only when the release also has `SHA256SUMS.txt.sig`, a signature
of that exact `SHA256SUMS.txt`. Build each release with `--sign-key <the private key file>`
(`python installer\build.py --engine engines\deer-runtime --sign-key D:\offline\deer-release-key.pem`)
and upload `installer\out\SHA256SUMS.txt.sig` with the other two assets. `node tools\release-key.mjs
verify installer\out\SHA256SUMS.txt` checks the signature. The first release that carries the key
is still installed on trust by copies older than it.

## What the repository leaves out

These folders are created locally and are listed in `.gitignore`; never commit them, and never
commit an engine or any Mozilla binary:

| Folder | What it is | How to get it back |
|---|---|---|
| `gecko/runtime/` | development engine | the download above, then `tools/setup-runtime.py` |
| `gecko/engines/` | unbranded engines and the release engine | the download above, then `tools/setup-engine.py` |
| `gecko/reference/omni/` | Firefox's UI source | `tools/extract-reference.py` |
| `gecko/build/`, `gecko/build-*/` | the built chrome package | `node tools/build.mjs [--out=build-<name>]` |
| `gecko/installer/out/`, `gecko/installer/work/` | release builds and installer test material | `python installer\build.py` |
| `node_modules/` | esbuild and TypeScript | `npm ci` |
| `out/` folders under `tests/` and `spikes/` | captures, logs and kept profiles | run the tests |

`python .github/scripts/check-repo.py` (also part of CI) fails when any of these, a binary, a
profile folder, a stray copy of the engine, a stray screenshot or a file over 5 MB would be
committed, and warns about absolute paths that name a Windows user folder. Run it before every
commit that adds files.

## Continuous integration

`.github/workflows/ci.yml` runs on GitHub's Windows runners: `npm ci`, the build, the type-check,
a syntax check of every Python script, and the repository check. It does not start the browser,
since the engine is not part of the repository and the tests need a desktop session.
