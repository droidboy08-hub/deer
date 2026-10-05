# Verification of spike "packaging" (Firefox 157 runtime, 2026-10-02)

Verifier's own setup, independent of the spike's staged runtime:

- `verify\dist\Vitre\runtime\` = fresh copy of the stock `gecko\runtime`, staged by `verify\vstage.py`
  (spike's unchanged `dist-files\config.js` + junction `runtime\vitre -> verify\app`).
- `verify\app\` = copy of the spike's `app\` (later extended: icon/brand variants, paint probe).
- `verify\vrun.py <name> ...` = wrapper around the spike's `run-dist.py` (own runtime, own profile
  `%TEMP%\vitre-gecko-packaging-verify-<name>`, output `verify\out\<name>\`).
- All paths below are relative to `gecko\spikes\packaging\verify\` unless they start with `spikes\`.

## Findings the spike did not report (read these first)

### S1. The stock runtime writes shortcuts into the user's Start Menu on every fresh profile
Source: `reference\omni\gre\moz-src\browser\components\shell\StartupOSIntegration.sys.mjs`
(`onStartupIdle`) and `CustomIconManager.sys.mjs` (`maybeCreatePerUserStartMenuShortcut`, new in 15x,
pref `browser.shell.customIcon.enabled` default `true`).

- `ensurePrivateBrowsingShortcutExists()` creates `<brand> Private Browsing.lnk` ->
  `<runtime>\private_browsing.exe`. With the brand.ftl override the file is named
  **"Vitre Private Browsing.lnk"**.
- `maybeCreatePerUserStartMenuShortcut()` creates/overwrites **`Firefox.lnk`** -> `<runtime>\firefox.exe`
  with NO arguments whenever the machine has an all-users Firefox shortcut (i.e. the user has Firefox
  installed). The per-user shortcut shadows the all-users one.

Observed on this machine (`%APPDATA%\Microsoft\Windows\Start Menu\Programs`):

| file | created | state now |
|---|---|---|
| `Firefox.lnk` | 2026-09-21 (the user's own) | target is `...\gecko\runtime\firefox.exe`, no args; rewritten by every harness run (last 09:24) |
| `Firefox Private Browsing.lnk` | 2026-10-02 07:50 (first harness run) | -> `...\gecko\runtime\private_browsing.exe` |
| `Vitre Private Browsing.lnk` | 2026-10-02 08:49 (packaging spike) | -> `...\verify\dist\Vitre\runtime\private_browsing.exe` (retargeted by my first runs at 09:02; that exe is now moved away, so the link is dangling) |

Consequence: "Firefox" in the user's Start Menu now starts the spike runtime **without -profile**,
i.e. against the user's real Firefox profile store. This contradicts the spike's claim-22 evidence
"Nothing was written to the Start Menu".
Proof of cause: test profiles without the fix contain
`browser.shell.customIcon.perUserStartMenuShortcutCreated=true` (e.g. `...verify-prod\prefs.js`);
proof of fix: with the two prefs below the profile has no such pref and `Vitre Private Browsing.lnk`
kept its 09:02:55 timestamp through ~30 later runs (`out\noshortcut`).

Fix (must be in the product's default prefs AND in `tools\run.py` PREFS, which every spike uses):

```
browser.shell.customIcon.enabled = false
browser.privacySegmentation.createdShortcut = true
```

Not done by me (outside my folder, and deleting is the user's call): the three per-user `.lnk` files
above should be removed; the all-users `Firefox.lnk` in `C:\ProgramData\...` (-> `C:\Program Files\Mozilla Firefox`)
then applies again. The taskbar pin still points at the real Firefox.

### S2. config.js does NOT run "before the profile exists"
`vconfig-probe.js` run (`out\cfgprobe\log.txt`): at 68 ms `ProfD`, `ProfLD`, `PrefD` already resolve to the
profile directory. `vtest-guard.py` G1: a process that exits inside config.js leaves
`.startup-incomplete, compatibility.ini, parent.lock, startupCache, crashes, minidumps` in a previously
empty profile dir. So the profile is selected, locked and version-stamped before AutoConfig.
- The recipe line "Do not touch ProfD there" is wrong: ProfD is usable in config.js.
- A guard in config.js cannot stop a bare `firefox.exe` from selecting/creating a profile in the user's
  Firefox store; it can only stop Vitre from running in it.

### S3. The `<link>` stylesheet added in `browser-window-before-show` is applied AFTER the first paints
`vboot-paint.js` with `VITRE_PAINT_PROBE=1` (`out\paint\log.txt`, 3 runs, same order each time):

```
810 ms  browser-window-before-show   link.sheet=false
811 ms  SYNC sheet (windowUtils.loadSheetUsingURIString) applied immediately=true
992 ms  first requestAnimationFrame  link.sheet=false
994 ms  MozAfterPaint #1             link.sheet=false
1040 ms browser-delayed-startup-finished
1068 ms MozAfterPaint #2             link.sheet=false
1074 ms link load event
```
The recipe's "append `<link>` ... so Firefox's UI never flashes" is refuted. Use
`win.windowUtils.loadSheetUsingURIString(url, AUTHOR_SHEET)` in `browser-window-before-show` for everything
that hides Firefox's UI.

### S4. After an in-place restart the command line is a bare `firefox.exe`
`vboot-restart-cmdline.js` (`out\restartcmd\log.txt`): first start `... -no-remote -profile <P> <url>`, after
`quit(eAttemptQuit|eRestart)` the command line is just `"...\firefox.exe"`, `XRE_PROFILE_PATH` is already
consumed, ProfD is still `<P>`. The renamed identity also survives (`out\restartcmd-appini`).
Consequences: never key anything on the command line (a `-profile` check would kill restarts); the harness
cannot find the restarted process by profile name ("[capture] restart-after: no window found").

## Verdict per claim

| # | claim | verdict | evidence (mine) |
|---|---|---|---|
| 1 | AutoConfig loads Vitre into every window, no VITRE_BOOT | CONFIRMED | `out\noboot\noboot-9.png` (Wikipedia page, badge, title "Gecko (software) - Wikipedia — Vitre"); `out\prod\log.txt` P1-P7 (second window P7). init 101 ms, before-show 811 ms, delayed-startup 1058 ms |
| 2 | runtime registration content/skin/resource | CONFIRMED | `out\devdist\log.txt` T1.1-T1.3 |
| 3 | manifest override of aboutDialog.xhtml | CONFIRMED | T1.4, T6.1, `out\devdist\dev-3-about-override.png` |
| 4 | manifest override of browser.xhtml | CONFIRMED | `out\ovr\log.txt` O1-O4, `override-browser-xhtml.png` |
| 5 | content processes read Vitre files only inside runtime dir or `<profile>\chrome` | CONFIRMED, but the conclusion "stock harness cannot load child actors at all" is REFUTED (see I1) | `out\prodout` P4-P6 FAIL outside; `out\prod` (junction) pass; `out\profchrome` pass |
| 6 | .sys.mjs singleton | CONFIRMED | T2.1-T2.3 |
| 7 | JSWindowActor pair, needs `safeForUntrustedWebProcess` | CONFIRMED | T3.1-T3.3; `out\actorflag\log.txt`: no flag -> "Window protocol 'VitreProbe' doesn't match remote type", `remoteTypes` does not help, flag works |
| 8 | chrome stylesheet | CONFIRMED (loads), but see S3 for timing | T4.1-T4.2, `dev-1-styles-on-web-page.png` |
| 9 | privileged HTML page in a tab | CONFIRMED | T5.1-T5.4, `dev-2-home-page.png`. Note: runs in the PARENT process with system principal |
| 10 | script loading forms, CSP blocks eval/inline | CONFIRMED | T4b.1-T4b.4 |
| 11 | custom `-app` XUL app = toolkit only | CONFIRMED (partial stands) | `out\xulapp\log.txt` |
| 12 | own window via `-chrome`: no gBrowser, tabs=0 | CONFIRMED (partial stands; no better route found, claim 4 is the workable "own document") | `out\ownwin\log.txt` |
| 13 | full browser under renamed identity | CONFIRMED, one detail wrong | `out\identapp\log.txt`; UA: `compatMode.firefox=true` gives `... Firefox/157.0 VitrePkgSpike/157.0`, NOT the stock UA; only `general.useragent.override` gives the stock UA (`out\ua`). Editing `runtime\application.ini` in place has no effect (`out\appini-inplace`) |
| 14 | built-in add-on via installBuiltinAddon | CONFIRMED + extended | `out\addons\log.txt` E1 (REQUIRE_SIGNING=true), E2: it persists and starts by itself on the next start |
| 15 | system add-on dirs (was unverified) | RESOLVED: not usable | 157 has no `browser\features` location in XPIProvider any more; unsigned XPI in `distribution\extensions` is not installed (D1) |
| 16 | launcher, single instance, URL hand-off | CONFIRMED + extended | `vtest-remote.py` output: profile path WITH A SPACE, URLs with `&`/`%20` through exe/cmd/ps1, `-osint` injection attempt stays one URL, bare relaunch opens a window; 1 parent process throughout. Window class `Mozilla_firefox_<profile>_RemoteWindow`. Same with `--app-ini` |
| 17 | -osint forwarding | CONFIRMED for the working shape (E, I); the negative half ("-profile P -osint ..." is ignored) not re-run |
| 18 | window title via brand.ftl source | CONFIRMED, robust | `out\brand\log.txt` V1-V3, V6: tab switch, settings ("Settings — Vitre"), private window ("Vitre Private Browsing"), menu "About Vitre" |
| 19 | window icon via setWindowIcon | CONFIRMED, robust | `out\icon-a\montage.png`: main, second, private, About, Library windows |
| 20 | icon via `chrome\icons\default\*.ico` not possible | REFUTED | see I2, `out\icon-b\montage.png` |
| 21 | per-window AppUserModelID | CONFIRMED, robust | every capture line of `out\icon-a`: `aumid='Vitre.Browser.PackagingSpike'` incl. private window |
| 22 | pinning / default browser (unverified) | still unverified; its evidence sentence is wrong (S1) |
| 23 | exe cannot be rebranded | REFUTED for personal use | see I3, `vtest-exe.py` |
| 24 | no self-update | CONFIRMED | U1 in `out\prod`; `out\hardened`: all checks pass with updater, maintenanceservice*, default-browser-agent, pingsender, crashreporter, crashhelper, private_browsing removed |
| 25 | update procedure | unverified (design only) |
| 26 | no stale code from startup cache | CONFIRMED | `vtest-cache.py --in-runtime`: v1 -> v2 -> v3 picked up with no flag (same-size edit of window.js included) |
| 27 | reload without restart, in-place restart | CONFIRMED | `out\devdist2\log.txt` T7.0-T7.6 incl. T7.5 actor; `out\restart` R1: 1139 ms |
| 28 | TypeScript build | CONFIRMED + improved | esbuild 0.48 s, tsc 7.0.2 0.25 s, exit 1 on error; `out\ts` TS1, TS2; see I6 |
| 29 | legal position | CONSISTENT with the pages read today | distribution policy: unaltered copies only; "may not add to, remove, or change any part of the software", incl. default settings and extensions; MPL FAQ: own files need not be MPL |
| 30 | source build | unverified; doc numbers match (40 GB, 4 GB min / 8 GB+ RAM, no spaces in path) |

## Improved / changed answers

- **I1. Child actors under the stock harness.** `vboot-stock-actor.js` run with `tools\run.py` on the untouched
  `gecko\runtime`: the boot script writes the actor modules to `<ProfD>\chrome\vitre-verify\`, writes a
  `chrome.manifest` there, `autoRegister`s it and registers the actor. S1-S4 pass, in a content process that
  existed before the registration and in a new one (`out\stockactor\log.txt`).
- **I2. Window icon from an .ico file.** 157's `browser.xhtml` has no `icon` attribute any more, so nothing asks
  for `main-window.ico` (that is why the spike's attempt failed; reproduced in `out\icon-c\montage.png`:
  Firefox icon, and the Firefox private-browsing icon on the private window). Setting
  `documentElement.setAttribute("icon", "vitre")` before layout plus
  `runtime\browser\chrome\icons\default\vitre.ico` works for all five window kinds (`out\icon-b`).
  Hook: `browser-window-before-show` for browser windows; `domwindowopened` + capture-phase
  `DOMContentLoaded` for other chrome windows (code in `app\modules\VitreStartup.sys.mjs`, `VITRE_ICON_ATTR`).
  `Services.dirsvc.get("AChromDL")` is empty; the directory used is `AChrom` = `runtime\browser\chrome`.
  `setWindowIconFromExe(Vitre.exe, 0 | 32512)` did not give the Vitre icon in two tries (`out\icon-d`, `icon-d2`).
- **I3. Engine exe rebranding without a source build.** `vtest-exe.py`:
  K1 a byte-identical copy `vitre-engine.exe` runs the whole browser, every child process has that image
  name, signature still Valid. K2 a copy edited with the Win32 `UpdateResource` API (icon group 1 replaced by
  `vitre.ico`; FileDescription/ProductName/InternalName "Firefox" -> "Vitre") runs too, sandboxed content
  process and actor included; shell icon is the Vitre icon (`out\exe-k2-resedit\shell-icons.png`).
  Cost: K2 is no longer signed (`signature=NotSigned`), must be redone per runtime update, DRM host
  verification is untested, and it is one more modification of Mozilla's binary (personal use only).
- **I4. Legacy brand strings and brand images.** Manifest lines
  `override chrome://branding/locale/brand.properties ...` and
  `override chrome://branding/content/icon32.png ...` work (`out\brand` V4, V5). Leftovers after brand.ftl:
  sub-brand terms from `toolkit/branding/brandings.ftl` ("Firefox View", "Firefox Relay", "Firefox Home",
  "Firefox Suggest", "Firefox Labs", "Mozilla VPN/Monitor"); only 47 of the lines in 238 .ftl files
  hard-code Firefox/Mozilla.
- **I5. Launch guard.** `vconfig-guard.js` + `vtest-guard.py`: config.js exits the process (ctypes
  `ExitProcess`) unless `<ProfD>\vitre-profile` exists (the launcher creates it). G1 refused start: no window,
  no Vitre code ran; G2 normal start passes P1-P7; G3 in-place restart still allowed.
  A first version that checked the command line for `-profile` would have broken restarts (S4).
- **I6. Typed chrome:// imports.** `ts-proof\tsconfig.paths.json`:
  `"paths": { "chrome://vitre/content/*.mjs": ["./src/*.ts"] }` gives real cross-module types (TS2322/TS2339
  reported through a chrome:// import), no ambient `declare module` needed.

## Recipe corrections

1. Add to default prefs and to `tools\run.py`: `browser.shell.customIcon.enabled=false`,
   `browser.privacySegmentation.createdShortcut=true` (S1).
2. config.js: ProfD is available; the profile is already locked (S2). Add the profile-marker guard (I5).
3. Hide Firefox's UI with `windowUtils.loadSheetUsingURIString` in before-show, not `<link>` (S3).
4. Icon: prefer `icon` attribute + `.ico` in `runtime\browser\chrome\icons\default\` (multi-size, synchronous);
   keep `setWindowIcon` as fallback (I2).
5. UA under a renamed identity: only `general.useragent.override` restores the stock UA; `getBrowserInfo().name`
   also changes (seen: "browser=VitrePkgSpike/157.0"), which add-ons may sniff.
6. Keep one `resource` mapping if a built-in add-on is used (`installBuiltinAddon` takes a `resource://` root and
   needs it registered before the add-on manager starts; the manifest line does that). Do not import modules
   through it.
7. `%APPDATA%\Vitre` is the Electron build's userData folder (Cache, history.json, settings.json ... are in it).
   `%APPDATA%\Vitre\Profile` nests the Gecko profile inside it; with `-profile` the disk cache also lives in
   that roaming folder (ProfLD == ProfD). Pick a separate folder on purpose.
8. Pinning: without a Start Menu shortcut carrying the same AppUserModelID, Windows pins the process image,
   i.e. bare `firefox.exe` (unverified, Windows behaviour). Treat the Vitre.exe shortcut as required.
9. Boot scripts run in EVERY new browser window (config.js observer); a script that opens windows must guard
   itself (`vboot-icon.js` shows the pattern).
10. Home/settings pages are parent-process, system-principal documents: never insert page-derived HTML.
11. With the brand override, Mozilla's own messages speak as Vitre ("We've updated our Privacy Notice to reflect
    the latest features in Vitre", `out\exe-k2-resedit\exe-window.png`). Switch the messaging system off
    (policy `UserMessaging`, unverified) before anyone else sees a build.

## Side effects of my runs outside this folder

- Before S1 was understood (first 5 runs, 08:59-09:03): retargeted `Vitre Private Browsing.lnk` and, in turn with
  the other spikes, `Firefox.lnk` in the user's Start Menu. Not reverted (see S1).
- `HKCU\Software\Mozilla\Firefox\...` per-path values and `C:\ProgramData\Mozilla-...\updates\7DCC2C82495661A2`
  for my runtime copy (same kind the spike reported).
- `%APPDATA%\VitrePkgSpike` and `%LOCALAPPDATA%\VitrePkgSpike` (empty trees from the renamed-identity runs):
  removed with rmdir.
- `%APPDATA%\Mozilla\Firefox` files are untouched (newest mtime 2026-09-29); `%LOCALAPPDATA%\Mozilla\Firefox`
  directory mtime changes during runs (a transient lock file), contents unchanged.

## Re-run

```
cd <project>\gecko
python spikes/packaging/verify/vstage.py --link
python spikes/packaging/verify/vrun.py prod    --boot spikes/packaging/boot-prod.js --url https://example.com
python spikes/packaging/verify/vrun.py devdist2 --boot spikes/packaging/verify/vboot-devloop.js --url https://example.com
python spikes/packaging/verify/vrun.py icon-b  --boot spikes/packaging/verify/vboot-icon.js --env VITRE_ICON_ATTR=vitre --url https://example.com
python spikes/packaging/verify/montage.py spikes/packaging/verify/out/icon-b
python spikes/packaging/verify/vrun.py brand   --boot spikes/packaging/verify/vboot-brand.js --url https://example.com
python spikes/packaging/verify/vrun.py paint   --boot spikes/packaging/verify/vboot-paint.js --env VITRE_PAINT_PROBE=1 --url https://example.com
python spikes/packaging/verify/vrun.py addons  --boot spikes/packaging/verify/vboot-addons.js --pref xpinstall.signatures.required=true --url https://example.com
python spikes/packaging/verify/vtest-remote.py [--app-ini]     (--app-ini needs dist-files/browser-application.ini copied to runtime\browser\application.ini)
python spikes/packaging/verify/vtest-guard.py
python spikes/packaging/verify/vtest-cache.py --in-runtime
python spikes/packaging/verify/vtest-exe.py
python tools/run.py --boot spikes/packaging/verify/vboot-stock-actor.js --name packaging-verify-stockactor --out spikes/packaging/verify/out/stockactor --url https://example.com --pref browser.shell.customIcon.enabled=false --pref browser.privacySegmentation.createdShortcut=true
```
State of my runtime copy: stock + `config.js` + junction `vitre` + `browser\chrome\icons\default\{vitre,main-window}.ico`
+ `vitre-engine.exe`, `vitre-engine-res.exe`; eight auxiliary exes moved to `verify\removed-exes\`.
