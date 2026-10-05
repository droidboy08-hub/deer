# Deer on Gecko: test harness

Deer is a **chrome layer on the stock Firefox runtime**: privileged JS/CSS/HTML loaded into
Firefox's own browser window (`browser.xhtml`), which hides Firefox's interface and draws Deer's.
`ARCHITECTURE.md` describes the product; this file is the guide to running it under test.
(The spikes that proved each mechanism are in `spikes/<area>/`; their `RESULT.md` files are the
recipes. They were written against the bare runtime: re-run one with `--stock`.)

## Layout

- `runtime/`: a private copy of Firefox 157.0 (never the user's installed Firefox), wired for Deer by
  `python tools/setup-runtime.py` from the tracked files in `tools/runtime-overlay/` (`config.js`,
  default prefs, policies, window icon), plus `vitre.exe` (a byte copy of `firefox.exe`) and the
  junction `runtime/vitre` -> `build/`. Only the infrastructure stage edits it; change the overlay and
  run the script again.
- `reference/omni/gre` and `reference/omni/browser`: Firefox 157's own UI source, extracted from
  `omni.ja`. Grep it for the real APIs; it is the ground truth for this exact version.
- `tools/build.mjs`: builds `src/` into `build/` (or `--out=build-<name>`).
- `tools/run.py`: starts `runtime/vitre.exe` on a throwaway profile, loads a test script into the
  window once Deer has booted, captures real composited screenshots (PrintWindow), prints the
  script's log, stops everything and deletes the profile. Exit code 1 on any `FAIL`/`ERROR` line or
  a timeout.
- `tools/spike-lib.js`: the `spike` helpers available to test scripts.
- `tests/<feature>/`: test scripts, one folder per feature; `tests/core/all.py` runs the core set.

## Running

```
cd <project>\gecko
node tools/build.mjs
python tools/run.py --test tests/<feature>/<script>.js --name <unique> --url https://example.com --timeout 90
```

- `--name` picks the profile (`%TEMP%\vitre-gecko-<name>`), so runs with different names are
  independent and can run at the same time. Use your own names.
- `--app build-<name>` runs your own build (`node tools/build.mjs --out=build-<name>`) without touching
  `build/`: the folder is linked into the profile's `chrome` folder, where sandboxed content
  processes can read it.
- `--pref key=value` sets a pref (repeatable; `true`/`false` and integers are typed, everything else
  is a string). Every run gets `vitre.localAppData` = a folder inside its profile, which stands in
  for `%LOCALAPPDATA%` where Deer keeps the ffmpeg, yt-dlp and Deno it downloads (and reads the
  copies from before the rename), so a test never sees the person's own.
  `--env KEY=VALUE` sets an environment variable. `--arg` adds a runtime argument.
  `--keep-profile` keeps the profile. `--out` picks the output folder (default: `out/` next to the
  script) for `log.txt` and `*.png`.
- `--shoot name:seconds` screenshots the window from outside; with no `--test` Deer starts with no
  test hook at all. `--identity` adds the window title, taskbar id and icon to every capture.
- `--stock` starts the plain Firefox interface (`VITRE_DISABLE=1`), for comparisons and old spikes.
- The script runs in the browser window's scope (`window`, `window.vitre`, `gBrowser`, `Services`,
  `Cc`, `Ci`, `ChromeUtils`, `IOUtils`...), after `window.vitre.whenReady`. Sibling files of the
  script are reachable as `resource://vitre-boot/<file>` (loadSubScript refuses `file:` URLs).
- Errors and warnings from Deer's own code (`chrome://vitre/`) are copied into the run's output as
  `[console.error] ...` lines; a failed boot step is an `ERROR vitre: ...` line.

## `spike` helpers

- `spike.main(async () => { ... })` runs the body in the first browser window only (the script is
  loaded into every window, including ones the test opens), logs errors and always quits.
- `spike.log(...)`, `spike.check(name, ok, detail)` (`PASS`/`FAIL` lines),
  `await spike.waitFor(fn, { timeout, what })`, `await spike.sleep(ms)`.
- `await spike.capture('name')`: screenshot of the calling window (physical pixels, whole window).
  Panels, menus and doorhangers are separate OS windows and are not in it; log their rectangles.
- `await spike.resize(w, h)`, `await spike.loaded()`, `await spike.activate()`.
- Input, in-process only: `spike.press('Ctrl+Shift+T')`, `spike.type('text')`,
  `spike.click(elementOrX, y, { button, shiftKey, type: 'mousemove' })`, and `spike.EU` (EventUtils).
- `await spike.openWindow({ private: true })`: another browser window, resolved once Deer is ready
  there; it has its own `spike` (use `win.spike.capture(...)`).
- `spike.run` and `spike.restart()`: restart in place on the same profile; the script runs again with
  `spike.run === 2`.
- `await spike.modules('text')`: the runner prints the DLLs matching the text that are loaded in
  this run's processes.

## Rules

- Other windows are open on this desktop and may cover yours or take focus. Captures still work
  (occlusion tracking is off under the harness), and `focusmanager.testmode=true` lets
  `spike.activate()` make Gecko treat the window as active. Never rely on OS focus or real input.
- Never download extensions or other executables. Local test extensions can be loaded with
  `AddonManager.installTemporaryAddon(nsIFile)`. Plain HTTP fetches of pages are fine.
- Never touch the user's real Firefox (`C:\Program Files\Mozilla Firefox`, `%APPDATA%\Mozilla`), and
  never start the runtime without `-profile` (run.py and the launcher always pass it; `config.js`
  exits when the profile has no `vitre-profile` marker unless `VITRE_ALLOW_ANY_PROFILE=1`).
- Never read or change the person's own Deer data (`%LOCALAPPDATA%\Deer`, `%APPDATA%\Deer`, and
  `%LOCALAPPDATA%\Vitre` from before the rename): throwaway profiles and fake roots in `%TEMP%` only.
- Internet Download Manager on this machine hooks processes named `firefox.exe`; `vitre.exe` is left
  alone (`python tests/core/idm.py --control` shows both). Do not start `runtime/firefox.exe`.
