# Spike result: mac-glass (Apple's real Liquid Glass in Deer on the Mac)

Verdict: works-with-compromises.
- **GO:** real `.regular` glass for every floating surface 66 px tall or more: menus, Settings, the Downloads panel, popovers and the quick view.
- **Conditional:** small floating glass (tooltips, a one-row suggestion list) needs an ink rule first.
- **NO-GO to ship:** the tab-row capsules as real glass windows. They stay a demo.
- **Recommended:** option C. Real glass for everything that floats, and the One-row kept in CSS, retuned to the measured real glass.

2026-11-15. Firefox 157 (`runtime/Deer Dev.app`) on macOS 26.7.1, arm64, built-in Retina display (1728 x 1117 pt, 2 px per pt, 120 Hz).
- The Mac itself was in Dark mode. "Mac Light/Dark" in captures and tables means Gecko's `ui.systemUsesDarkTheme=0/1`.
- Nothing in `gecko/src` changed. Every glass window is a XUL `<panel>` built at runtime by the spike scripts, the way `src/window/modules/menus/panelhost.ts` builds Deer's menus: menupopup appearance, so Gecko wraps the popup window in `NSGlassEffectView`, and `level="parent"`.
- Sources:
  - [NOTES-S1-S2-S6-S11.md](NOTES-S1-S2-S6-S11.md): look, shape, motion, media queries;
  - [NOTES-S3-S4-S5-S7-S8-S9.md](NOTES-S3-S4-S5-S7-S8-S9.md): behaviour;
  - [NOTES-S10.md](NOTES-S10.md): the capsule demo;
  - the research brief (facts F1-F11, the per-surface table, capsule options A/B/C).
- I re-read the numbers below from `logs/analysis-*.txt` and `logs/mac-glass-s10-*/` and looked at the captures myself.

**The screen lock decides how much counts.** The Mac's screen locked at 13:57 and was still locked at 21:14.
- S1, S2, S6 and S11 ran before that and have real pictures and numbers.
- S3, S4, S5, S7, S8, S9 and S10 ran locked. They are logic results only: Gecko's state and the window server's list. They have no pictures, and their timing and geometry do not count.
- A locked screen throttles frames to 60 Hz or worse, lists every window at about 0.9 scale and in shifted places, and never makes Deer the active app.

## Summary

1. **It is the real thing, and it is frosted, not "nearly clear".**
   - It blurs less than Deer's copy:
     - the real glass spreads a sharp edge over about 20 CSS px (18-30, 10-90 %), which is a Gaussian sigma of about 8 px;
     - Deer's `blur(14px)` spreads one over about 36 px.
   - It adds a milky fill of its own, so it still looks as frosted: large light glass over black shows grey 172, and large dark glass over white shows grey 99.
   - Text under it is unreadable at every size, and the rim bends the page like a lens.
2. **Against Deer's copy:**
   - Over white and black the capsule tones are nearly the same: 249 against Deer's 254 over white, 19 against 36 over black.
   - Over colours the real glass is paler and even. Deer's copy is more saturated, with a visible gradient.
   - On white, Deer draws a clear outline; the real glass shows almost none.
   - The shape differs: Deer's capsules are pills, the real glass is a rectangle with 12 px corners.
3. **Small glass flips light or dark by itself, and Deer's text does not follow.**
   - Every piece 64 px tall or less turns light over near-white (grey 230 and up) and dark over near-black (grey 26 and down), whatever its `color-scheme`. Pieces 66 px and taller never flip.
   - Gecko keeps painting the ink of the `color-scheme`, so a flipped piece shows white on white or black on black, at a contrast of 1.05-1.12:1.
   - Under Mac Dark, on a white page, 9 of 19 test pieces were unreadable.
4. **Big glass is clean.**
   - The 688 px Settings-sized panels never flipped. Their ink contrast was 6.0:1 or better in every valid capture.
   - `color-scheme: light dark` follows the Mac's Light/Dark setting as Gecko sees it.
   - An explicit `light` or `dark` overrides it, which is exactly the owner's rule: big panels follow the Mac, and Deer's Settings > Mode overrides.
5. **Shape is fixed:** 12.0-12.9 px corners at every size, and CSS cannot change it. A true pill exists only at 24 px tall (radius 12.1). Clipping a 36 px piece to a pill leaves the glass corners showing as slivers.
6. **Motion works, with recipes.**
   - `-moz-window-transform` and `-moz-window-opacity` animate the whole glass window. They work only from a chrome style sheet: inline styles are silently dropped.
   - The scale pivots on the top-left corner, so it must be centred with a translate.
   - Starting the opacity at 0 hides a one-frame pop.
   - Fades briefly show the sharp page through the glass ("ghosting").
   - The shadow is fine.
7. **Typing in a glass panel works** (synthesized keys).
   - Editing shortcuts, an IME composition and the candidate-window position all work.
   - **Deer's own key router fights it:** Esc does nothing, ⌘W closes the panel *and* the tab under it, and ⌘L, a tab switch or opening Settings/Downloads/find/the switcher closes the panel. That is fixable with a marker in `keys.ts`.
8. **Firefox's prompts open with a glass panel still open, and they take the keyboard.** This covers alert(), "Leave this page?" and the window-modal (⌘Q-style) dialog. A glass Settings must therefore hide or close itself when one opens. The visual stacking was not captured.
9. **No stale backdrop on 26.7.1.** A page that changed or scrolled under open glass showed through correctly within the capture delay.
10. **Capsule demo (S10):** built and runs end to end, with 50 of 50 logic checks passing.
    - The glass windows sit exactly on their capsules.
    - They follow Deer's row 16-36 ms late (1-2 frames, measured while locked at 60 Hz).
    - Keeping 9-10 windows in place costs 0.2-0.3 ms of script per frame.
    - **No picture or video exists yet:** the screen was locked. See "The capsules" for how to make them.

## What ran

| Experiment | State | Evidence |
|---|---|---|
| S1 Look | **Done** (both Mac modes) | `glass-look-*` captures, `logs/analysis-*.txt` |
| S2 Shape | **Done** | `glass-look-shape-*`, CORNER lines in `logs/analysis-*.txt` |
| S3 Lifetime (move, resize, minimise, Spaces, full screen) | Logic only (locked) | `logs/mac-glass-s3-locked/` |
| S4 Input | **Done with synthesized keys** (39 checks). Real keys and VoiceOver not run | `logs/mac-glass-s4-locked/` |
| S5 Ordering | Logic only for alert(), beforeunload and the window-modal dialog. DOM full screen, tooltip and menu order not run | `logs/mac-glass-s5-locked/` |
| S6 Motion | **Done** (60 fps recordings, filmstrips) | `glass-look-motion-*`, `logs/s6*-sysdark.txt` |
| S7 Cost of `sizeTo` per key | Smoke run only | `logs/mac-glass-s7-locked/` |
| S8 NSPopover (`widget.macos.native-popovers`) | Logic only (7 of 7 pass, locked) | `logs/mac-glass-s8-locked/` |
| S9 Count (CPU/GPU with 0/1/4/8 panels) | Smoke run only | `logs/mac-glass-s9-locked/` |
| S10 Capsule demo | Logic only (50 of 50; window-server track) | `logs/mac-glass-s10-dry/`, `logs/mac-glass-s10-locked/` |
| S11 Accessibility | Media-query half **done**. The owner's System Settings half not done | `logs/s11-*.txt` |
| S12 Film of today's row (the "fake" artefact) | **Not run by any part** | - |

## The brief's facts, checked

| Fact | The brief said | The spike found | Status |
|---|---|---|---|
| F1 | Real glass exists only in floating (popup) windows | Every real glass seen was a popup window. The capsule demo needs one window per capsule | Confirmed |
| F2 | It is `.regular`; nothing else can be chosen | The heavy frost and the milky fill match `.regular`, not the highly translucent `.clear` (the flip alone would not tell them apart). No style or tint can be set from chrome | Confirmed by eye |
| F3 | 12 px corners, fixed; a pill only at 24 px | 12.0-12.9 px for 36, 160 and 300 px pieces in both schemes. `border-radius: 40px` measures 12.1. 24 px gives radius 12.1. Clipping to 18 px leaves 12 px slivers (`glass-look-shape-zoom.png`) | Confirmed |
| F4 | Deer picks light/dark per window. Small glass (64 pt or less) may also flip, and Deer's text may not follow | The flip is real and the text does not follow (1.05-1.12:1). The cut is sharp between 64 and 66 px. Over grey 0 and 26 it turns dark, over 230 and 255 light; over 51-204 and six saturated colours it keeps the scheme (so the cuts lie between 26 and 51, and between 204 and 230). No hysteresis, under about 1 s, each piece alone, text pages count as white. Big glass keeps its scheme, and `light dark` follows the Mac | **Changed:** the worst case is real |
| F5 | Real glass is lightly frosted, close to clear, clearer than Deer's copy | Frosted, and text under it is unreadable. The blur is a little less than Deer's (about 20 px edge against about 36 px), plus a milky fill (172 over black for large light, 99 over white for large dark). The tone over white and black matches Deer's | **Refuted** |
| F6 | The Mac's Reduce Transparency, Increase Contrast and Clear/Tinted apply automatically | `prefers-reduced-transparency` and `prefers-contrast` exist and are wired in 157, in chrome and in pages (shown with Gecko overrides). Toggling the real System Settings, and what the glass itself does then, was not tried | Partly confirmed |
| F7 | Each surface is its own window; 5-8 at once at most | 38 glass windows opened at once without a failure (`s1b-flip.js`). The demo keeps 9-10 in place per frame for 0.2-0.3 ms of script. CPU/GPU cost was not measured (S9 needs the unlocked screen) | **Changed:** no hard limit seen; cost unknown |
| F8 | They behave like windows (follow the window, may trail on resize, auto-hide ones close on move/focus loss, always above in-window content, text fields work, IME/VoiceOver unknown) | Text fields, editing keys and a synthesized IME work. The IME candidate rect is the field's place on screen. New: Deer's key router breaks Esc/⌘W/⌘L for any `<panel>`. Firefox's prompts open over an open panel and take the keyboard. Locked hints, to confirm: the windows sit at layer 0 (child windows, not menu level); an auto-hide panel survives *programmatic* moves, resizes and minimise; near an off-screen edge a panel slides away from its button; panels come back after minimise/restore. Real drags, live-resize lag, Spaces, native full screen, a second display and ⌘-Tab were not tested | Mostly confirmed, plus a router conflict |
| F9 | Apple's NSPopover behind `widget.macos.native-popovers` | It opens, takes typing (synthesized and real keys) and leaves Deer's menus working (locked run). Esc does nothing in it either. With the pref on, every `followanchor` panel becomes a popover, so other glass panels need `nonnative="true"`. Look, shape and key-window behaviour not seen | Partly confirmed |
| F10 | Before macOS 26: the older frosted material, 6 px corners | Not testable on this Mac | Untested |
| F11 | Possible stale-backdrop bug (seen on 26.2) | Not seen on 26.7.1. A page turned black under open glass matched a fresh open within 0.4 s, and scrolling stripes showed through in the right place, moving and stopped (`glass-look-stale-*`, `glass-look-scroll-*`) | **Refuted** for 26.7.1 |

## New facts (not in the brief)

- **N1. The small-glass ink rule.** Deer can predict the flip; Gecko cannot read it. For a glass piece 64 px tall or less:
  - backdrop grey 230 and up: dark ink;
  - grey 26 and down: light ink;
  - otherwise: the scheme's ink.

  Text pages count as white. The alternative is to keep every glass window at least 66 px tall.
- **N2. Motion recipe** (S6, `s10-probe4.js`):
  - Set the window properties only from a chrome style sheet, for example through CSS variables. `style.setProperty()` of them is silently dropped.
  - Open with opacity 0 to 1 together with `translate(w*0.02, h*0.02) scale(0.96)` to none. `-moz-window-transform-origin` is ignored.
  - Keep fades short (240 ms), so the ghosting stays brief.
  - `transitionend` fires.
  - `CSS.supports()` and `getComputedStyle()` cannot detect these properties, so gate on the platform instead.
  - The Big Sur missing-shadow bug (1672091) did not reproduce.
- **N3. Click-through:** `pointer-events: none` on the panel makes its window ignore the mouse, so input reaches Deer's window underneath (synthesized events, 2 of 2). A real pointer was not tried.
- **N4. `-moz-element()` works in chrome:** under an opacity-0 ancestor, with the caret and the selection. This is what lets the demo paint Deer's own capsule content into the glass windows.
- **N5. Media queries:** test support by `(…: no-preference)` matching, not by `.media` (a made-up value parses). `layout.css.prefers-reduced-transparency.enabled` is false yet the query works.

## Numbers

| What | Value | Source |
|---|---|---|
| Blur, 10-90 % edge width | Real about 20 CSS px (18-30). Deer `blur(14px)` about 36 px | S1 BLUR lines |
| Glass tone, large light | 247 over white, 172 over black | `analysis-sys*.txt` |
| Glass tone, large dark | 99 over white, 33 over black | same |
| Capsule tone, real against Deer | 249 against 254 over white, 19 against 36 over black | `glass-look-summary-row.png` |
| Ink contrast, 688 px panels | 6.0:1 to 16.5:1 on white, black and text, 8.3:1 to 15.1:1 on photo and stripes (the 1.67 in `analysis-sysdark.txt` is the discarded first try, where the panels had closed) | `analysis-sys*.txt`, `analysis-textphoto-*.txt` |
| Ink contrast, a flipped small piece | 1.05:1 (white on white), 1.12:1 (black on black) | same |
| Unreadable pieces out of 19 (contrast under 3:1), Mac Light / Mac Dark | white page 4 / 9, black page 9 / 4, text page 4 / 9, Home photo 7 / 2 | S1 notes |
| Flip thresholds (36 px pieces) | dark at grey 0 and 26, light at grey 230 and 255, kept at 51-204 and on six saturated colours | `glass-look-flip-ramp-sysdark.png` |
| Corners | 12.0-12.9 px, and 12.1 px with `border-radius: 40px` | CORNER lines |
| Demo: script cost to keep 9-10 windows on their capsules | median 0.2-0.3 ms per frame, p95 about 1.5 ms, worst 11-17 ms | `logs/mac-glass-s10-*/` MEASURE |
| Demo: glass behind the row | 16-36 ms (best-fit delay per step). After that shift, 0.1-2 pt off (3.9-6.5 pt while typing opens). Without it, up to 172 pt during the "open a tab in front" spring | `logs/mac-glass-s10-locked/analysis-track.txt` (locked, 60 Hz) |
| Demo: catch-up jumps over 20 pt | 4 in 14.6 s (22-51 pt), consistent with that delay seen through a sparse window list (about 16 samples a second) | same |
| Demo: a programmatic window move | the glass windows moved in the same window-server sample as Deer's window | same |
| Glass windows open at once without failure | 38 (S1b), 10 (demo) | S1 notes, S10 |

## Go / no-go per surface

"Small" means 64 px tall or less: it flips, so it needs N1 or must be made at least 66 px tall.

| Surface | Verdict | Conditions from the spike |
|---|---|---|
| Menus and submenus | **GO** (already real glass) | Move them onto GlassHost. A one-item menu is about 46 px, which is small: give menus `min-height: 66px` or use N1 |
| Extensions panel, extension popups, page actions | **GO** (already) | A tiny extension popup can be small: same check |
| Firefox permission prompts, app-menu notices | **GO** | The CSS-only restyle from `extensions/css.ts` |
| Downloads quick view | **GO** | Anchored, auto-hide, 16 px corners become 12. It slides off its button when the window hangs off the screen edge (S3, locked) |
| Video quality picker | **GO** | Anchored to the pill, auto-hide |
| Home background popover | **GO** | Stay-open, with Deer's own outside-click handling (the file picker takes focus). 20 px corners become 12 |
| Downloads quit prompt | **GO** | Stay-open, centred. Check that it is not under the ⌘Q prompt (S5 captures pending) |
| Settings | **GO with conditions** | 688 px, so it never flips. `light dark`, or Deer's Mode as an explicit scheme. Needs the `keys.ts` marker (Esc, ⌘W, ⌘L, `closePanels()`). Hide or close it on tab and window-modal prompts, DOM full screen, the switcher and Peek (S5). Tooltips must show above it, and Settings uses `setTip`. Drop-down lists stay inside or become sub-panels. N2 motion. 22 px corners become 12 |
| Downloads panel | **GO with conditions** | As Settings |
| Address suggestions | **Conditional** | One row is 640 x 50, which is small and flips. Use N1, or `min-height: 66px`. Keep typing in Deer's field, and do not roll the list up on a click in the field. The "grow out of the pill" motion is lost. 18 px corners become 12 |
| Tooltips | **Conditional** | 26 px tall, so small. Either N1, from the luma under the tip, or Gecko's tooltip material (`-moz-default-appearance: tooltip`, Apple's own tooltip vibrancy, which should not flip; untested). Needed before Settings, or its tips hide under it |
| Split-view drop preview, Peek hint pill | NO-GO | Little gain |
| Video download pill, lifted capsule, Peek sheet and header, split cover, crash card, tab switcher, Find, Firefox's in-window dialogs | NO-GO (stay CSS, retuned with the row) | They follow the page every frame, hold a page, fill the window or belong to Firefox |
| Tab-row capsules | **NO-GO to ship** (demo only) | See "The capsules" |
| Traffic-lights capsule | NO-GO | A glass window over it would blur Apple's buttons and could not drag the window |

## The capsules

| Option | What the owner would see | Recommendation |
|---|---|---|
| **A36**: one real-glass window per capsule, 36 px tall | Rectangles with 12 px corners. The traffic lights stay Deer's CSS pill, the one pill in the row. Favicon-only capsules become rounded squares. Real frost and lens | **No-go to ship.** See the reasons below this table |
| **A24**: the same as 24 px pills | True pills, but each capsule's glass is a third smaller than its 36 px click area | **No-go to ship:** A36's problems, and a smaller row |
| **B**: today's CSS row, retuned to the measured real glass | Today's pills, springs, hover fill, scroll fade and the Downloads–Extensions bridge, with tone, blur, colour and the flip matched to Apple's | **GO** |
| **C**: B plus real glass for everything that floats | Real Apple glass wherever something opens over the page; the row matched to it | **GO, recommended** |

Why A36 is a no-go to ship:
- Each capsule flips by itself over near-white or near-black (N1), while Deer's ink follows the row's theme. On mixed pages single capsules lose their text: a dark page with a white header under part of the row, or a photo with sky.
- The glass trails the row's springs by 1-2 frames, and it was seen up to 172 pt off during a fast spring.
- It needs one window per visible tab, against Apple's "use few".
- It loses the hover fill, the Downloads–Extensions bridge and the scroll fade.
- The windows float over Settings, the switcher, Peek and Firefox's dialogs unless each is hidden every time.
- There is no press feedback.

**Where B starts (measured):**
- **Blur:** sigma about 8 px, instead of `blur(14px)`.
- **Tone:** already close. Real small glass is 249 over white and 19 over black; Deer's capsules are 254 and 36.
- **Colour boost:** much weaker than today's ×1.9. The real glass is pale and even over colours.
- **Outline:** a faint shadow, not a clear rim.
- **Ink:** Apple's flip thresholds (grey 26 and 230).
- **Accessibility:** follow `prefers-reduced-transparency` and `prefers-contrast`.

S12 (filming today's row to find what reads as "fake") has not been done. It should come first in B.

**Demo status:** `capsule-demo.js` shows every state three ways: today's CSS row, real glass at 36 px, and real glass 24 px pills. The states are article, scrolled, dark, Home, photo, hover, typing, resized and menu. It also records the same 14.5 s motion script in each variant.
- Logic: all 27 state x variant combinations place every window on its capsule, and the windows let clicks through.
- No picture or video exists yet. I started the runner again at 20:44. It waited its full 30 min for an unlocked screen and ran nothing (exit 3 at 21:14). Nothing was left running.
- To make them (about 10 min; it waits up to 30 min for an unlocked screen): `cd gecko && zsh spikes/mac-glass/run-capsule-demo.sh`.
- Then show `tests/menus/out/glass-demo-summary.png` and `glass-demo-motion-rows.mp4` first. `logs/mac-glass-s10/analysis.txt` gets the per-capsule ink contrast, which is the real test of the flip risk in the row.

## Recommended build order

0. **Finish the spike on an unlocked screen.** The floating-surface work below does not depend on the capsule decision, so it can start now.
   - `run-capsule-demo.sh`: the owner then decides on the capsules.
   - `run-behave.sh`: S3 drag and resize lag (with `video_markers.py`), S5 stacking captures, S7, S8 look, S9 CPU/GPU.
   - S12: film today's row.
1. **GlassHost** (`src/window/glass/host.ts`, Mac only, generalised from `panelhost.ts`). It needs:
   - the `keys.ts` marker, so Deer's glass panels are skipped by `popups`, `escTaken` and `closePanels()`, with their own Esc and ⌘W ladder layers;
   - the N2 motion recipe;
   - `color-scheme` (`light dark`, or Deer's Mode);
   - the 66 px rule or the N1 ink rule;
   - click-through;
   - hide or close on prompts, DOM full screen, the switcher and Peek.

   Tests: Esc closes the top glass panel; ⌘W closes it and not the tab; ⌘L and a tab switch leave Settings alone or close it on purpose.
2. **Menus onto GlassHost**, with no change in behaviour (`tests/menus/mac-*` still pass) and the short-menu flip fix.
3. **Small anchored panels 66 px or taller:** the quick view, video picker, Home popover, quit prompt and Firefox doorhangers. Low risk; they prove anchoring, auto-hide against stay-open, and the screen-edge slide.
4. **Tooltips** (glass with N1, or the tooltip material). They must come before Settings.
5. **Settings, then the Downloads panel.**
6. **Address suggestions** (N1 or 66 px).
7. **Row option B retune.** It is CSS-only and can run in parallel from step 1, after S12. The same recipe goes into find, the Peek header and the switcher.
8. **Optional: NSPopover** for button-hung panels, only if the unlocked S8 passes and the owner accepts the system shape.

## Still open

- **Needs the unlocked screen:**
  - the capsule demo pictures and videos;
  - S3: real drags (they cannot be synthesized: the owner drags by hand), live-resize lag, Spaces, native full screen, ⌘-Tab;
  - S5: DOM full screen, tooltip and menu order, and stacking captures;
  - S7 cost, S8 look, S9 CPU/GPU;
  - real keystrokes and the Accessibility focus (S4).
- **Lock artefacts to re-check:**
  - closed popovers still listed on screen (S8);
  - glass panels reporting "open" but not shown after a failed DOM full-screen request (S5).
- **The owner's own checks:**
  - a real Japanese or Chinese input source in a glass field (where the candidate window lands);
  - VoiceOver;
  - Reduce Transparency, Increase Contrast and Tinted in System Settings with glass open;
  - switching the Mac's Light/Dark while a panel is open;
  - a real window drag with an auto-hide panel open.
- **Not testable here:** macOS before 26 (F10).

## Decisions still needed from the owner

1. **Capsules,** after the demo: C (today's row, retuned), or real glass as 36 px rectangles (A36) or 24 px pills (A24)?
2. **Tooltips:** real glass with Deer predicting the flip (it can still miss near the thresholds), or the Mac's own tooltip material (no flip, not Liquid Glass, untested)?
3. **A one-line suggestion list:** make the list at least 66 px tall, or predict the flip?
4. **When a page prompt or the quit prompt opens over Settings or Downloads:** close the panel, or hide it until the prompt is answered?
5. **From the brief, still open:**
   - the suggestions losing "grow out of the address pill" (Q3);
   - Apple's popover for panels that hang from a button (Q5);
   - Macs before macOS 26 (Q6).

## Pictures for the owner

In `gecko/tests/menus/out/for-owner/` (copies; the originals stay in `tests/menus/out/`). There is no capsule-demo picture or recording yet. Until there is, 01, 09 and 10 are the closest thing.

| File | Copied from | What it shows |
|---|---|---|
| `glass-01-capsules-today-vs-real-glass.png` | `glass-look-summary-row.png` | Deer's row today (left, CSS pills) next to four real-glass capsules: 36 px light, dark and follow-the-Mac, plus a 24 px pill. Six backgrounds: white, black, a text page, stripes, scrolling stripes and the Home wallpaper. A word that vanishes is the small-glass flip. The strips come from both Mac modes |
| `glass-02-settings-today-deer-copy-dark.png` | `hunt-10-settings-dark.png` | Deer's Settings today (its CSS copy, dark) over the "Float glass" article |
| `glass-03-settings-real-glass-same-page.png` | `glass-look-text-big-syslight.png` | Three Settings-sized (688 px) real-glass panels over the same article, Mac Light: light, dark and follow-the-Mac. Compare the middle one with 02 |
| `glass-04-settings-today-deer-copy-light.png` | `mac-row-7-settings.png` | Deer's Settings today, light, over the Home wallpaper. It was taken at 00:42, before the "Mac setting" wording fix |
| `glass-05-settings-real-glass-mac-light.png` | `glass-look-photo-big-syslight.png` | Real-glass Settings panels over the same wallpaper, Mac Light. The right one follows the Mac and is light |
| `glass-06-settings-real-glass-mac-dark.png` | `glass-look-photo-big-sysdark.png` | The same under Mac Dark. The right one turns dark |
| `glass-07-small-glass-words-vanish.png` | `glass-look-summary-flip-sysdark.png` | A white page (left) and a black page (right), Mac Dark. Pieces 24, 36 and 64 px tall flip and their words vanish; 66 and 300 px pieces never do |
| `glass-08-where-small-glass-flips.png` | `glass-look-flip-ramp-sysdark.png` | 36 px light (L) and dark (D) pieces over a grey ramp and six colours. They flip only over near-black and near-white |
| `glass-09-corners-zoomed.png` | `glass-look-shape-zoom.png` | Corners at 6x, over black (top) and white (bottom). A 36 px "pill" made by clipping still shows the glass's 12 px corners; only a 24 px piece is a real pill |
| `glass-10-capsule-animation.png` | `glass-look-motion-capsule-sysdark.png` | A 36 px real-glass capsule opening (rows 1-3) and closing (rows 4-6), frame by frame. It can only scale and fade as a whole window |

When the demo has run, put `glass-demo-summary.png` and `glass-demo-motion-rows.mp4` in front of these.

## Files

| File | What it is |
|---|---|
| `NOTES-S1-S2-S6-S11.md`, `NOTES-S3-S4-S5-S7-S8-S9.md`, `NOTES-S10.md` | The three parts' notes: methods, all numbers and every capture's meaning |
| `glasslib.js`, `s1-look.js`, `s1b-flip.js`, `s6-motion.js`, `s6b-motion.js`, `s11-media.js`, `analyze.py`, `recorder.py`, `motion_*.py` | S1, S2, S6, S11 |
| `behavelib.js`, `behave_mon.py`, `wininfo.swift`, `s3-…s9-*.js`, `run-behave.sh`, `video_markers.py` | S3, S4, S5, S7, S8, S9 (one command: `run-behave.sh`) |
| `capsule-demo.js`, `capsule-pages/`, `run-capsule-demo.sh`, `capsule_post.py`, `s10-probe*.js` | S10, the capsule demo |
| `logs/` | Every run's log and analysis (`*-locked` runs were taken with the screen locked) |
