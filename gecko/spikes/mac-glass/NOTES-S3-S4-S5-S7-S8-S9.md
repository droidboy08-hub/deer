# mac-glass spike: S3 lifetime, S4 input, S5 ordering, S7 cost, S8 native popover, S9 count

2026-11-15. Firefox 157 engine (`runtime/Deer Dev.app`) on macOS 26.7.1, arm64, one built-in Retina
display (1728 x 1117 pt, 120 Hz). Nothing in `gecko/src` changed: every glass panel is a XUL `<panel>`
built at runtime by `behavelib.js` (anchored, `openPopup(anchor, position, x, y)`) or `glasslib.js`
(`openPopupAtScreen`), with toolkit's menupopup appearance, so Gecko wraps the popup window in
`NSGlassEffectView`. All panels are `level="parent"` (child windows of Deer's window), like
`panelhost.ts` makes Deer's menus.

## Status (20:00): incomplete, the screen stayed locked

The Mac's screen locked at 13:57, before the first engine run, and was still locked at 20:00. Captures
need it unlocked (the task's rule), and so do real full screen, DOM full screen, key-window and focus
tests, frame timing and window geometry (details in "The screen was locked" below). So:

| Experiment | State |
|---|---|
| S4 Input, synthesized keys | **Done** (39 checks, three panel variants) |
| S4 real keys, Accessibility focus | Not run (needs Deer to be the active app) |
| S5 Ordering | **Logic done** for alert(), beforeunload and the window-modal dialog; DOM full screen, tooltip, menu order and all captures not done |
| S3 Lifetime, S7 Cost, S8 Popover, S9 Count | Scripts written and run end to end, but their numbers, key-window facts and captures all need the unlocked screen |

**No `glass-behave-*.png` capture exists yet.** Everything is ready: one command runs the rest, one
engine at a time, waiting up to 30 min for an unlocked screen before each run:

```
cd gecko && zsh spikes/mac-glass/run-behave.sh            (or: ... run-behave.sh s3 s8)
```

It builds `wininfo` into `$TMPDIR/mac-glass-behave/`, starts `behave_mon.py` beside each run, and
keeps each run's logs in `logs/<run name>/`. The runs take about 30 min in all. The S3 and S7 raw
videos land in `$TMPDIR/mac-glass-behave/vids/`; `video_markers.py <video>` measures S3's (the panel's
blue square against the red marker drawn where it belongs); cut filmstrips, then delete the videos.

## Files

| File | What it is |
|---|---|
| `behavelib.js` | Test helpers (window.GB): `anchored()` opens a glass panel from a placeholder made at runtime in `#vitre-root` (followanchor, noautohide or auto-hide, ignorekeys or not); `ask()` / `start()` / `startTrack()` / `result()` talk to `behave_mon.py`; `frameStats()` (rAF intervals), `rel()` (window-server frames relative to Deer's window) |
| `behave_mon.py` | Runs beside `tools/run.py`; answers the test's requests from the run's log: `WINLIST` (every on-screen window of the run, front to back, with its layer), `AXINFO` / `AXFOCUS` (Accessibility: key window, focused element), `CPU` (engine processes and WindowServer from cumulative CPU time, GPU utilisation from ioreg), `TRACK` (the window server's frame of every window of the run, every ~4 ms), `REC` (60 fps video), `HELPER` (another app's window), `KEYS` (real key events posted to the engine process only), `SHOT` (screen-area picture with the run's and the helper's windows) |
| `wininfo.swift` | The monitor's window-server tool (build: `xcrun swiftc -O spikes/mac-glass/wininfo.swift -o <scratch>/wininfo`) |
| `s3-lifetime.js`, `s4-input.js`, `s5-order.js`, `s7-cost.js`, `s8-popover.js`, `s9-count.js` | One script per experiment. `GLASS_ONLY=<steps>` runs some steps only |
| `run-behave.sh` | Runs them all (or some), each with the monitor, waiting for an unlocked screen |
| `video_markers.py` | Per video frame: the panel's error from where Deer's window says it belongs (S3) |
| `logs/<run name>/` | Each run's log (`log.txt`), the monitor's log (`monitor.txt`) and the monitor's JSON answers (`beh-*.json`). The `*-locked` runs were taken with the screen locked |

One run by hand, from `gecko/` (the monitor first, then the engine):

```
rm -f tests/menus/out/log.txt
/usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> --vids <video folder> &
/usr/bin/python3 -u tools/run.py --test spikes/mac-glass/<script>.js --name <name> --url about:blank --timeout 500 --out tests/menus/out --pref ui.systemUsesDarkTheme=1 [--pref widget.macos.native-popovers=true] [--no-capture]
```

What each script does and the captures it will make (all in `tests/menus/out/`):

| Script | Steps | Captures |
|---|---|---|
| `s3-lifetime.js` | A Settings stand-in (anchored to a centred placeholder, followanchor, noautohide), a quick-view stand-in (anchored under a capsule at the top-right, auto-hide) and a panel pinned with openPopupAtScreen. One `moveTo`; a 40-frame animated move; the window 220 pt off the screen's right edge; one `resizeTo`; 40-frame animated resizes from the right/bottom and from the left (window-server TRACK every ~4 ms, and a 60 fps video of the first); a second Deer window over the first; another app's window over Deer without focus; another app taking focus; minimise and restore; native full screen in and out | `glass-behave-s3-open`, `-moved`, `-offscreen-right`, `-resized`, `-after-drags`, `-second-window`, `-helper-over`, `-deactivated`, `-reactivated`, `-restored`, `-fullscreen`, `-fullscreen-left` |
| `s4-input.js` | As below, plus real key events and the Accessibility focus | `glass-behave-s4-typed`, `-real-before` |
| `s5-order.js` | alert(), beforeunload, a window-modal dialog, DOM full screen, a Deer tooltip, a Deer menu after the panel and a panel after the menu (window order from the window server) | `glass-behave-s5-alert`, `-beforeunload`, `-windowmodal`, `-domfullscreen`, `-domfullscreen-left`, `-tooltip`, `-menu-over-panel`, `-panel-after-menu` |
| `s7-cost.js` | A test field where the address capsule is, a 560 px list under it, 1-8 rows; 40 keys at 20 a second and 60 keys one per frame, for a CSS box (backdrop blur 30), a glass panel resized with `sizeTo` per key, and a glass panel kept at full height; handler time, frame intervals, the window server's delay to each new height, CPU/WindowServer/GPU; a 60 fps video of the sizeTo typing | `glass-behave-s7-before`, `-sizeTo-end` |
| `s8-popover.js` | With `widget.macos.native-popovers=true`: a nonnative control; an arrow popover without and with its arrow; an auto-hide popover; light and dark popovers over a white/black page; followanchor with glass inside the popover; typing (synthesized and real) and Esc; following a window move; Deer's menu with the pref on; whether Deer's auto-hide panel is rolled up and which window is key (AX) | `glass-behave-s8-control-nonnative-<sys>`, `-popover-notail-`, `-popover-input-`, `-popover-tail-`, `-popover-scheme-`, `-popover-glass-inside-` (sysdark and syslight) |
| `s9-count.js` | 0, 1, 4 and 8 glass panels (300 x 200) over a page that scrolls 6 px a frame and loops a video it recorded itself; 6 s per step, the series run twice in opposite orders; engine processes, WindowServer, GPU utilisation, frame intervals in Deer's window and in the page | `glass-behave-s9-eight-scrolling` |

Notes for whoever runs them:
- Background load: the owner's own Firefox kept the GPU at 77-92 % "Device Utilization" and WindowServer
  near 50 % CPU during this session, so S9 compares each step with its own baseline (0 panels).
- In the chrome document `innerHTML` is sanitized and drops `<input>` ("Flattening unsafe node"), and
  it is parsed as XML: `behavelib.js` builds panel content with DOMParser + importNode instead.
- `b.closeTab()` on a page with a beforeunload handler spins a nested event loop until the prompt is
  answered: call it from a timer (s5-order.js does).
- With `widget.macos.native-popovers=true` every followanchor panel becomes an NSPopover; a glass
  panel that must stay a plain popup window needs `nonnative="true"`.

## S4 Input (run `mac-glass-s4-locked`, synthesized keys; the real-key half was not run)

A Settings stand-in (anchored, followanchor, 560 x 340) holding an `<input>`, in three variants:
`deer` (noautohide, noautofocus, `ignorekeys="true"`: how panelhost.ts opens Deer's menus), `plain`
(noautohide, no ignorekeys) and `autohide` (the quick view / suggestions stand-in). The test put a
layer in Deer's Esc ladder and ⌘W ladder for the panel, as a glass Settings would.

What works, in all three variants (39 checks):
- `input.focus()` gives the field focus (`document.activeElement` and the focus manager agree);
  opening the panel with `noautofocus` leaves the page focused until then.
- Synthesized typing lands in the field, and the page under it gets none of the keys.
- ⌘A, ⌘C, ⌘X, ⌘Z, ⇧⌘Z, ⌘V; ⌘← (start), ⌥← (one word back), ⌘⌫ (delete to start).
- A synthesized IME composition ("にほん", committed as "日本") goes through compositionstart and
  compositionend in the field.
- **Where the IME candidate window would go:** the text rect Gecko answers through Deer's MAIN
  window's widget (what the main window's TextInputHandler asks, as popups never become key) is the
  field's first character on screen: (393, 343) screen pt for a field whose text starts at x 392.
  So the candidate window should land on the field, not offset by the panel's position.

What does not work (the router treats every `<panel>` as a Firefox panel):
- **Esc does nothing at all.** In all three variants the panel stays open: Deer's router sees an open
  `<panel>` (`keys.ts` `popupOpen('panel')` in `escTaken`) and leaves Esc to it, so Deer's Esc ladder
  (the test's layer) never runs; and the popup manager does not close the panel either, not even the
  auto-hide one without `ignorekeys`. The field gets the keydown; the page gets nothing.
- **⌘W closes the panel through `closePanels()`, before Deer's ⌘W ladder runs.** ⌘W is browser-first:
  `keys.ts dispatch()` first calls `closePanels()`, which hides every open `<panel>` (the doorhanger
  aside), and only then runs `closeTab`, whose close layers come first. A layer that asks the panel's
  state finds it closed, so **the tab under the panel closes too** (2 tabs → 1). A layer that keeps
  its own "open" flag keeps the tab (2 → 2), but the panel was still hidden by `closePanels()`, not
  by the layer (no close motion; Settings would get a popuphidden it did not ask for).
- **⌘L closes the panel** (`editAddress()` calls `closePanels()`) and focus goes to the address field.
  The same `closePanels()` runs on every browser-first key, a tab switch, and when Settings,
  Downloads, find or the switcher open.
- So a glass Settings or Downloads panel needs keys.ts to tell Deer's own glass panels from Firefox's
  (a marker attribute, skipped by `popups`/`escTaken` and by `closePanels()`), or every one of these
  paths closes it or swallows its Esc.

Manual checks left for the owner: a real Pinyin or Japanese input source in the panel's field (where
the candidate window appears), and VoiceOver reading the field.

## S5 Ordering (run `mac-glass-s5-locked`: logic only, the screen was locked; no captures)

- **alert()**: the tab prompt opens with the panel open (the panel stays open) and takes focus
  (`browser.dialogFrame`). Esc then closes the alert (not the panel); Deer's router does nothing;
  focus returns to the panel's field.
- **beforeunload** (closing the tab of a page that asks): the prompt opens with the panel open and
  takes focus; cancelling it keeps the tab; the panel stays open. (Note for tests: `b.closeTab()`
  spins a nested event loop until the prompt is answered.)
- **Window-modal dialog** (what ⌘Q's quit prompt is): opens with the panel open, takes focus; the
  panel stays open.
- DOM full screen did not start while the screen was locked; to be re-run.

## The screen was locked from 13:57 (still at 20:00)

The Mac's screen locked before the first run and stayed locked. While it is locked:
- captures are impossible (the task's rule), and so are real full screen and DOM full screen;
- Deer's refresh driver is throttled (rAF every ~165 ms in one step, 16.7 ms in others), so no frame
  timing measured then counts;
- the window server reports every window moved and scaled by about 0.9, and not by one common
  transform (Deer's 1200 x 760 window at (40, 40) is listed as 1081 x 685 at (122, 91); the panels'
  listed places do not fit the same mapping), so no geometry measured then counts;
- Deer is never the active app, so nothing about key windows or rollups on focus loss counts.

What the locked runs still showed (logic only; each to be confirmed unlocked):
- `mac-glass-s3-locked`: every glass window of the run is listed at window layer 0, the same level as
  Deer's window (not 101, the pop-up menu level). The auto-hide panel B stayed open through
  programmatic `moveTo`, `resizeTo`, a second Deer window and `minimize()`. When Deer's window hung
  220 pt off the screen's right edge, Gecko moved B 200 pt left to keep it on screen (no longer under
  its anchor). After `minimize()` no glass window was on screen; after `restore()` all three were back,
  open. Gecko's own rectangles had A re-centred after a resize and B following the right edge.
- `mac-glass-s8-locked` (`widget.macos.native-popovers=true`): the arrow and followanchor panels open
  (state "open"); typing works in the popover's field, both synthesized and with real key events posted
  to the engine; Esc does nothing there either; Deer's menu still opens with the pref on. Closed
  popovers' windows stayed in the window list (to be checked unlocked: possibly a lock artefact).
- `mac-glass-s5-locked`: after the failed DOM full-screen request, newly opened glass panels reported
  "open" (or stayed "showing") but no glass window was on screen any more (to be checked unlocked).
- `mac-glass-s7-locked`, `mac-glass-s9-locked`: smoke runs only (the scripts work end to end).
