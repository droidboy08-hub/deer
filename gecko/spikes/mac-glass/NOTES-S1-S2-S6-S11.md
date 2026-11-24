# mac-glass spike: S1 look, S2 shape, S6 motion, S11 media queries

2026-11-15. Firefox 157 engine (`runtime/Deer Dev.app`) on macOS 26.7.1, arm64, Retina (2 px per pt). The Mac was in Dark mode, with Reduce Transparency and Increase Contrast off (`defaults read` found neither key). Nothing in `gecko/src` was changed. The glass pieces are XUL `<panel>`s built at runtime by `glasslib.js`, the way `src/window/modules/menus/panelhost.ts` builds them: menupopup appearance, `level="parent"`, `noautohide`, `noautofocus` and `ignorekeys`. "System Light/Dark" means `--pref ui.systemUsesDarkTheme=0/1`, which is Gecko's idea of the system. Each glass window's NSAppearance comes from its CSS `color-scheme`.

## Files

| File | What it is |
|---|---|
| `glasslib.js` | Test helpers (window.G): `panel()` opens a glass piece at window coordinates; `layout()` logs every piece's rectangle in capture pixels (`LAYOUT` lines); also `inContent`, `load`, `page` and `caption` |
| `s1-look.js` | S1 and S2, plus the media half of S11 (logged). Env `GLASS_ONLY=white,black,text,stale,scroll,shape,photo` runs only those sections |
| `s1b-flip.js` | S1 follow-up: the light/dark flip threshold of small glass (grey ramp and colours), with a hysteresis check |
| `s6-motion.js`, `s6b-motion.js` | S6. Real-speed animations recorded at 60 fps by `recorder.py` (ffmpeg avfoundation, cropped to Deer's window while recording) |
| `s11-media.js` | S11, media half: chrome and web-page `matchMedia`, run plain and with LookAndFeel overrides |
| `analyze.py` | Numbers from the captures: glass tone under each piece, ink contrast (WCAG), corner-radius fit, 10-90 % edge blur width |
| `logs/` | Run logs (`LAYOUT` lines included) and `analysis-*.txt` |

Captures are in `gecko/tests/menus/out/` and are named `glass-look-*`. The raw videos were deleted after the filmstrips were cut, because their last seconds showed the desktop after Deer quit.

Commands, from `gecko/`:

```
/usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s1-look.js --name mac-glass-s1 --url about:blank --timeout 400 --out tests/menus/out --pref ui.systemUsesDarkTheme=0   (then =1)
/usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s1b-flip.js --name mac-glass-s1b --url about:blank --timeout 300 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
/usr/bin/python3 spikes/mac-glass/recorder.py tests/menus/out/log.txt <scratch video dir> --timeout 280 &
/usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s6-motion.js --name mac-glass-s6 --url about:blank --timeout 300 --out tests/menus/out --pref ui.systemUsesDarkTheme=1   (s6b likewise)
/usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s11-media.js --name mac-glass-s11 --url about:blank --timeout 120 --out tests/menus/out --no-capture [--pref ui.prefersReducedTransparency=1 --pref ui.useAccessibilityTheme=1]
/usr/bin/python3 spikes/mac-glass/analyze.py spikes/mac-glass/logs/s1-syslight.txt
```

Filmstrips were cut with `ffmpeg -vf "select='between(n,A,B)',crop=...,tile=6x2"`. Frame numbers were found by measuring each frame (`motion_metrics.py <video> <showinfo times>`, `motion_edges.py <video> <frames>` and `motion_shadow.py <video> <frames>`, in this folder).

## Captures to show the owner first

| Capture | What it shows |
|---|---|
| `glass-look-summary-row.png` | Deer's row today (CSS glass pills, on the left) beside 4 real glass capsules (36 px light, dark and "light dark", and a 24 px pill) over the same page. One strip per backdrop: white, black, text page, stripes stopped, stripes scrolling, Home photo |
| `glass-look-summary-flip-sysdark.png` (`-syslight`) | The white page (left) next to the black page (right). Columns are color-scheme light, dark and light dark. Heights are 24, 36, 64, 66 and 300 px. Small glass flips and Deer's ink disappears; 66 px and taller never flips |
| `glass-look-flip-ramp-sysdark.png` | 36 px pieces, light (L) and dark (D), over greys 0-255 and six colours. Flips happen only near black and near white |
| `glass-look-shape-zoom.png` | Corners zoomed 6x, over black (top) and white (bottom). Shown: content clipped to 18 px with the 12 px glass sliver past it; a 36 px "pill" made by clipping, with the glass corners past it; a real 24 px pill; and the plain 12 px corner |
| `glass-look-white-big-*`, `-black-big-*`, `-text-big-*`, `-photo-big-*` | Three 688 px Settings-like panels: light, dark, and "light dark" |
| `glass-look-motion-*.png` | S6 filmstrips (see S6) |

All S1 and S2 captures, each in `-syslight` and `-sysdark`:

- `glass-look-{white,black,text,photo}-small-*`: the row with 4 real capsules, plus three columns of real glass.
- `glass-look-{white,black,text,photo}-big-*`: three 688 px panels.
- `glass-look-scroll-{small,big}-moving-*`: taken while the stripes page scrolls under the glass at 6 px a frame.
- `glass-look-scroll-{small,big}-stopped-*`: taken 0.9 s after the scroll stopped.
- `glass-look-stale-a-*` and `-stale-b-*`: the pieces were opened over the white page, then the page turned black under them; taken 0.4 s and 2.5 s later.
- `glass-look-shape-{black,white}-*`: the S2 test pieces. Numbered as follows:

| Piece | Test |
|---|---|
| 1 | plain |
| 2 | CSS border-radius 40 |
| 3 | content clipped to 18 px, tinted |
| 4 | 24 px tall |
| 5 | 36 px, content clipped to 18 px |
| 6 | 24 px dark |
| 7 | 36 px |
| 8 | 300 px, light |
| 9 | 300 px, dark |

`glass-look-photo-*` and `glass-look-text-*` were taken again after a first try went wrong. In the first try, a real key reached Home's focused address field during a capture (the address field shows "1." typed, and the pieces had closed). The script now focuses the page before capturing.

## S1 Look

**It is the regular style. It is frosted, not "nearly clear" (this contradicts brief F5).**
- Text under real glass is unreadable at any size tested.
- The blur width was measured from the stripe edges seen through the 300 and 688 px pieces (`analyze.py` BLUR). From 10 % to 90 % of an edge takes 18-30 CSS px, typically about 20, which is roughly a Gaussian sigma of 8 px. Deer's `blur(14px)` gives about 36 px over the same measure, so the real glass blurs a little less than Deer's.
- On top of the blur, the glass adds its own milky fill:

| Glass | Over black | Over white |
|---|---|---|
| Large, light | rgb 172 | 247 |
| Large, dark | 33 | 99 |

- Colour from the page shows through strongly and stays vivid. A light piece over `#ffcc00` is (255, 240, 106).
- The edges show lens refraction: page content bends near the rim.

**Compared with Deer's CSS row** (`glass-look-summary-row.png`):

| | Deer's CSS capsules | Real glass capsules |
|---|---|---|
| Over white | 254 | 249 |
| Over black | 36 | 19 |
| Over colours | more saturated, with a visible gradient across the capsule (small sampling area) | paler and more even (samples a wider area) |
| Shape | pills | rectangles with 12 px corners |
| Shadow on white | clear outline | almost invisible |

Over white and black the two look almost the same in tone.

**Small glass flips light and dark by itself, and Deer's text does not follow (F4 confirmed, and the worst case is real).**
- Pieces of 24, 36 and 64 px flip. Pieces of 66, 300 and 688 px never flip, and the cut between 64 and 66 is sharp.
- The flip ignores the panel's color-scheme. Gecko keeps painting the ink for that color-scheme, so the ink contrast falls to 1.1:1:
  - white ink on glass that turned light over white or text pages;
  - dark ink on glass that turned dark over black or dark photo areas.
- How many pieces became illegible (contrast below 3:1) out of the 19 per capture:

| Backdrop | System Light | System Dark |
|---|---|---|
| White page | 4 | 9 |
| Black page | 9 | 4 |
| Text page | 4 | 9 |
| Home photo | 7 | 2 |

  On white and on the text page, every small piece with dark ink stayed legible and every small piece with light ink did not. On black it was the other way round. The 688 px panels stayed legible in every capture.
- Thresholds, from `glass-look-flip-ramp-sysdark.png` and `logs/s1b-sysdark.txt`:
  - The glass turns dark over grey 0 and 26 of 255.
  - It turns light over grey 230 and 255.
  - Over grey 51 to 204, and over all six saturated colours (#ff3b30, #ffcc00, #34c759, #0a84ff, #af52de, #ff9500), it keeps its color-scheme. There dark-scheme pieces reach a contrast of 4.8 to 14.6 and light-scheme pieces 8.5 to 15.3.
- No hysteresis. The page was mirrored under the open pieces, and the result was identical, piece for piece, to opening them fresh on the mirrored page.
- The flip happens live, within the capture delay (under about 1 s).
- Each piece decides alone, from what lies under it. Over the Home photo, the 24 px light piece stayed light while the 36 and 64 px light pieces just below went dark.
- Text pages count as "white": the small dark-scheme pieces over text turned light.
- **What this means for the plan:** any glass piece 64 px tall or less needs ink chosen by this rule:
  - backdrop near white: dark ink;
  - backdrop near black: light ink;
  - otherwise: the ink of its color-scheme.

  Deer would have to sample the backdrop itself (`b.luma`) and predict Apple's decision. Gecko cannot read the decision. The alternative is to keep every glass piece at least 66 px tall.

**`color-scheme: light dark` follows the system appearance Gecko sees.** For example, the "light dark" column is light under system Light and dark under system Dark at 66 px and taller. So the owner's rule ("big panels follow the Mac, Deer's Settings > Mode overrides") works by putting `light dark` on the panel, or by setting an explicit `light` or `dark`.

**Stale backdrop (F11): not seen on 26.7.1.**
- The page turned black under the open glass. Within 0.4 s plus the capture's raise, the glass tones were exactly those of a fresh open over black: 19 for small pieces, 172 for large light, 33 for large dark (`glass-look-stale-a-*`).
- While the stripes page scrolled, the glass showed the current stripes, in the right place, both during the scroll and after it stopped (`glass-look-scroll-*`).

## S2 Shape

- **The corners are 12 px:** 12.0 to 12.9 CSS px, from a circle fit to the corner profile (rms 0.5 to 1 px), for 36, 160 and 300 px pieces in both schemes.
- **CSS `border-radius` does not change the glass.** With `border-radius: 40px` and `--panel-border-radius: 40px` on the panel, and 40 px on its content, the measured corner is still 12.1 px.
- **Clipping the content to a larger radius leaves the glass corners showing.**
  - With content clipped to 18 px, the fit finds the content's 18 px curve, and the glass's 12 px corner shows outside it as a sliver.
  - The sliver is plainly visible over black and faint over white.
  - So a 36 px "pill" made by clipping is not clean (`glass-look-shape-zoom.png`).
- **24 px tall gives a true pill:** the measured radius is 12.1, which is half the height.

## S6 Motion (system Dark; 240 ms unless said)

Variants tested:

| Variant | What it does |
|---|---|
| V1 | scale 0.96 to 1, plus opacity 0 to 1 |
| V2 | scale only |
| V3 | opacity only |
| V4 | scale with `-moz-window-transform-origin: 50% 50%` |
| V5 | `translate(6px, 6px) scale(0.96)` |

- **Both properties animate glass popups.**
  - `transitionend` fires for `-moz-window-transform` and `-moz-window-opacity`.
  - The whole window scales and fades together: glass, content and shadow.
  - `getComputedStyle()` returns "" for both properties, and `CSS.supports()` says false for every `-moz-window-*` and for `-moz-default-appearance` from the chrome window. Neither can be used to test them.
- **The scale pivots on the window's top-left corner.**
  - The left edge stays put while the right and bottom edges each move by the full 4 %: 24 px, so the width goes from 602 to 578 px (0.96). Edges were measured with `motion_edges.py`.
  - `-moz-window-transform-origin: 50% 50%` changes nothing (V4).
  - Centring works by hand with `translate(w*0.02, h*0.02) scale(0.96)`. In V5 both edges move by 12 px. See `glass-look-motion-origin-sysdark.png`: rows 1-2 are V4, rows 3-4 are V5.
- **A one-frame pop.** In V4 the first visible frame was full size (602 px). The next frame was scaled (588 px) and then grew. The window was on screen for one frame before its transform applied. V2 and V5 started already scaled, so this is a race. Starting `-moz-window-opacity` at 0 (V1) hides such a frame.
- **Fade ghosting.**
  - `-moz-window-opacity` fades the glass and the content as one layer. For most of a fade the page shows through sharp: crisp page text over the blurred glass, a double image.
  - The blur itself never ramps; there is no "materialize".
  - It is brief at 240 ms and obvious when slowed to 3 s. See `glass-look-motion-v1-open-sysdark.png` and `-v1-close-` (every captured frame, about 17 ms apart), and `glass-look-motion-v1-slow-open-sysdark.png` and `-slow-close-` (3 s, 4 frames a second).
- **The shadow is fine.**
  - The shadow is measured below and to the right of the panel, at 1, 3, 5, 8, 12, 16 and 22 pt (shown below in that order). After a fade-in it is identical to a panel opened without animation: 198, 207, 215, 228, 241, 249, 254 over a white page of 254.
  - During a scale, the shadow scales with the window.
  - So toolkit popup.css's reason for not fading on Big Sur and later (missing shadows, bug 1672091) did not reproduce here (`glass-look-motion-shadow-sysdark.png`).
- No flicker and no misaligned backdrop during the scale. The 36 px capsule also animates cleanly (`glass-look-motion-capsule-sysdark.png`: rows 1-3 open, rows 4-6 close).
- Scale-only filmstrips: `glass-look-motion-v2-scaleonly-open-sysdark.png` and `-close-`.
- **Recommended motion:**
  - scale with a translate that centres it;
  - opacity starting at 0, so the first frame is hidden;
  - short fades, so the ghosting stays brief.
- **Harness note:** each `spike.captureScreen` took about 8 s in this run, so stills cannot catch a transition. Use the recorder.

## S11, media half

- **Both features exist and report in Firefox 157,** in Deer's chrome document and in a web page (`logs/s11-plain.txt`).
  - With the owner's settings, `(prefers-reduced-transparency: no-preference)` and `(prefers-contrast: no-preference)` match, and `reduce`, `more`, `less` and `custom` do not.
  - A made-up value parses but never matches. So support has to be tested by `no-preference` matching, not by `.media` reading "not all".
- **They are wired.** With Gecko's overrides `ui.prefersReducedTransparency=1` and `ui.useAccessibilityTheme=1`, set only in the throwaway profile (`logs/s11-override.txt`):
  - `(prefers-reduced-transparency: reduce)` and `(prefers-contrast: more)` both become true, in chrome and in content;
  - `forced-colors` stays false;
  - `prefers-reduced-motion` is unaffected.
- `MediaQueryList.addEventListener` is there for change listening.
- The pref `layout.css.prefers-reduced-transparency.enabled` is false, yet the feature works: it does not gate the feature in 157.
- **Not done (the owner's half):** checking that turning on Reduce Transparency or Increase Contrast in System Settings flips the queries live, and what the glass itself does then.

## Side notes

- In `glass-look-text-small-sysdark.png` the traffic-light capsule is empty. The lights were there in every other capture with the same pieces, so this is probably a passing redraw or key-window state during the capture. Not investigated.
- Up to 38 glass windows were open at once (`s1b-flip.js`) with no failure. This was not a performance measurement (that is S9).
