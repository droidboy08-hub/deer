# Spike result: packaging

Verdict: works-with-compromises

## Summary
Vitre can load permanently on the stock Firefox 157 runtime with no environment variables, and it can be launched, single-instanced and largely rebranded without compiling. The exe itself cannot be rebranded, and this layout is for personal use only: a public release needs a real source build with its own branding.

FINDINGS.md was not written. The Write tool refused it ("subagents should return findings as text"), so the findings are in this output. The spike scripts and their logs and screenshots are in place and runnable.

Three results an implementer would not guess:

- **The app folder must sit inside the runtime directory (or `<profile>\chrome`).** Sandboxed content processes cannot read files anywhere else, so child actor modules fail with "Failed to load chrome://vitre/content/actors/...". A junction `runtime\vitre` pointing at the source folder works, so the dev loop needs no copy step. With the stock harness (boot script outside the runtime), child actors cannot load at all.
- **Window actors need `safeForUntrustedWebProcess: true` on 157.** Without it `getActor` throws "doesn't match remote type 'webIsolated=...'".
- **Never start `runtime\firefox.exe` without `-profile`.** With the stock identity its data root is `%APPDATA%\Mozilla\Firefox`, the user's real Firefox. Every run here passed `-profile`, and that folder's files were untouched afterwards.

Decision on architecture: layer on `browser.xhtml`. A custom `-app` XUL app still launches but is toolkit-only (no `gBrowser`, no `tabs`/`browserAction` extension APIs), and an own window via `-chrome` is invisible to extensions (`tabs=0`).

One unexpected lever: `firefox.exe -app runtime\browser\application.ini` with a renamed `[App]` section runs the full browser under another identity (own data root, own remoting name). It works but changes the UA unless a pref pins it, so I'd keep the stock identity for now.

Recommended build: TypeScript with esbuild, since the Electron UI is already TypeScript and both tools are in `app\node_modules` (build 0.5 s, type-check 0.3 s). The same `chrome://vitre/content/` URLs carry over unchanged into a later fork.

Side effects outside the spike folder: the renamed-identity runs created empty `%APPDATA%\VitrePkgSpike` and `%LOCALAPPDATA%\VitrePkgSpike` trees, which I removed. The runtime copy also wrote per-path values under `HKCU\Software\Mozilla\Firefox` and a per-path folder under `C:\ProgramData\Mozilla-...\updates`; those are left in place. `gecko\runtime` was not modified.

## Claims
- [proven] Permanent loading path: AutoConfig config.js registers chrome://vitre/ from <runtime>\vitre and loads Vitre into every browser window, with no VITRE_BOOT
  evidence: dist-files/config.js + app/modules/VitreStartup.sys.mjs. out/packaging-noboot/prod-noboot.png shows the badge 'Vitre layer loaded by config.js (no VITRE_BOOT)'. out/packaging-prod/log.txt P1-P7 pass, including a second window (P7). Timeline: init 86 ms, browser-window-before-show 861 ms, delayed-startup about 1100 ms.
- [proven] Runtime registration of manifest content / skin / resource lines via nsIComponentRegistrar.autoRegister
  evidence: boot-devloop.js T1.1-T1.3 in out/packaging-devdist/log.txt and out/packaging-dev-stock/log.txt.
- [proven] Manifest override of a Firefox chrome document (aboutDialog.xhtml -> Vitre's about page)
  evidence: boot-devloop.js T1.4 and T6.1; screenshot out/packaging-ident/ident-3-about.png (title 'About Vitre', Vitre icon in the title bar).
- [proven] Manifest override of browser.xhtml itself, registered from AutoConfig
  evidence: make-override-variant.py + boot-override.js; out/packaging-ovr/log.txt O1-O4 pass. Works but not recommended: it means carrying a private copy of a 5,800-line file per Firefox version.
- [proven] Sandboxed content processes can load Vitre files only from inside the runtime dir or <profile>\chrome
  evidence: App outside the runtime: out/packaging-prodout/log.txt P4-P6 FAIL with 'Failed to load chrome://vitre/content/actors/VitreProbeChild.sys.mjs'; same in out/packaging-actor/log.txt, and security.sandbox.content.level=2 does not help (out/packaging-actor-level2/log.txt). Copy inside runtime: out/packaging-prod P4-P5 pass. Junction runtime\vitre -> source: out/packaging-prodlink pass. Junction <profile>\chrome -> source: out/packaging-profchrome pass.
- [proven] ES module .sys.mjs singleton from the runtime-registered package
  evidence: boot-devloop.js T2.1-T2.2 (out/packaging-devdist/log.txt). T2.3 shows chrome:// and resource:// URLs of the same file are two separate instances.
- [proven] JSWindowActor pair (parent + child via ChromeUtils.registerWindowActor), child running in a web content process
  evidence: boot-devloop.js T3.1-T3.3 in out/packaging-devdist/log.txt (remoteType webIsolated=https://example.com, processType 2, both directions). Requires safeForUntrustedWebProcess: true; without it boot-actor-variants.js variant A throws 'doesn't match remote type'.
- [proven] Chrome stylesheet from the package (loadSheetUsingURIString and <link> in browser.xhtml head)
  evidence: T4.1-T4.2; screenshot out/packaging-devdist/dev-1-styles-on-web-page.png shows both styled badges.
- [proven] Privileged HTML page chrome://vitre/content/pages/home.html in a tab
  evidence: T5.1-T5.3: parent process, system principal, imports the same sys.mjs singleton, type=module script works. Screenshot out/packaging-devdist/dev-2-home-page.png.
- [proven] Scripts into the browser window: loadSubScript, <script type=module src=chrome://>, dynamic import() inside a subscript, importESModule with global:'current'
  evidence: T4b.1-T4b.3b pass. T4b.3c and T4b.4 confirm browser.xhtml's CSP blocks eval and inline scripts.
- [partial] Custom XUL app via firefox.exe -app application.ini
  evidence: xulapp/ launches on 157 and renders a remote page (out/packaging-xulapp/xulapp-window.png). Log shows toolkit only: chrome://browser/ not registered, BrowserGlue missing, webextension-modules = toolkit only (no tabs/browserAction), UA becomes VitrePkgSpike/0.1. Not usable as a browser base.
- [partial] Own top-level window on the full browser runtime via -chrome
  evidence: out/packaging-ownwin/log.txt and own-window.png: window opens and renders example.com, browser modules import, but gBrowser is undefined and a test extension reports tabs=0.
- [proven] Full browser under a renamed identity (-app runtime\browser\application.ini or XUL_APP_FILE)
  evidence: out/packaging-identapp/log.txt: appinfo.name=VitrePkgSpike, UAppData=%APPDATA%\VitrePkgSpike\VitrePkgSpike, gBrowser and SessionStore present, extension with browser_action+tabs works (X1). -app must be the first argument (an earlier run with it later was ignored). UA changes to VitrePkgSpike/157.0; general.useragent.override or general.useragent.compatMode.firefox fixes it (boot-ua.js run output; out/packaging-ua/log.txt holds the override variant).
- [proven] Built-in add-on alternative: AddonManager.installBuiltinAddon(resource://...) installs an unsigned privileged extension with experiment APIs
  evidence: boot-builtin.js + testext-priv/; out/packaging-builtin2/log.txt E1 passes with xpinstall.signatures.required=true: isBuiltin=true, isPrivileged=true, title 'builtin tabs=1 | chrome code in Firefox pid ...'.
- [unverified] System add-on in browser/features or distribution/extensions as a loading path
  evidence: Not run. Release builds are expected to require Mozilla signatures there.
- [proven] Launcher with Vitre's own profile; single instance and 'open this URL' through Gecko remoting, no collision with the user's Firefox
  evidence: test-remote.py builds dist/Vitre/Vitre.exe from launcher/Launcher.cs and prints: Vitre.exe <url>, Vitre.cmd -new-window, Vitre.ps1 -private-window and Vitre.exe -osint -url all arrived in instance A in 0.4-1.0 s with one parent process. Remoting window class is Mozilla_firefox_<profile path>_RemoteWindow, so it is keyed by profile. TAB lines in out/packaging-remote/log.txt; same under the renamed identity in out/packaging-remote-appini.
- [proven] -osint forwarding from the shell
  evidence: First test-remote.py run: '-profile P -osint -url X' did not arrive in 20 s (Gecko only accepts -osint as argv[1]). After the launcher validated the shape and forwarded '-url X', it arrived in 0.6 s.
- [proven] Window title rebranding without recompiling
  evidence: L10nRegistry source carrying only branding/brand.ftl, registered in VitreStartup.init: the OS window title read by the runner is 'Example Domain — Vitre' (run-dist.py [shoot]/[capture] lines for packaging-noboot and packaging-prod). Alternative gBrowser.getWindowTitleForBrowser override: boot-identity.js B2.
- [proven] Window icon via nsIWindowsUIUtils.setWindowIcon
  evidence: out/packaging-ident/ident-2-branded.icon.png is the icon read back with WM_GETICON (the Vitre 'V'); ident-1-stock.icon.png from the first run showed the Firefox icon. About window title bar shows it in ident-3-about.png.
- [not-possible] Window icon via chrome\icons\default\<window id>.ico files
  evidence: Tried runtime\browser\chrome\icons\default and runtime\chrome\icons\default with main-window.ico, default.ico, vitre-about.ico; out/packaging-icofile/*.icon.png still show the Firefox icon. Stopped after two attempts.
- [proven] Taskbar identity (AppUserModelID) per window via nsIWinTaskbar.setGroupIdForWindow
  evidence: Runner reads System.AppUserModel.ID from the window's property store: 'Vitre.Browser.PackagingSpike' on every capture line of packaging-ident. Default without the call is the install-path hash 41D46D90F7D5F712 (packaging-icofile capture lines), already distinct from the user's Firefox.
- [unverified] Taskbar pinning and default-browser registration
  evidence: Nothing was written to the Start Menu or registry. The needed keys are listed in the recipe; pinning needs a shortcut with the same AppUserModelID pointing at Vitre.exe.
- [not-possible] Rebranding the exe itself (file name, embedded icon, version resource)
  evidence: These are compiled into firefox.exe; no runtime lever was found. Requires a source build.
- [proven] Runtime cannot self-update (policies.json DisableAppUpdate holds)
  evidence: boot-prod.js U1 in out/packaging-prod/log.txt: policies.isAllowed('appUpdate')=false, update service disabled=true, canCheckForUpdates=false, app.update.background.enabled=false. The runtime also runs with updater.exe, maintenanceservice*.exe, default-browser-agent.exe, pingsender.exe and crashreporter.exe removed (out/packaging-hardened/log.txt, all checks pass).
- [unverified] Vitre's own later update procedure for runtime and chrome layer
  evidence: Design only (folder swap by the launcher while closed, then one start with -purgecaches). Not implemented or run.
- [proven] No stale code from the startup cache after the app folder changes
  evidence: test-cache.py and test-cache.py --in-runtime output: after a 30-45 s session and normal quit, edited subscript, .sys.mjs and CSS all ran as v2 on the next start with the same profile and no flag; -purgecaches run also fine. Evidence is the script's printed VERSIONS lines (log.txt keeps only the last run).
- [proven] Reloading without restarting, and in-place restart
  evidence: boot-devloop.js T7.1-T7.6 (out/packaging-devdist/log.txt): subscript, stylesheet and HTML page reload from the same URL; .sys.mjs, window ES modules and actors stay cached and need ?v=N. In-place restart took 1173 ms and ran the edited module (out/packaging-restart/log.txt R1).
- [proven] TypeScript build step (esbuild) producing loadable .sys.mjs and window bundle, with tsc type-check
  evidence: ts-proof/build.sh (0.56 s) + boot-ts.js: out/packaging-ts/log.txt TS1 and TS2 pass. tsc 7.0.2 -p ts-proof exits 0, and exits 1 with TS2322 on a deliberate error.
- [partial] Legal position: personal use fine, public release needs own-branded source build
  evidence: Read from Mozilla's pages, not legal advice: distribution policy (https://www.mozilla.org/en-US/foundation/trademarks/distribution-policy/), trademark guidelines (https://www.mozilla.org/en-US/foundation/trademarks/policy/), MPL FAQ (https://www.mozilla.org/en-US/MPL/2.0/FAQ/), unbranded builds (https://wiki.mozilla.org/Add-ons/Extension_Signing).
- [unverified] Source-fork build on Windows and moving the chrome layer into browser/
  evidence: Requirements taken from https://firefox-source-docs.mozilla.org/setup/windows_build.html (40 GB free, no spaces in path) and the artifact-build page; nothing was built. This machine had 32 GB free at the end. mozconfig lines and the jar.mn move are from knowledge of other forks.

## Recipe
All paths are under `gecko\spikes\packaging\`.

**Layout (built by `stage.py`, tested in `dist\Vitre\`)**
```
Vitre\
  Vitre.exe                       launcher\Launcher.cs
  runtime\                        stock Firefox 157 plus:
    config.js                     dist-files\config.js
    defaults\pref\config-prefs.js general.config.filename=config.js, obscure_value=0, sandbox_enabled=false
    distribution\policies.json    DisableAppUpdate, DisableTelemetry, DontCheckDefaultBrowser, DisableDefaultBrowserAgent
    vitre\                        chrome package: copy for release, junction to the build folder for dev
```

**Loader (`dist-files\config.js`)**
- First line must be a comment. Wrap everything in try/catch; an escaping exception shows "Failed to read the configuration file".
- Get `Services` via `Components.utils.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs")).Services`.
- App dir = `Services.dirsvc.get("GreD", Ci.nsIFile)` + `vitre`.
- `Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(<vitre\chrome.manifest>)`.
- `ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs").VitreStartup.init()`.
- This runs about 85 ms after process start, before the profile exists. Do not touch `ProfD` there.

**chrome.manifest**
- `content vitre ./` gives `chrome://vitre/content/modules/X.sys.mjs`, `.../actors/`, `.../chrome/`, `.../pages/`.
- `override chrome://browser/content/aboutDialog.xhtml chrome://vitre/content/pages/about.xhtml` for the About window.
- Use `chrome://vitre/content/` for every import. A `resource` line creates a second instance of each module; drop it.

**Startup module (`app\modules\VitreStartup.sys.mjs`)**
- `browser-window-before-show` (subject = window, before first paint): append `<link rel="stylesheet" href="chrome://vitre/...">` to `document.head` and set root attributes, so Firefox's UI never flashes.
- `browser-delayed-startup-finished`: `Services.scriptloader.loadSubScript("chrome://vitre/content/chrome/window.js", win)`.
- `domwindowopened`: icon and taskbar identity for every top-level window.
- Actors: `ChromeUtils.registerWindowActor("Name", { parent: {esModuleURI}, child: {esModuleURI, events}, matches, messageManagerGroups: ["browsers"], safeForUntrustedWebProcess: true })`. Exported classes must be `NameParent` / `NameChild`.
- Brand strings: `L10nRegistry.getInstance().registerSources([new L10nFileSource("0-vitre-brand", "app", ["en-US"], "chrome://vitre/content/locales/{locale}/")])` with `locales\en-US\branding\brand.ftl` defining `-brand-short-name`, `-brand-full-name` and the others. Do it in `init`, before any window.
- Icon: `img = await ChromeUtils.fetchDecodedImage(uri, Services.io.newChannelFromURI(uri, null, systemPrincipal, null, Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL, Ci.nsIContentPolicy.TYPE_IMAGE))`, then `Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils).setWindowIcon(win, img, img)`.
- Taskbar: `Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar).setGroupIdForWindow(win, "Vitre.Browser")` in try/catch; it throws `NS_ERROR_ILLEGAL_VALUE` for one early window.

**Window code rules**
- `browser.xhtml` CSP is `script-src chrome: moz-src: resource:`. No inline scripts, no `eval`.
- Allowed: `loadSubScript`, `<script src="chrome://...">`, `<script type="module" src>`, `import()` inside a subscript.
- Pages (`chrome://vitre/content/pages/home.html`) load in the parent process with system principal. Give them a CSP meta and external scripts only.
- An extension with `experiment_apis` has its own `apiManager`; reach shared globals through `ExtensionParent.apiManager.global`.
- Tabbrowser and SessionStore live under `moz-src:///browser/components/...` in 157, not `resource:///modules/`.

**Launching (`launcher\Launcher.cs`, `Vitre.cmd`, `Vitre.ps1`)**
- `runtime\firefox.exe -profile "%APPDATA%\Vitre\Profile" <args>`. Always `-profile`. No `-no-remote`; Gecko remoting is keyed by profile path and gives single instance plus URL hand-off.
- Shell command for default-browser use: `"Vitre.exe" -osint -url "%1"`. The launcher must check for exactly `-osint <flag> <value>` and forward `<flag> <value>` without `-osint`.
- Build the exe: `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize+ /win32icon:dist-files\vitre.ico /out:dist\Vitre\Vitre.exe launcher\Launcher.cs`.
- Optional renamed identity: copy `runtime\application.ini` to `runtime\browser\application.ini`, change `Vendor`/`Name`/`RemotingName`, keep `ID`, start with `-app <ini>` as the first argument or set `XUL_APP_FILE`. Then set `general.useragent.override` to the Firefox UA. Every launch path must use the same identity.
- Default-browser registration (not done): `HKCU\Software\Clients\StartMenuInternet\Vitre\Capabilities` (URLAssociations, FileAssociations), `HKCU\Software\RegisteredApplications`, ProgIDs `VitreURL`/`VitreHTML`, then the user confirms in Windows Settings. Keep Firefox's own "make default" hidden; it would register `firefox.exe` without `-profile`.
- Pinning needs a Start Menu shortcut to `Vitre.exe` carrying the same AppUserModelID.

**Updates**
- Keep `policies.json`; optionally delete `updater.exe`, `maintenanceservice*.exe`, `default-browser-agent.exe`, `pingsender.exe`, `crashreporter.exe`.
- To update: with Vitre closed, unpack the new Firefox to `runtime-new`, copy in the three small files and `vitre\`, swap folders, start once with `-purgecaches`.

**Dev loop**
- `runtime\vitre` = junction to the build output (`cmd /c mklink /J`). Alternative that leaves the runtime untouched: junction `<profile>\chrome` to the app folder and register that manifest (`run-dist.py --app-in-profile`).
- Reload per kind: subscript = `loadSubScript` again; stylesheet = remove then add; page = reload tab; `.sys.mjs`, window ES modules and actors = `?v=N` or restart.
- Restart in place: `Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart)`, about 1.2 s.
- `-purgecaches` and `nglayout.debug.disable_xul_cache` were not needed for flat files.

**Build step (`ts-proof\build.sh`)**
- Modules and actors: `esbuild X.sys.ts --format=esm --target=firefox140 --outdir=... --out-extension:.js=.mjs`, no bundling, imports written as `chrome://vitre/content/...` with ambient `declare module` typings.
- Per-window UI and each page: `esbuild window.ts --bundle --format=iife --outfile=...`.
- Type-check: `tsc -p .` with `noEmit`.

**Proposed structure under `gecko\`**
```
runtime\      stock + 3 files + junction vitre -> ..\build
src\          chrome.manifest, modules\ (*.sys.ts), actors\, chrome\ (per-window UI), pages\, skin\, locales\en-US\branding\brand.ftl, types\
build\        esbuild output = the chrome package
launcher\     Launcher.cs
tools\        build.mjs, stage.py, run.py, package.py
tests\        capture scripts
dist\Vitre\   Vitre.exe + runtime\
```

**Fork later**
- `src` output becomes `browser/vitre/` with a `jar.mn` mapping to the same `chrome://vitre/content/` URLs; `VitreStartup.init()` is called from BrowserGlue; `brand.ftl` moves to `browser/branding/vitre/`.
- Source path must have no spaces; at least 40 GB free.

**Re-run**
```
cd <project>\gecko
python spikes/packaging/stage.py --link
python spikes/packaging/run-dist.py --name packaging-noboot --url https://example.com --shoot prod-noboot:8 --timeout 30
python spikes/packaging/run-dist.py --name packaging-prod --boot spikes/packaging/boot-prod.js --url https://example.com
python spikes/packaging/run-dist.py --name packaging-devdist --boot spikes/packaging/boot-devloop.js --url https://example.com
python spikes/packaging/run-dist.py --name packaging-ident --boot spikes/packaging/boot-identity.js --url https://example.com
python spikes/packaging/test-remote.py [--app-ini]
python spikes/packaging/test-cache.py [--in-runtime]
```

## Compromises
- **App folder location.** Vitre's files must live inside the runtime directory (copy for release, junction for dev) or under `<profile>\chrome`. The harness rule "boot script next to the spike" cannot load child actors.
- **Exe stays Firefox.** `firefox.exe` keeps its name, embedded icon and version info, so Task Manager and Windows-created shortcuts still say Firefox. Titles, window icons, taskbar grouping, About and brand strings are changed at runtime instead.
- **Icon is set per window from script.** The static `chrome\icons\default\*.ico` route did not work, so each new top-level window is branded on `domwindowopened`.
- **Stock identity kept.** Data root and registry names are shared with the user's Firefox by name (separated only by `-profile` and per-path values). The renamed `application.ini` isolates them but changes the UA and has had far less exercise.
- **Module hot reload is partial.** `.sys.mjs`, window ES modules and actors stay cached for the process; a 1.2 s in-place restart is the practical answer.
- **Personal use only.** This layout ships Mozilla's official binary with changed behaviour, which the distribution policy does not allow under the Firefox marks. A public release needs a source build with own branding.
- **No FINDINGS.md.** The Write tool refused the file; the content is in this output.
- **Evidence gaps.** `test-cache.py`, `test-remote.py` and the first `boot-ua.js` variant print their results to stdout; the per-run `log.txt` holds only the browser-side lines or the last run. Re-running the scripts reproduces them.

## Risks
- **Launching without `-profile`.** Any path that starts `runtime\firefox.exe` directly (double-click, Firefox's own "make default", a taskbar pin made by Windows) would use `%APPDATA%\Mozilla\Firefox`, the user's real Firefox data. The launcher, a matching Start Menu shortcut and hiding Firefox's default-browser UI are all needed.
- **Shared names with the user's Firefox under the stock identity.** Per-path values under `HKCU\Software\Mozilla\Firefox\{Launcher, PreXULSkeletonUISettings, Default Browser Agent}`, a per-path folder in `C:\ProgramData\Mozilla-...\updates`, and machine policies under `Software\Policies\Mozilla\Firefox` apply to Vitre as well.
- **AutoConfig unsandboxed mode.** `general.config.sandbox_enabled=false` is an enterprise feature that release 157 still honours; Mozilla could restrict it. A fork removes the dependency.
- **Internal APIs move between versions.** `safeForUntrustedWebProcess`, the `moz-src:` module URLs and the `browser.xhtml` CSP are all recent. Pin the runtime version and re-run the spike scripts on every bump.
- **Mixed identities break single instance.** With the renamed ini, a launcher that omitted `XUL_APP_FILE` started a second browser on the same profile instead of handing the URL over.
- **Pre-XUL skeleton window.** Firefox may draw a Firefox-shaped placeholder before Vitre's UI appears (pref `browser.startup.preXulSkeletonUI`). Not checked.
- **Pinning and default-browser registration are untested.** Both write outside the spike folder, so only the required keys are listed.
- **Harness process lookup after restart.** After an in-place restart the new process's command line no longer names the profile, so `firefox_pids` misses it.
- **Fork does not fit this machine.** The build docs ask for 40 GB free; 32 GB were free at the end of the spike, and the project path contains spaces.
- **Legal reading is mine, not a lawyer's.** The personal-use / public-release line is drawn from Mozilla's published policies.

## Files
gecko\spikes\packaging\dist-files\config.js
gecko\spikes\packaging\dist-files\config-prefs.js
gecko\spikes\packaging\dist-files\policies.json
gecko\spikes\packaging\dist-files\browser-application.ini
gecko\spikes\packaging\dist-files\vitre.ico
gecko\spikes\packaging\app\chrome.manifest
gecko\spikes\packaging\app\modules\VitreStartup.sys.mjs
gecko\spikes\packaging\app\modules\VitreProbe.sys.mjs
gecko\spikes\packaging\app\actors\VitreProbeParent.sys.mjs
gecko\spikes\packaging\app\actors\VitreProbeChild.sys.mjs
gecko\spikes\packaging\app\pages\home.html
gecko\spikes\packaging\app\pages\about.xhtml
gecko\spikes\packaging\app\pages\ownwindow.js
gecko\spikes\packaging\app\locales\en-US\branding\brand.ftl
gecko\spikes\packaging\launcher\Launcher.cs
gecko\spikes\packaging\launcher\Vitre.cmd
gecko\spikes\packaging\launcher\Vitre.ps1
gecko\spikes\packaging\stage.py
gecko\spikes\packaging\run-dist.py
gecko\spikes\packaging\test-remote.py
gecko\spikes\packaging\test-cache.py
gecko\spikes\packaging\make-override-variant.py
gecko\spikes\packaging\boot-prod.js
gecko\spikes\packaging\boot-devloop.js
gecko\spikes\packaging\boot-identity.js
gecko\spikes\packaging\boot-actor-variants.js
gecko\spikes\packaging\boot-override.js
gecko\spikes\packaging\boot-builtin.js
gecko\spikes\packaging\boot-remote.js
gecko\spikes\packaging\boot-cache.js
gecko\spikes\packaging\boot-restart.js
gecko\spikes\packaging\boot-ua.js
gecko\spikes\packaging\boot-ts.js
gecko\spikes\packaging\ts-proof\build.sh
gecko\spikes\packaging\ts-proof\src\modules\TsProbe.sys.ts
gecko\spikes\packaging\xulapp\application.ini
gecko\spikes\packaging\xulapp\chrome\main.js
gecko\spikes\packaging\testext\manifest.json
gecko\spikes\packaging\testext-priv\manifest.json
gecko\spikes\packaging\dist\Vitre\Vitre.exe
gecko\spikes\packaging\out\packaging-noboot\prod-noboot.png
gecko\spikes\packaging\out\packaging-prod\log.txt
gecko\spikes\packaging\out\packaging-devdist\log.txt
gecko\spikes\packaging\out\packaging-devdist\dev-2-home-page.png
gecko\spikes\packaging\out\packaging-ident\log.txt
gecko\spikes\packaging\out\packaging-ident\ident-3-about.png
gecko\spikes\packaging\out\packaging-ident\ident-2-branded.icon.png
gecko\spikes\packaging\out\packaging-identapp\log.txt
gecko\spikes\packaging\out\packaging-xulapp\log.txt
gecko\spikes\packaging\out\packaging-ownwin\log.txt
gecko\spikes\packaging\out\packaging-remote\log.txt
gecko\spikes\packaging\out\packaging-prodout\log.txt
gecko\spikes\packaging\out\packaging-profchrome\log.txt

# Independent verification

## Overall
The spike's architecture conclusion holds: layer on browser.xhtml, loaded by AutoConfig from a folder inside the runtime. I reproduced 23 of its 24 "proven" claims on my own copy of the stock runtime; the 24th is refuted in full, and three recipe statements plus one side-effect statement are wrong.

**Needs action now.** The stock runtime writes shortcuts into the user's Start Menu on every fresh profile, and every spike using `tools\run.py` is doing it. The user's own per-user `Firefox.lnk` now points at `gecko\runtime\firefox.exe` with no arguments, so "Firefox" in the Start Menu starts the spike runtime against the real Firefox profile store. Two prefs stop it (`browser.shell.customIcon.enabled=false`, `browser.privacySegmentation.createdShortcut=true`); they need to go into `tools\run.py` and the product defaults.

I did not delete or restore the three affected `.lnk` files in `%APPDATA%\Microsoft\Windows\Start Menu\Programs` (`Firefox.lnk`, `Firefox Private Browsing.lnk`, `Vitre Private Browsing.lnk`). Removing them lets the all-users shortcut to the real Firefox apply again; that is the user's call. My first five runs, before I found this, also retargeted them.

**Wrong in the recipe:**
- config.js does not run before the profile exists. The profile is already selected and locked, and ProfD is readable there.
- The `<link>` stylesheet added in `browser-window-before-show` applies after the first two paints, so Firefox's UI does flash. `windowUtils.loadSheetUsingURIString` in the same handler is synchronous.
- `general.useragent.compatMode.firefox` does not restore the stock UA under a renamed identity; only `general.useragent.override` does.

**"Not possible" answers that change:**
- Window icon from an `.ico` file works once the root element has an `icon` attribute (claim 20, refuted in full).
- The engine exe can be renamed or resource-edited for personal use and still runs (claim 23); the edited copy loses its signature.
- Child actors do load under the stock harness if the boot script copies them into `<profile>\chrome`.

**Also new:** after an in-place restart the command line is a bare `firefox.exe`, so nothing may depend on it. A config.js guard keyed on a marker file in the profile works as a second line of defence against bare launches, but cannot stop Gecko from locking a profile first.

Still unverified by anyone: taskbar pinning, default-browser registration, Vitre's own update procedure, and the source build.

Everything is in `gecko\spikes\packaging\verify\`; `VERIFY.md` has the per-claim table and re-run commands. Outside that folder my runs left per-path values under `HKCU\Software\Mozilla\Firefox` and an updates folder under `C:\ProgramData\Mozilla-...`, the same kind the spike reported; the empty `VitrePkgSpike` AppData trees I created are removed.

## Confirmed
- Claim 1 (AutoConfig loads Vitre into every window with no VITRE_BOOT): reproduced on my own copy of the stock runtime (verify\dist\Vitre\runtime, staged by verify\vstage.py). verify\out\noboot\noboot-9.png shows the badge on a real Wikipedia page, OS title 'Gecko (software) - Wikipedia — Vitre'; verify\out\prod\log.txt P1-P7 pass including a second window. Timeline: init 101 ms, before-show 811 ms, delayed-startup 1058 ms.
- Claim 2 (runtime registration of content/skin/resource): verify\out\devdist\log.txt T1.1-T1.3 pass.
- Claim 3 (manifest override of aboutDialog.xhtml): T1.4 and T6.1 pass; verify\out\devdist\dev-3-about-override.png shows 'About Vitre' with the Vitre icon in the title bar.
- Claim 4 (manifest override of browser.xhtml from AutoConfig): verify\out\ovr\log.txt O1-O4 pass; override-browser-xhtml.png shows both badges on a working browser window.
- Claim 5 (content processes read Vitre files only inside the runtime dir or <profile>\chrome): app outside the runtime fails P4-P6 with 'Failed to load chrome://vitre/content/actors/VitreProbeChild.sys.mjs' (verify\out\prodout); junction runtime\vitre passes (verify\out\prod); junction <profile>\chrome passes (verify\out\profchrome). The spike's follow-on conclusion about the stock harness is wrong, see refuted.
- Claim 6 (.sys.mjs singleton; chrome:// and resource:// URLs are separate instances): T2.1-T2.3 in verify\out\devdist\log.txt.
- Claim 7 (JSWindowActor pair in a web content process, needs safeForUntrustedWebProcess): T3.1-T3.3 pass; verify\out\actorflag\log.txt shows no flag -> "Window protocol 'VitreProbe' doesn't match remote type 'webIsolated=https://example.com'", remoteTypes does not help, the flag works. Pref dom.jsipc.check_safeForUntrustedWebProcess=true.
- Claim 8 (chrome stylesheet loads via loadSheetUsingURIString and <link>): T4.1-T4.2, dev-1-styles-on-web-page.png shows both badges. The timing promise attached to it in the recipe is refuted separately.
- Claim 9 (privileged chrome://vitre/content/pages/home.html in a tab): T5.1-T5.4, dev-2-home-page.png. It runs in the parent process with system principal (remoteType null).
- Claim 10 (loadSubScript, <script type=module>, import() in a subscript, importESModule global:'current'; CSP blocks eval and inline): T4b.1-T4b.4 pass.
- Claim 11 (custom -app XUL app launches on 157 but is toolkit-only): verify\out\xulapp\log.txt: BrowserGlue and chrome://browser/ missing, webextension-modules toolkit only, UA VitrePkgSpike/0.1. Partial verdict stands.
- Claim 12 (own window via -chrome: gBrowser undefined, extension sees tabs=0): verify\out\ownwin\log.txt. Partial verdict stands; I found no better route than the browser.xhtml override of claim 4.
- Claim 13 (full browser under a renamed identity via -app runtime\browser\application.ini): verify\out\identapp\log.txt: name VitrePkgSpike, own data root, gBrowser/SessionStore present, X1 extension test passes. The identity also survives an in-place restart (verify\out\restartcmd-appini). One UA detail is wrong, see refuted.
- Claim 14 (installBuiltinAddon from a resource:// URL, unsigned, privileged, experiment API): verify\out\addons\log.txt E1 passes with REQUIRE_SIGNING=true. Extended: E2 shows the add-on persists and starts by itself on the next start with no re-install call.
- Claim 16 (launcher, single instance, URL hand-off, keyed by profile): verify\vtest-remote.py output: Vitre.exe, Vitre.cmd and Vitre.ps1 all hand over to instance A in 0.2-0.8 s with one parent process, also with a profile path containing a space, URLs containing & and %20, and a bare relaunch. Remote window class is Mozilla_firefox_<profile path>_RemoteWindow. Same under --app-ini (class Mozilla_vitrepkgspike_...). Not observed with the user's real Firefox running; isolation is by mechanism.
- Claim 17 (-osint forwarding): the working shape is confirmed (launch E arrives; injection attempt I stays one URL, no second tab). I did not re-run the negative half ('-profile P -osint -url X' being ignored).
- Claim 18 (window title via an L10nRegistry source carrying brand.ftl): verify\out\brand\log.txt V1-V3 and V6: holds after a tab switch, on about:preferences ('Settings — Vitre'), in a private window ('Vitre Private Browsing') and for menu strings ('About Vitre').
- Claim 19 (window icon via nsIWindowsUIUtils.setWindowIcon): verify\out\icon-a\montage.png shows the Vitre icon read back with WM_GETICON on main, second, private, About and Library windows.
- Claim 21 (per-window AppUserModelID via setGroupIdForWindow): every capture line of verify\out\icon-a reads aumid='Vitre.Browser.PackagingSpike', including the private window. The NS_ERROR_ILLEGAL_VALUE on one early hidden window is reproduced and harmless.
- Claim 24 (no self-update): U1 passes in verify\out\prod (appUpdate not allowed, update service disabled). verify\out\hardened passes all checks with updater, maintenanceservice*, default-browser-agent, pingsender, crashreporter, crashhelper and private_browsing removed.
- Claim 26 (no stale code from the startup cache): verify\vtest-cache.py --in-runtime with a real copy inside the runtime: v1 -> v2 -> v3 all picked up on the next start with no flag, including a same-size edit of window.js.
- Claim 27 (reload without restart; in-place restart): verify\out\devdist2\log.txt T7.0-T7.6 pass including T7.5 actor reload with ?query; verify\out\restart R1: restart took 1139 ms and ran the edited module.
- Claim 28 (esbuild TypeScript build plus tsc check): rebuilt into verify\app in 0.48 s; tsc 7.0.2 exits 0 in 0.25 s and exits 1 with TS2322 on a deliberate error; verify\out\ts TS1 and TS2 pass.
- Claim 29 (legal position): consistent with Mozilla's pages as fetched today. Distribution policy: only unaltered copies may be distributed under the marks; 'you may not add to, remove, or change any part of the software', including default settings and extensions. MPL FAQ: own new files in a larger work need not be MPL. Not legal advice.
- Claim 30 (source build, unverified by the spike): the quoted requirements match the current Windows build page (40 GB free, 4 GB RAM minimum / 8 GB+ recommended, no spaces in the path). Nothing was built by me either.
- Claims 22 (pinning, default-browser registration) and 25 (Vitre's own update procedure) remain unverified; I did not test them.

## Refuted
- Claim 22 evidence and the side-effects statement: 'Nothing was written to the Start Menu or registry'
  why: The stock runtime writes Start Menu shortcuts by itself on every fresh profile (StartupOSIntegration.onStartupIdle and CustomIconManager.maybeCreatePerUserStartMenuShortcut; pref browser.shell.customIcon.enabled defaults to true). On this machine %APPDATA%\Microsoft\Windows\Start Menu\Programs now holds 'Vitre Private Browsing.lnk' (created 08:49 by the packaging spike), 'Firefox Private Browsing.lnk' (created 07:50 by the first harness run), and the user's own 'Firefox.lnk' (created 2026-09-21) now targets gecko\runtime\firefox.exe with no arguments. That shortcut shadows the all-users one, so 'Firefox' in the Start Menu starts the spike runtime without -profile. Proof of cause: test profiles record browser.shell.customIcon.perUserStartMenuShortcutCreated=true. Proof of fix: with browser.shell.customIcon.enabled=false and browser.privacySegmentation.createdShortcut=true the pref is absent and 'Vitre Private Browsing.lnk' kept its 09:02:55 timestamp through all my later runs (verify\out\noshortcut).
- Claim 20: window icon via chrome\icons\default\<name>.ico is not possible
  why: It works. Firefox 157's browser.xhtml no longer has an icon attribute, so nothing asks for main-window.ico; that is why the spike's attempt failed (reproduced in verify\out\icon-c\montage.png: Firefox icon, and the Firefox private-browsing icon on the private window). Setting documentElement.setAttribute('icon','vitre') before layout plus runtime\browser\chrome\icons\default\vitre.ico gives the Vitre icon on main, second, private, About and Library windows with no setWindowIcon call (verify\out\icon-b\montage.png, run with VITRE_ICON_ATTR=vitre).
- Claim 23: the exe itself (file name, embedded icon, version resource) cannot be rebranded without a source build
  why: verify\vtest-exe.py: K1, a byte-identical copy named vitre-engine.exe runs the full browser, every child process carries that image name, signature still Valid. K2, a copy edited with the Win32 UpdateResource API (icon group 1 replaced by vitre.ico; FileDescription/ProductName 'Firefox' -> 'Vitre') also runs, including a sandboxed content process and the child actor; the shell icon is the Vitre icon (verify\out\exe-k2-resedit\shell-icons.png). Costs: K2 is no longer signed, must be redone per runtime update, DRM host verification is untested, and it is a further modification of Mozilla's binary, so personal use only.
- Summary and compromises: 'With the stock harness (boot script outside the runtime), child actors cannot load at all'
  why: verify\vboot-stock-actor.js run with tools\run.py on the untouched gecko\runtime: the boot script writes the actor modules and a chrome.manifest into <ProfD>\chrome\vitre-verify\, autoRegisters it and registers the actor. S1-S4 pass, both in a content process that existed before the registration and in a new one (verify\out\stockactor\log.txt).
- Recipe: config.js 'runs about 85 ms after process start, before the profile exists. Do not touch ProfD there.'
  why: verify\vconfig-probe.js (verify\out\cfgprobe\log.txt): at 68 ms ProfD, ProfLD and PrefD already resolve to the profile directory. verify\vtest-guard.py G1: a process that exits inside config.js has already left parent.lock, compatibility.ini, .startup-incomplete and startupCache in a previously empty profile dir. The profile is selected, locked and version-stamped before AutoConfig runs.
- Recipe: append <link rel=stylesheet> in browser-window-before-show 'so Firefox's UI never flashes'
  why: verify\vboot-paint.js with VITRE_PAINT_PROBE=1, same order in three runs: link.sheet is still null at the first requestAnimationFrame (992 ms) and at MozAfterPaint #1 and #2 (994, 1068 ms); the link's load event comes at 1074 ms, after browser-delayed-startup-finished. A sheet added in the same handler with windowUtils.loadSheetUsingURIString is applied immediately (computed style correct at 811 ms).
- Claim 13 detail: 'general.useragent.override or general.useragent.compatMode.firefox fixes' the UA under the renamed identity
  why: verify\out\ua runs: compatMode.firefox=true gives '... Gecko/20100101 Firefox/157.0 VitrePkgSpike/157.0', not the stock UA. Only general.useragent.override yields the exact Firefox UA. browser.runtime.getBrowserInfo().name also changes (extension title read 'browser=VitrePkgSpike/157.0').

## Improved
- Window icon (claim 20, was not-possible)
  finding: Set the root attribute icon="vitre" before layout and ship runtime\browser\chrome\icons\default\vitre.ico. Hook browser-window-before-show for browser windows; for other chrome windows use domwindowopened plus a capture-phase DOMContentLoaded listener (code in verify\app\modules\VitreStartup.sys.mjs, VITRE_ICON_ATTR branch). Gecko loads the multi-size .ico itself, synchronously. Services.dirsvc AChromDL is empty; the directory used is AChrom = runtime\browser\chrome. Evidence: verify\out\icon-b\montage.png. setWindowIconFromExe(Vitre.exe, 0 or 32512) did not give the Vitre icon in two tries (verify\out\icon-d, icon-d2); dropped.
- Exe rebranding (claim 23, was not-possible)
  finding: For personal use the engine exe can be renamed (plain copy, signature stays valid) or resource-edited with UpdateResource (icon and version strings; signature lost). Both run the full browser with sandboxed children (verify\vtest-exe.py, verify\out\exe-k1-renamed and exe-k2-resedit). Task Manager and shell would then show Vitre. Untested: DRM playback and antivirus reaction to the unsigned copy.
- Child actors under the stock harness (claim 5 follow-on)
  finding: Other spikes do not need a modified runtime: copy actor modules into <ProfD>\chrome\<name>\ at run time, write 'content <name> ./' there, autoRegister, then registerWindowActor with safeForUntrustedWebProcess. Works in existing and new content processes (verify\vboot-stock-actor.js, verify\out\stockactor\log.txt).
- System add-on locations (claim 15, was unverified)
  finding: Resolved as not usable. Firefox 157's XPIProvider has no browser\features location any more (system add-ons are built-ins listed in omni.ja), and an unsigned XPI in runtime\distribution\extensions is not installed on this release build (verify\out\addons\log.txt D1, REQUIRE_SIGNING=true). installBuiltinAddon is the add-on route; it persists across restarts (E2) provided its resource:// root is registered early, which the manifest 'resource' line does.
- Launch guard against a bare firefox.exe
  finding: verify\vconfig-guard.js: config.js ends the process (ctypes ExitProcess) unless <ProfD>\vitre-profile exists; the launcher creates that marker. verify\vtest-guard.py: G1 refused start shows no window and runs no Vitre code; G2 normal start passes P1-P7; G3 in-place restart is still allowed. It cannot prevent Gecko from selecting and locking a profile first, so it is a second line of defence, not a fix. Editing runtime\application.ini in place does not change the identity (verify\out\appini-inplace), so a bare launch always uses the Mozilla\Firefox data root.
- In-place restart drops the command line
  finding: After Services.startup.quit(eAttemptQuit|eRestart) the process command line is just "...\firefox.exe" and XRE_PROFILE_PATH is already consumed; ProfD and the renamed identity are kept (verify\out\restartcmd, restartcmd-appini). Never key behaviour on the command line. This is also why the harness reports 'restart-after: no window found'.
- Brand coverage beyond brand.ftl
  finding: Manifest lines 'override chrome://branding/locale/brand.properties ...' and 'override chrome://branding/content/icon32.png ...' work for legacy string bundles and in-product brand images (verify\out\brand V4, V5). Remaining visible leftovers come from toolkit/branding/brandings.ftl sub-brands (Firefox View, Firefox Relay, Firefox Home, Firefox Suggest, Firefox Labs, Mozilla VPN/Monitor); only 47 lines across 238 .ftl files hard-code Firefox or Mozilla. Overriding brandings.ftl the same way is untested.
- Typed chrome:// imports in TypeScript (claim 28)
  finding: tsconfig "paths": { "chrome://vitre/content/*.mjs": ["./src/*.ts"] } gives real cross-module types through chrome:// imports with no ambient 'declare module' (verify\ts-proof\tsconfig.paths.json; tsc reports TS2322 and TS2339 through such an import).
- Legal alternative worth evaluating (claim 29)
  finding: Mozilla's wiki describes 'unbranded builds' of release and beta: built by Mozilla, without the Firefox name and logo, and honouring xpinstall.signatures.required=false. Whether bundling one with Vitre's layer is acceptable for a public release, instead of an own source build, is an open question for the user to check with Mozilla's policy; I did not download or test one. Source: https://wiki.mozilla.org/Add-ons/Extension_Signing

## Recipe corrections
1. Stop the Start Menu writes. Add to the product's default prefs and to tools\run.py PREFS (every spike uses it): browser.shell.customIcon.enabled=false and browser.privacySegmentation.createdShortcut=true. Without them every fresh profile rewrites the user's per-user Firefox.lnk to a bare <runtime>\firefox.exe and creates '<brand> Private Browsing.lnk'.

2. config.js timing. The profile is already selected and locked when config.js runs, and ProfD is readable there. Drop 'before the profile exists / do not touch ProfD'. Add the profile-marker guard from verify\vconfig-guard.js (launcher creates <profile>\vitre-profile; config.js exits if it is missing; VITRE_ALLOW_ANY_PROFILE=1 for the harness).

3. Hiding Firefox's UI before first paint. In browser-window-before-show use win.windowUtils.loadSheetUsingURIString(url, win.windowUtils.AUTHOR_SHEET). A <link> appended there loads about 260 ms later, after two paints. Keep <link> only for non-critical styles.

4. Window icon. Prefer the icon attribute plus runtime\browser\chrome\icons\default\<name>.ico (multi-size, synchronous, no flash of the Firefox icon). Without any icon call, private windows show Firefox's private-browsing icon. Keep setWindowIcon as fallback. Put icon="vitre" directly on the root of Vitre's own documents such as about.xhtml.

5. Never key on the command line. After an in-place restart it is a bare firefox.exe; -profile, -no-remote and the URL are gone, though the profile and identity persist.

6. UA under a renamed identity. Only general.useragent.override restores the stock UA; compatMode.firefox appends the app token. The override string must be regenerated per runtime version. getBrowserInfo().name changes too, which add-ons may sniff. This supports keeping the stock identity.

7. 'resource' manifest line. Do not import modules through it (second instance), but keep one resource mapping if a built-in add-on is used: installBuiltinAddon needs a resource:// root registered before the add-on manager starts.

8. Profile location. %APPDATA%\Vitre is the Electron build's userData folder (Cache, history.json, settings.json are in it today). %APPDATA%\Vitre\Profile nests the Gecko profile inside it, and with -profile the disk cache also lives in that roaming folder (ProfLD equals ProfD). Choose a separate folder deliberately.

9. Pinning. Treat the Start Menu shortcut to Vitre.exe with the same AppUserModelID as required, not optional: without it Windows is expected to pin the process image, a bare firefox.exe (Windows behaviour, not tested).

10. Boot scripts run in every new browser window. A test script that opens windows must guard itself (pattern at the top of verify\vboot-icon.js), or captures get overwritten.

11. Home and settings pages run in the parent process with system principal. Never insert page-derived HTML; keep the CSP meta and use textContent.

12. Mozilla's own messages speak as Vitre once brand.ftl is overridden (seen: 'We've updated our Privacy Notice to reflect the latest features in Vitre' in verify\out\exe-k2-resedit\exe-window.png). Turn the messaging system off; the UserMessaging policy is the likely lever, not tested.

13. Dev structure. If modules are TypeScript, use the tsconfig paths mapping for chrome:// imports instead of ambient declarations.

14. Rollback note for updates (not tested): swapping in an older runtime will hit Firefox's downgrade protection on the profile; the launcher would need -allow-downgrade for a rollback.