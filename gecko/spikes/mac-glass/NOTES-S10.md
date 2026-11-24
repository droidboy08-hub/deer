# mac-glass spike S10: the capsule demo (the One row as real Liquid Glass windows)

2026-11-15. Firefox 157 engine (`runtime/Deer Dev.app`, build of 13:06 today, current with the working
tree) on macOS 26.7.1, arm64, built-in Retina display (1728 x 1117 pt, 2 px per pt). The Mac was in
Dark mode; runs pass `--pref ui.systemUsesDarkTheme=1`. Nothing in `gecko/src` changed: the demo
builds everything at runtime from the test file.

**Status: the demo is built and runs end to end, but no picture or video exists yet.** The Mac's
screen was locked for the whole of this part: from before 20:06 (the previous part reports 13:57) to at
least 20:41. I polled every 60 s for 30 min, as the task allows, and then stopped. Captures are
impossible while the screen is locked. Everything below comes from logic runs (Gecko's rectangles, the
window server's list, timings).

**To make the pictures and videos** (about 10 min; it waits up to 30 min for an unlocked screen):

```
cd gecko && zsh spikes/mac-glass/run-capsule-demo.sh
```

It writes the files listed under "Captures it makes", the logs to `logs/mac-glass-s10/`, and the
numbers to `logs/mac-glass-s10/analysis.txt`. Then look at `glass-demo-summary.png` and
`glass-demo-motion-rows.mp4` first.

## What the demo is

`capsule-demo.js` (run by `run-capsule-demo.sh`) opens a normal 1280 x 800 Deer window with six tabs:

| # | Tab | Page | Host shown in the address capsule |
|---|---|---|---|
| 1 | Float glass - Field Notes | light article (#fbfaf7) | fieldnotes.example |
| 2 | Night Shift | dark code page (#15161a) | nightshift.example |
| 3 | Home | Deer's Home with the wallpaper (the Mac's desktop picture) | - |
| 4 | Wildlife - Long Exposure Club | five photos along the top (leaf, lightning, parrot, poppy, zebra; macOS's own account pictures) | wildlife.example |
| 5 | Tideline | light teal page | tideline.example |
| 6 | Refract | light page | refract.example |

The pages are `capsule-pages/*.html`, served by `python3 -m http.server` on 127.0.0.1:8765. The test
profile maps the `.example` names to 127.0.0.1 (`network.dns.localDomains`), so nothing leaves the Mac
and the capsules show real-looking hosts instead of `data:` URLs.

Then it shows every state three ways: today's CSS row (`-css`), real glass windows over the 36 px
capsules (`-36`), and real glass 24 px pills (`-24`).

### How the real-glass row is built (window.CD in capsule-demo.js)

- **Deer's row keeps doing everything.** Layout, the springs, hover growth, clicks, right-clicks and
  typing stay in Deer's own row. The demo only makes it invisible: `opacity: 0.001` on `#vitre-bar`,
  `#vitre-row-end`, `#vitre-omni-field` and `#vitre-omni-panel`. That keeps it hit-tested and painted,
  so its changes keep flowing. Its CSS glass layers are `display: none`.
- **One glass window per capsule.** Each is a XUL `<panel>` built the way `panelhost.ts` builds Deer's
  menus: menupopup appearance (so Gecko wraps the popup window in `NSGlassEffectView`, .regular,
  12 px corners), `level="parent"`, `noautohide`, `noautofocus`, `ignorekeys`. That makes 9 windows
  for 6 tabs, "+", Downloads and Extensions, and 10 while typing (the suggestions get one too).
- **Click-through.** `pointer-events: none` on the panel makes Gecko treat the popup as mouse-transparent
  (`IsMouseTransparent`, `setIgnoresMouseEvents`). A synthesized move over a glass capsule then reaches
  Deer's row under it, not the panel (`s10-probe.js`: 2 of 2 moves went to the row; without it, 2 of 2
  went to the panel). A real pointer was not tried (it would have moved the owner's cursor).
- **The content is Deer's own pixels.** Each window paints its capsule's faces with `-moz-element()`:
  a live picture of Deer's content, in Deer's colours. In chrome it paints:
  - also for an element under an ancestor at opacity 0;
  - with the caret and the selection of a focused field (`s10-probe2.js`);
  - with the element's own scale and opacity (`s10-probe3.js`). That is why the demo paints the
    item's children, not the item: the item's scale and fade go to the window instead.
- **Every frame**, a `requestAnimationFrame` loop moves (`moveTo`) and sizes (`sizeTo`) each window
  onto its capsule.
  - A capsule entering or leaving (scale 0.6 and a fade on the CSS item) becomes
    `-moz-window-transform` (scale, centred by hand, because the pivot is the top-left, S6) and
    `-moz-window-opacity`.
  - These two are taken only from a chrome style sheet. An inline `style.setProperty` of them is
    silently dropped (`s10-probe4.js`: alpha stayed 1). So the sheet reads `var(--cd-wo)` and
    `var(--cd-wt)`, which the loop sets.
  - The window server then shows the fade (alpha 0 to 1 over about 150 ms) and the growth.
- **Light or dark.** Each window's color-scheme follows Deer's row theme: theme-light gives light;
  theme-dark, theme-clear and private give dark. Small glass may still flip by itself (S1).
- **Kept off Deer's panel handling.** The windows are removed from `keys.ts`'s list of open Firefox
  panels (`b.keys.popups`). Without that, `b.closePanels()` would close them on every tab switch and on
  ⌘L, and Esc would be left to them (S4). A `popuphiding` the demo did not ask for is also cancelled.
  None happened in the logic runs: 0 vetoes.
- **Typing.** While the address field is open, the active capsule's window shows the field's row: the
  glyph, the typed text and the caret, live through `-moz-element`. It also gets an inset 2.5 px
  focus ring drawn inside the glass, because the CSS field's outline cannot show outside a window.
- **The traffic lights keep Deer's CSS capsule.** A glass window over them would blur Apple's buttons:
  AppKit draws them in Deer's window, under every child window. Such a window also could not move the
  window. In the 24 px variant their CSS capsule is made 24 px tall (top 14) to match the pills; the
  buttons stay centred at y 26.

## Logic results (screen locked: no pictures, geometry from Gecko and from the window server)

The runner's dry run (`DRY=1 zsh run-capsule-demo.sh`, logs in `logs/mac-glass-s10-dry/`): 50 checks
passed, 0 failed. The track run with the monitor is in `logs/mac-glass-s10-locked/`.

- **Placement.** All 27 state x variant combinations worked: article, scrolled, dark, home, photo,
  hover, typing, resized and menu, each in css, 36 and 24.
  - Every glass window opened and sat on its capsule, by Gecko's own rectangle (`getOuterScreenRect`),
    to the pixel.
  - Theme per state: article theme-light, dark theme-dark, Home theme-clear, Wildlife theme-dark.
- **Cost of the sync.** The `requestAnimationFrame` loop over 9 or 10 windows (`MEASURE` lines):
  - script time per frame: median 0.2 ms, p95 1.4-1.5 ms, worst 4-17 ms;
  - 870-880 frames in 14.5 s. That is 60 Hz, the locked refresh rate.
  - During the 12.5 s motion script each tab window was moved 110-160 times and resized 55-135 times.
- **Lag, window server against Deer's row** (`logs/mac-glass-s10-locked/analysis-track.txt`, while
  locked, so 60 Hz and a slow window list; these numbers are only indicative):
  - The glass windows trace exactly the row's path, about 20-36 ms behind it (1.5-2 frames at 60 Hz).
    After shifting the row's timeline by that delay, the residual is 0.5-2 pt; without the shift, a
    capsule in a fast spring is up to 170 pt away.
  - That is: they follow, late, with no extra jumps.
  - A programmatic window move took the glass windows along in the same window-server sample as
    Deer's window (child windows).
- **The window server reports a transformed window at odd bounds** (`s10-probe4.js`: a 120 x 36 window
  with `translate(30px, 9px) scale(0.5)` was listed as 60 x 18 at another place). The lag analysis
  therefore skips the frames where a capsule is entering or leaving.

## Files

| File | What it is |
|---|---|
| `capsule-demo.js` | The demo: window.CD (the real-glass row) and the scenario (stills, motion videos, measurements) |
| `capsule-pages/` | The six demo pages and Molten Tin, the tab the motion script opens and closes |
| `run-capsule-demo.sh` | Serves the pages, waits up to 30 min for an unlocked screen, runs the demo with `behave_mon.py` beside it, then `capsule_post.py` |
| `capsule_post.py` | mp4s, side-by-side summaries, the ink-contrast table and the lag analysis (`logs/mac-glass-s10/analysis.txt`) |
| `s10-probe.js` | The row's DOM as the demo mirrors it. Also: click-through panels, `b.keys.popups`, `closePanels()`, a cancelled `popuphiding`, and `moveTo`/`sizeTo` call cost |
| `s10-probe2.js`, `s10-probe3.js` | `-moz-element()` in chrome: painting under opacity 0, caret and selection, own transform and opacity |
| `s10-probe4.js` | `-moz-window-opacity`/`-transform`: inline dropped, a chrome sheet with `var()` works per frame (window-server alpha) |
| `logs/mac-glass-s10-dry/` | The runner's dry run (all states and variants, logic only) |
| `logs/mac-glass-s10-locked/` | The first locked logic runs: stills logic, and the run with a window-server track and its analysis |

## What changes in each exercised step (logic runs)

- **A tab opening and closing.**
  - Every glass window is moved, and resized where its capsule's width changes, in every frame of the
    row's 420 ms spring.
  - The new or closing capsule's window scales (0.6 to 1) and fades with the CSS item. The window
    server's alpha goes 0, 0.07, 0.22, 0.41, 0.58, 0.71, 0.80, 0.87, 0.93, 1 over about 150 ms, and
    the listed width grows with it.
  - Opening a tab in front is the biggest move: the old active capsule shrinks from 400 to compact, the
    new one grows to 400, and the rest slide by up to 170 pt.
- **Hover growth.** The Tideline capsule grows from 96 to 116 with its close x. Its window is resized
  per frame and its neighbours' windows slide (about 7 pt). The hover itself reaches Deer's row through
  the click-through window.
- **Typing in the address capsule.**
  - The active capsule's window becomes the 640 px field, with the typed text and caret painted live
    from Deer's field.
  - The other tabs fold to favicon-only capsules, so their windows become 36 x 36 rounded squares
    (12 px corners).
  - The suggestions get a glass window of their own: 640 x 50 with one row ("liquid glass").
    **Under 64 px it is small glass and may flip light or dark by itself (S1).**
- **The window resized.** Narrowed to 960 and back, the "+", the right-hand tabs, Downloads and
  Extensions follow the row's re-layout.
- **A menu from a capsule.** A right-click on the Refract capsule goes through the glass to Deer's row
  and opens Deer's tab menu. The menu is itself a real-glass panel, shown later, so it is above the
  capsule windows. Nothing closed a capsule window: no hide was vetoed and no tick error occurred.
- **A programmatic window move** (`moveTo`, not a drag). The glass windows moved in the same
  window-server sample as Deer's window.

## Known, by construction (no picture needed)

- **Shape.**
  - At 36 px the glass is a 12 px-cornered rectangle (S2), so the row loses its pills.
  - The 24 px variant gives true pills but shrinks every capsule's glass by a third. The 36 px CSS hit
    areas stay as they are, so the glass is smaller than what takes the click.
  - Favicon-only capsules (typing, a crowded row) become rounded squares.
- **Lost from today's row.**
  - The hover fill (the glass cannot change its tint).
  - The Downloads-Extensions bridge, and any liquid joining: separate windows cannot merge.
  - The scroll fade of a crowded strip.
  - The traffic lights in real glass.
  - The window-level 18 px corners of the suggestions, which become 12.
- **The traffic-lights capsule stays Deer's CSS glass.** At 36 px it is the one pill in a row of
  rectangles. In the 24 px variant it is shrunk to a 24 px CSS pill.
- **Window count: 9 glass windows for six tabs, 10 while typing.** That is one per capsule, plus "+",
  Downloads, Extensions and the suggestions. A crowded row adds one per visible tab. Apple advises few.
- **Small glass flips.** Every capsule is under 64 px, so each one flips light or dark by itself over
  near-white or near-black (S1), while Deer's ink follows the row's theme. On a mixed page (a dark page
  with a white header under part of the row, a photo with sky) single capsules can lose their text.
  `capsule_post.py` measures each capsule's ink contrast once the pictures exist.
- **Input stays in Deer's window.** Clicks, hover, right-clicks and the wheel reach Deer's row through
  the click-through windows. Synthesized events were verified; a real pointer was not tried.
  - Real glass that takes no input cannot give press feedback of its own.
  - Dragging a tab (reordering, split view) moves Deer's invisible capsule. Its window would follow
    per frame, the same as in the springs.

## Captures it makes (tests/menus/out)

Each state in three variants: `-css` (today), `-36` (real glass over the 36 px capsules), `-24` (real
glass pills). Every capture has a small label on the page under the row saying which one it is.

| Capture | State |
|---|---|
| `glass-demo-article-*` | Field Notes (light article) active, six tabs |
| `glass-demo-scrolled-*` | The article scrolled 300 px: text under the row |
| `glass-demo-dark-*` | Night Shift (dark page) active |
| `glass-demo-home-*` | Home with the wallpaper active |
| `glass-demo-photo-*` | Wildlife (five photos under the row) active |
| `glass-demo-hover-*` | The pointer on Tideline: grown, with its close x |
| `glass-demo-typing-*` | Typing "liquid glass": the field and the suggestions |
| `glass-demo-resized-*` | The window at 960 px |
| `glass-demo-menu-*` | Refract's tab menu opened from its capsule |
| `glass-demo-summary-<state>.png` | That state's row band, CSS / 36 / 24 stacked, at 2x |
| `glass-demo-summary.png` | Every state, CSS / 36 / 24, at 1x: **show this first** |
| `glass-demo-motion.mp4` | Real glass, 36 px, 14.5 s: a background tab opens and closes, a tab opens in front and closes, hover growth, typing, the window narrowed and widened, a tab's menu |
| `glass-demo-motion-24.mp4`, `glass-demo-motion-css.mp4` | The same script with pills, and with today's row |
| `glass-demo-motion-rows.mp4` | The top 120 px of the three videos stacked (CSS, 36, 24), roughly in step: **show this second** |
| `glass-demo-motion-start-*.png` | The first frame of each video |

`logs/mac-glass-s10/analysis.txt` will hold the per-capsule ink contrast for every capture, the lag
per step (window server against the row, at the real 120 Hz), any snaps, and CPU for the CSS row
against the glass row (idle, and during the script).
