# Vitre design notes

Working name: **Vitre**, a Windows browser with a liquid-glass interface. The design phase comes first: settle the mockups, then build. (Renamed **Deer** on 2026-10-04; these notes keep the working name.)

- Design canvas: a separate document, not part of this repository. Its artboards are in the canvas source files below.
- Canvas source files: `design/canvas/project/` (`canvas.json` is the index; one `.dc.html` per artboard)
- Glass tools: `design/tools/lensmap.py` (lens displacement maps), `design/tools/glass-prototype.html` (local test page)

## Decisions

| Topic | Decision |
|---|---|
| Engine | **Changed 2026-10-02 (owner): Gecko.** Vitre is a privileged chrome layer on Firefox 157's engine (`gecko/`, see `gecko/ARCHITECTURE.md`), so Firefox add-ons and their request-blocking API work. Earlier: Chromium through Electron (`app/`, kept as the reference implementation of this design). **Release (owner's decision):** instead of a source fork, a release ships Mozilla's unbranded Firefox 157.0 build (Mozilla's own build of the release source, without the Firefox name and logo), turned into Deer's engine by `gecko/tools/setup-engine.py` and installed per user by `gecko/installer/`; development runs on a local copy of the stock runtime in `gecko/runtime`, which is never published. The exact build and source revision are in `docs/BUILDING.md`. |
| Ad blocking and extensions | **Changed 2026-10-02 (owner), Gecko:** Firefox add-ons from addons.mozilla.org; the Chrome Web Store cannot work on Gecko. No blocker is bundled: the user installs one (uBlock Origin, for example) from addons.mozilla.org. The blocking API such a blocker needs (MV2 `webRequest` blocking, MV3 `declarativeNetRequest`) was proven on this engine under Vitre's interface (`gecko/spikes/extensions/RESULT.md`); uBlock Origin itself has not been tested in Deer. Extension icons live **inside the active pill** at its right end (pinned ones, Firefox's real widgets re-homed there), with an extensions button for the rest (Firefox's extensions panel, anchored to the bar). Unsigned add-ons load only as temporary add-ons, re-installed at each start. |
| Downloader | Port the owner's Swift downloader (titleless-downloader), through the Electron TypeScript port, to Gecko system modules (`.sys.mjs`) on Firefox's network stack (Necko): one network partition per connection gets past the 6-per-host cap and HTTP/2 sharing; cookies, container and private state come from the tab. Firefox's own downloads are taken over through its Downloads list. |
| HLS / DASH | Keep the engine's playlist and segment logic. Remux with ffmpeg (`-c copy`): not bundled; Deer downloads an LGPL build only when the user asks (Settings › Video downloads, see `THIRD-PARTY-NOTICES.md`). Add DASH (best video + audio, joined). yt-dlp is optional for the big platforms. |
| Host deny list | **Relaxed.** YouTube, Meta, TikTok and others are no longer blocked. DRM streams (Widevine, PlayReady, FairPlay) are always refused. Show a one-line terms notice on the first download from those sites. |
| Vault / quarantine | Mark-of-the-Web through Firefox's own download service. |

## Design direction (keep)

- Restrained and professional. Rejected as "AI slop": giant clock, centred search with rows of letter bubbles, corner widgets, illustrated aurora, shortcut chips everywhere, noise-based "liquid" distortion.
- **Glass recipe.** Edge-lens refraction from a displacement map sized to the element, clear in the middle. 1 px gradient rim (mask-composite ring). Soft contact shadow. Refraction kept subtle.
- Font Segoe UI Variable. Accent `#4cc2ff` (Windows dark-mode default). Switches, cards and sidebars follow Windows 11 conventions.
- Real photography for backgrounds: built-in Windows wallpapers as placeholders until the user supplies their own wallpaper or video.
- **Tab bar** (the user's idea, Safari-like):
  - Glass, top-centre.
  - The active tab is a 480×44 pill that is also the address and search field and expands into a 640 px field when clicked.
  - Other tabs are 44 px favicon circles; × shows only on hover.
  - `+` opens an empty search tab.
  - Window controls are a 108×32 glass capsule at the top right.
  - The bar can auto-hide; everything can be hidden on the home page.
- **Settings and Downloads** are floating 960×688 frosted panels over the current page: page dimmed at 0.3, 48 px title bar with close.
- **Tab switching**
  - Default style: the full-screen deck. Hold Ctrl and tap Tab: big cards over the blurred wallpaper, neighbours peeking at the edges, a glass tab dock whose selected circle morphs into a pill.
  - Grid and Strip are alternatives in Settings › Tabs.
  - Ctrl+Shift+A opens the switcher with search.
- **Motion.** One spring, `cubic-bezier(0.22, 1, 0.36, 1)`, for anything that moves as an object. Expand-to-window uses `cubic-bezier(0.2, 0, 0, 1)`. Reduced motion means 150 ms cross-fades.
- **Shortcuts** never collide with Windows, IMEs, AltGr layouts or accessibility keys. The full map, reserved list and routing rules are in `design/keymap.json` and the "Keyboard map" section below.

## Canvas pages (status)

| Page | Artboards | Status |
|---|---|---|
| Home page | Home (idle), HomeSearch, HomeBrowse (light bar over a page), HomeBackground (photo, video or see-through popover) | done, reviewed |
| Settings and downloads | Settings (Appearance), SettingsTabs (switcher style picker), Downloads (IDM-style manager, connection bar), DownloadsPopover | done, reviewed |
| Download this video | VideoDownload (pill on hover), VideoPicker (quality picker), VideoStates (every state + the mark in the tab pill) | done, reviewed |
| Switching tabs | TabSwitcher (deck, interactive, auto-plays), TabMotion (spec), TabOverview (grid), TabSearch, TabSwitcherStrip | done, reviewed |
| Peek | PeekOpen (sheet open over IssuesPage), PeekMotion (interactive loop: open, hop, close, open as tab), PeekDiscover (link menu + one-time hint), PeekSpec (frames, keys, edge cases) | done, reviewed, published (version 27) |
| Find in page | FindOpen, FindMotion (interactive, 12.3 s loop with a caption strip), FindStates (every state on light, dark and photo), FindContexts (peek, hidden bar, PDF, Home), FindSpec | done, reviewed (34 findings fixed), published (version 28) |
| Right-click menus | MenuSelection, MenuMotion (interactive), MenuGallery (flip left), MenuSpelling (Shift+F10, flip up), MenuChrome (pill, circle, ring, Home), MenuSpec (anatomy, materials, placement, keys), MenuReference (all 26 menus); PeekDiscover updated to the final link menu | done, reviewed, published (version 28) |
| Keyboard | KeyMap (every shortcut), KeyRouting (how a key travels, the Esc ladder, F6), SwitcherKeys (held vs latched), SettingsKeys (Settings › Keyboard shortcuts) | done, reviewed (29 findings fixed), published (version 30) |
| Parts | Article, VideoPage, RefPage, IssuesPage, GalleryPage, PeekIssue, FindPill, CtxMenu | mock sites and shared components used inside scenes |

Mock tabs everywhere, in this order: Field Notes (fieldnotes.press), Tideline (tideline.fm), Refract (refract.wiki), vitre-shell (code.vitre.dev), Long Exposure Club "Slow light" (longexposure.club), Home.

## Peek (agreed design: merge of two judges' syntheses)

- **Triggers.** Shift+click a link (via `setWindowOpenHandler` with the `new-window` disposition, so pages that preventDefault keep their behaviour). Shift+Enter on a focused link or in the address pill. Ctrl+Q for the focused link or the link under the pointer. Right-click menu: "Peek link" is the second item, under "Open link in new tab", with "Shift+click" in the accelerator column.
- **Not in v1:** letter tags on links, hold-to-peek, the `+` circle as a tab-in-waiting, beside docking.
- **Discovery.** The context menu, plus one rate-limited hint in the link status bubble ("Shift+click to peek") after the user bounces back and forth. Shown once, then retired.
- **Sheet.** Centred, 1040×804 at (200, 72) in a 1440×900 window (72% of width, 720 to 1120). Radius 22, panel shadow, 1 px rim. The page inside is opaque. Page dim 0.22. The tab bar stays visible above the dim while a peek is open. Below 900×600 it becomes a full sheet with 8 px margins.
- **Header.** 44 px frosted: back chevron (only once there's history), favicon, domain (Semibold), dimmed path. Icon-only "Open as tab" and close buttons, tooltips on hover only. A 2 px accent load line.
- **Open.** From the link's rectangle to the sheet in 400 ms on the spring. Scrim 240 ms. A frosted cover until first paint (Electron views can't fade), then the content shows.
- **Hop.** Shift+click another link on the dimmed page and the content swaps in place (crossfade).
- **Close.** Esc (the page gets Esc first; Esc Esc within 400 ms closes anyway, except after typing in the peek, when it only nudges the sheet), a click on the dimmed page, or Ctrl+W. The sheet shrinks back into the link in 280 ms, then an accent wash on the link fades over about 900 ms, and keyboard focus returns to that link (by any close route). If the user typed in the peek, a click on the dim only bumps the sheet.
- **Promote.** Alt+Enter, the Open as tab button, or a double-click on the header. The sheet expands to the window in 380 ms on the expand curve while the rim fades. The header capsule rises into the tab bar as the new active pill, right of the source tab. The source pill shrinks to a circle and neighbours slide 52 px (420 ms spring). It is the same WebContents (no reload) with the opener set.
- **Edge cases:**
  - A download before first paint folds into a 44 px file-type circle that flies to the downloads circle.
  - Permission prompts anchor to the header.
  - Element fullscreen expands the sheet.
  - Alt+Left on the first entry closes the peek (guarded against key repeat).
  - Ctrl+Shift+T reopens the peek only while it is still warm (60 s) and its source tab is active; otherwise it reopens the next closed tab or window.
  - Warm close keeps the page alive for 60 s.
  - On the home page, Shift+Enter in the pill peeks over the wallpaper, and promoting replaces Home.

### Peek artboards (done)

- `PeekIssue.dc.html` part: props `issue` "39"/"38", `w`, `h`. Default 1040×760; the promoted version is 1440×900.
- **PeekMotion** is interactive and loops about every 13.6 s: Shift+click #39, open, hop to #38, close by clicking the dim (wash on #38), reopen #39, then Open as tab. Tweaks: `autoplay`, and `still` (open, hop or promoted).
- **PeekOpen** imports PeekMotion with `autoplay=false still="open"`.
- **PeekDiscover** shows the dark glass link menu with "Peek link" second and hovered, plus the status-bubble hint.
- **PeekSpec** has four frames (Shift+click, Hop, Close, Open as tab), a keys table and edge cases.
- Reviewed by the `review-peek-artboards` workflow. All 22 confirmed findings are fixed. Published as canvas version 27, which also removed the old `Peek.dc.html` placeholder. The canvas now launches on the Peek page.
- Measured on IssuesPage (1440×900): row 1 is at y 239 and rows are 64 px tall. Title text rects: #41 (86, 251, 323×20); **#39 (86, 315, 382×20)**; **#38 (86, 379, 425×20)**; #36 (86, 443, 393×20).
- Tab bar with vitre-shell active (light, top 12):
  - Before promote: F 322, T 374, R 426, V pill 478 (w 480), L 966, H 1018, + 1074.
  - After promote: F 296, T 348, R 400, V circle 452, NEW pill 504 (w 480), L 992, H 1044, + 1100.
- Settled: the "Shift+click a link: Peek / Open in new window" switch lives on Settings › Keyboard shortcuts; Settings › Tabs has no Peek group.

## Find in page (agreed design: merge of a design judge and an engineering judge)

Three concepts ("pill", "reading", "keyboard"); both judges put find inside the active tab pill. Rejected: rotating Back/Forward into arrows (stray clicks after close navigate Back), a custom match rail or minimap (second matcher, sits on the scrollbar), custom highlight colours, whole word / regex (findInPage has neither), smooth find scrolling, a hidden double-Ctrl+F override, a no-match shake.

- **Placement.** Ctrl+F turns the active pill into its *find face*, in place: 480×44, same slot ((322,12) with Field Notes active, (478,12) with vitre-shell). Nothing else moves; the pill's download mark hides while finding.
  - Bar auto-hidden or F11: only the active pill drops in, at its slot, already in the find face, and stays pinned while find is open.
  - Peek: a 440×32 frosted capsule (radius 16, white 0.55 on a light header) replaces the header's domain and path, 8 px right of the header favicon: window (238,78)–(678,110) for the sheet at (200,72).
  - Home: Ctrl+F does what Ctrl+L does. Ctrl+F goes to the topmost surface: the Settings/Downloads search field, then the peek, then the tab. Element fullscreen passes it to the page.
- **Anatomy** (pill-local x, window x for the pill at 322; buttons 28×28 at y 8, window y 20–48):
  - Favicon 16 px at x 16 (338–354). Hover 500 ms shows the full URL in the dark tooltip under the pill. Not clickable in find mode.
  - Field: text from x 42 (364) to 10 px left of the counter, at least 160 px. Segoe UI Variable Text 13.5 px. Placeholder "Find on page" at 0.45. Accent caret (#005fb8 on light glass, #4cc2ff on dark or clear). Selection rgba(76,194,255,0.42). Long queries scroll under a 12 px fade.
  - Counter: right edge x 324 (646), 12.5 px tabular figures, text at 0.55 (light) or white 0.6 (dark). Grows to the left, at most 112 px. Copy: "3 of 7"; "1 of 4,812+" while Chromium is still counting; "No matches" in #c42b1c (light) or #ff99a4 (dark); blank when the field is empty, or while the page is loading and nothing is found yet.
  - Previous (chevron up) x 334 (656–684), Next (chevron down) x 364 (686–714). Disabled at 0.28 only when the field is empty or there are no matches; enabled at "1 of 1" (re-centres the match).
  - Divider 1×16 at x 401 (723), text colour at 0.12.
  - Match case "Aa" x 410 (732–760), the download mark's slot. Off: 13 px Semibold at 0.7. On: #005fb8 on rgba(0,95,184,0.12) with a 1 px inset rgba(0,95,184,0.35) on light glass; #9fe3ff on rgba(76,194,255,0.24) with inset rgba(76,194,255,0.45) on dark glass. Per tab; new tabs start off.
  - Close × x 442 (764–792), exactly the reload slot.
  - Buttons: hover a 28 px circle at ink 0.06 (light) or white 0.10 (dark); press 0.10/0.16 and scale 0.94 for 80 ms; Windows focus ring on :focus-visible only; a mousedown never takes focus from the field.
  - Tints: light page, field focused: white 0.62→0.40; parked (focus in the page): the normal 0.42→0.22, caret hidden, query at 0.85. Dark page: the existing dark pill (white 0.12→0.04 over rgba(16,16,20,0.30)), focused rgba(16,16,20,0.46). Photo or wallpaper: clear glass plus rgba(16,16,20,0.30) and a 0 1px 2px rgba(0,0,0,0.35) text shadow.
  - Tooltips after 600 ms, plain text with a dim key: "Previous match  Shift+Enter", "Next match  Enter", "Match case  Alt+C", "Close  Esc".
  - Field menu: the standard editable menu plus a separator and "Match case" (check, Alt+C).
  - Narrow window (pill under 400 px): Aa moves into the field menu.
  - Peek capsule (capsule-local): field from x 12, counter right edge 300, previous 308 and next 334 (24×24), divider 365, Aa 372, × 404, 12 px right padding, no favicon.
- **Matches on the page.** Chromium's own highlights: yellow rgb(255,255,0) for every match, orange rgb(255,150,50) for the active one, black text. The chrome never uses yellow or orange.
  - Overview: Blink's tick marks on the page's standard (non-overlay) Fluent scrollbar, x 1425–1440. Vitre never turns on overlay scrollbars. No rail.
  - Landing ring: 2 px, radius 6, 3 px outside the active match; #005fb8 over light pages, #4cc2ff with a 1 px rgba(0,0,0,0.35) outer hairline over dark or photo pages. Starts 16 px larger at opacity 0, contracts in 280 ms on the spring, holds 260 ms, fades 240 ms. Shown on explicit steps and once 400 ms after typing pauses if the active match changed; never during key repeat; cancelled by scroll, wheel, resize, tab switch, the next step or a right-click. Drawn in a click-through layer (popup window with setIgnoreMouseEvents).
  - Scroll guard: if the active match lies under the visible chrome (inflated 12 px), scroll instantly so its top sits at y 92. Skipped for fixed or sticky content; then the pill drops to its parked tint while the match is under it. Spike: insertCSS `html{scroll-padding-top:68px}`.
- **Open** (t = 0 is the Ctrl+F keydown; the field is focused at t = 0, so typing never waits): 0–100 ms Back/Forward fade out sliding 6 px left; 0–120 ms reload rotates −90° and fades, 60–220 ms the × fades in rotating 45°→0°; 0–240 ms the favicon slides from its centred spot to x 16 on the spring while the domain cross-fades into the placeholder or the selected pre-fill (60–180 ms); 60–240 ms the counter, chevrons, divider and Aa slide 8 px in from the right as one group; 0–200 ms the tint deepens. Bar hidden: the pill drops from translateY(−56) in 300 ms on the spring. Peek: the capsule grows from the domain's text box to 440 px in 240 ms. Ctrl+F while open selects all, no motion.
- **Step.** Chromium moves the orange highlight and jumps instantly (centring at about y 450) only if the match is off-screen; never smoothed. Then the guard (if needed) and the ring. The counter's ordinal rolls: old number out 6 px (120 ms), new in from 6 px the other side (160 ms spring); up when the number rises, down when it falls, so a wrap reverses the roll (Narrator: "Wrapped to first match"). No roll when steps come under 140 ms apart. The matching chevron shows its pressed fill for 100 ms (key echo). One request in flight; extra presses merge. No matches: Enter pulses the counter once (0.4→1, 160 ms).
- **Close** (Esc or ×, 200 ms): stopFindInPage('keepSelection'), so the active match stays as a normal selection and gets focus, or its link does (Enter follows it, Shift+Enter or Ctrl+Q peeks it, Ctrl+C copies). The face morphs back in reverse; the reload slot ignores clicks for 400 ms. Bar was hidden: the address face shows for 400 ms, then rises. Ctrl+Enter closes and clicks the match ('activateSelection'). Ctrl+Q closes and peeks the match's link. Ctrl+L cross-fades into the 640×48 address field ('clearSelection'), keeping the query for F3. Any main-frame navigation to another document closes find and keeps the query.
- **Keys.** With focus in the page, the page gets find keys first (as in Chrome); the escape hatch is F6, then Ctrl+F, or "Find on page…" in the page menu.
  - Ctrl+F: open, focus, pre-fill, select all, search. Pre-fill: a selection made since find last closed (one line, ≤ 120 characters, never from a password field, and it becomes the active match without the page jumping), then this tab's last query, then this window's, then empty. Esc then Ctrl+F restores the query at the same match.
  - In the field: live search (one request per frame, 150 ms hold for one character, paused during IME composition); Enter / Shift+Enter, F3 / Shift+F3, Ctrl+G / Ctrl+Shift+G step; Ctrl+Enter, Ctrl+Q, Esc as above; Alt+C match case (ignored with Ctrl, so AltGr+C still types); Up, Down, PgUp, PgDn scroll the page; Tab cycles field → previous → next → Aa → ×; F6 to the page (find stays, parked); Shift+F10 or Menu key: field menu.
  - Find closed: F3 or Ctrl+G reopen it parked with the last query and step.
  - Esc follows the one Esc ladder in the Keyboard map (one layer per fresh keydown; the find field closes find, and parked find comes after the page). The Esc that closes find never counts toward Peek's Esc Esc.
- **States:** empty; pre-filled; counting; results; one match; thousands ("12,408 of 12,408", field at its 160 px minimum); no matches; loading (blank counter, the pill's load line keeps running, one re-run at did-stop-loading if the user hasn't stepped or scrolled); parked; IME (counter at 0.5). State is per tab. Same-document navigation keeps find open; reload keeps the query and re-runs after the load.
- **Contexts:** PDF (Chromium's viewer paints its own highlights, the count climbs page by page, no ticks, guard or pre-fill, dark glass over the viewer's #323639; flag: the viewer's 56 px toolbar sits under Vitre's bar). Light pages light glass, dark pages dark glass, photos and the wallpaper clear glass.
- **Electron:** the field is DOM in the chrome view, so it never matches itself. New query or match-case toggle: `findInPage(q, {findNext: true, matchCase})`; steps `{findNext: false, forward}`; keep the latest requestId; `finalUpdate` drops the "+". `stopFindInPage` modes as above; emptied field → 'clearSelection'. Page-first keys through hidden application-menu accelerators. Motion with CSS transforms inside views, never animated view bounds. Spikes: ticks on the Fluent scrollbar; page-first accelerators with WebContentsView and the PDF guest; selectionArea's coordinate space under zoom, DPI and out-of-process iframes; keepSelection focusing the containing link; where Blink starts a new session; the popup ring window's cost; scroll-padding-top through insertCSS.

## Right-click menus (agreed design: both judges picked the "Windows 11 citizen" concept)

- **Principles.**
  - One menu system: custom HTML in a warm transparent overlay layer (a WebContentsView added last, hidden when closed). Electron's native Menu is never used, except that the bar's empty drag area and the window controls keep Windows' own system menu.
  - Menus follow Vitre's Appearance mode (Match Windows by default), never the page or the tab bar's tint. The canvas shows Windows dark mode.
  - No submenus. An item that needs more input ends in "…" and opens a Vitre surface or a Windows dialog.
  - Stable verbs grey out (Back, Forward, Undo, Redo, Cut, Copy, Paste); contextual items are left out. Separators never lead, trail or double. At most 10 actionable rows (unit-tested with the access keys).
  - No accent in menus except the link target wash. No chips, no toasts.
  - Shift+right-click opens Vitre's menu even on pages that replace the context menu. There is no extended "Shift tier".
- **Anatomy.** Shell radius 12, padding 6. Width fits the content in 8 px steps, from 264 (the PeekDiscover width) to 360. Height = 12 + 34 × rows + 9 × separators (+ 28 for a caption row). Taller than the window minus 16: scrolls inside, 2 px overlay scrollbar while scrolling.
  - Rows 34 px (40 by touch or pen). Plate fills the row inside the padding, radius 6. 16 px line icons (the PeekDiscover set, 1.5 stroke) at x 16, only where an established glyph exists; the column is always reserved. Label at x 44, 14/20 Segoe UI Variable Text (was 13 in the sketch). Accelerator 12 px secondary text, right-aligned 16 px from the edge, at least 32 px clear of the label, Windows spelling, plain text.
  - Separators 1 px, inset 12, 4 px above and below (9 px block).
  - States: one shared plate for hover and keyboard focus (no focus ring); pressed is dimmer with the label at 0.8; disabled at 0.36, no plate on hover, keyboard-reachable with a 0.05 plate. Check items show a 16 px check in the icon column; one-shot verbs swap labels (Pause/Play, Mute/Unmute). Spelling suggestions Semibold, at most 3. Caption row (background tab circles): 28 px, 12 px secondary text at x 16, not focusable. Quoted text: first line, ≤ 24 characters plus an ellipsis, curly quotes. Access-key underlines 1 px, 2 px below the baseline, shown on keyboard opens.
- **Material.** Frost (blur 24, saturate 1.6), no lens map.
  - Dark: tint rgba(32,32,38,0.80); rim 165° white 0.45 / 0.10 at 30% / 0.04 at 60% / 0.18; shadow 0 18px 44px rgba(0,0,0,0.32), 0 1px 3px rgba(0,0,0,0.30); text #fff, secondary white 0.70, disabled 0.36, separator 0.10; plate white 0.12 with an inset 0 0.5px 0 white 0.22; pressed 0.08. Worst case over white: text 8.4:1, secondary 5.1:1.
  - Dark raised: when the blurred backdrop's mean luma is under 48 (code views, video, dark sites), tint rgba(48,48,56,0.86) and rim top 0.55, so the menu sits lighter than the page.
  - Light: tint rgba(249,249,251,0.80); rim white 0.9→0.3 plus a 1 px outer hairline rgba(0,0,0,0.10); shadow 0 16px 40px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.10); text black 0.90, secondary 0.62, plate black 0.06.
  - Transparency effects off: solid #2C2C2C or #F9F9F9 with a flat rim. Forced colours: Canvas, CanvasText, Highlight, GrayText; no frost or shadow.
  - Target wash: the right-clicked text link gets rgba(76,194,255,0.14) at radius 4 over its rectangles (fades in over 120 ms). If Peek link is chosen it becomes the sheet's origin.
- **Placement** (8 px window margin; minimum window 480×360).
  - Mouse and pen: opens on release, top-left at the pointer hotspot. Crossing the right margin opens leftward (right edge at the hotspot); crossing the bottom opens upward (bottom edge at the hotspot). Item order never changes. Windows handedness is ignored, as in Chrome and Edge.
  - Keyboard (Shift+F10 or the Menu key, the same menu): 4 px below Blink's anchor; a selection anchors 4 px below its last line, left-aligned to its start; nothing focused: (24, 76). Example: the focused #38 link on IssuesPage (86, 379, 425×20) gives a menu at (86, 403). The first enabled item is focused and access keys are underlined.
  - Tab bar surfaces hang at top 64 (12 + 44 + 8): by mouse at pointer x − 16, by keyboard left-aligned to the element. The element keeps its pressed look while its menu is open.
  - Downloads ring (1324, 836): opens up and to the left, right edge 1368, bottom 828.
  - Touch: 40 px rows, centred on the finger, bottom edge 24 px above it.
  - Peek: menus from the sheet may extend over the dim; right-clicking the dim never closes the peek. Context loss (resize, DPI, tab switch, blur, navigation) closes a menu at once.
- **Motion.** Open: opacity 0→1 in 90 ms (cubic-bezier(0.2,0,0,1)) with scale 0.96→1 and 4 px of travel from the anchor corner in 200 ms on the spring; the transform is removed at 200 ms so text re-renders crisp. Plate: fades in 60 ms, glides 90 ms on the spring between adjacent rows, snaps on jumps and wraps, fades out 120 ms. Activate: the action fires at once and the menu fades out in 100 ms with the chosen row lit. Dismiss: 120 ms fade with scale 1→0.985. Hand-offs: Peek link grows Peek's 400 ms sheet from the wash; Search for grows it from the selection; Find hands off to the find open motion; any download sends a 32 px glass file-type circle from the row's icon to the downloads ring in 480 ms on the spring, and the ring pulses 1→1.06→1 over 240 ms. Reduced motion: 150 ms cross-fades, no scale, glide or flight.
- **Keyboard and accessibility.** Up and Down move and wrap, skipping separators and captions but stopping on disabled rows; Home, End; Tab and Shift+Tab act as Down and Up; Enter or Space activates (a check item toggles and closes); Esc, Alt or F10 close and return focus. Access keys activate at once: Chrome's letters where Chrome has the command, fixed letters for Vitre's (P Peek, I Find, D Download, G Paste and go / Go to, S Search for / Paste and search). Opened by mouse: nothing focused until the first arrow. Opened by keyboard: the first enabled item (the first suggestion in a spelling menu). Releasing the right button on an item activates it. Global keys are swallowed while a menu is open. The page keeps OS focus (keys forwarded with before-input-event) unless assistive technology is running, when the layer takes real focus. Roles menu, menuitem, menuitemcheckbox, separator; aria-keyshortcuts; aria-disabled.
- **Which menu** (first match wins): chrome element, misspelled word, editable field, video or audio, image link, link, image or canvas, selected text, page. `javascript:` links get the page menu.
- **Item lists** ([X] access key, — separator, (if …) conditional row):
  - **Page** (264×302): Back Alt+Left [B] · Forward Alt+Right [F] · Reload Ctrl+R [R] — Find on page… Ctrl+F [I] · Print… Ctrl+P [P] · Save page as… Ctrl+S [A] — View page source Ctrl+U [V] · Inspect [N].
  - **Link** (264×234, the PeekDiscover sketch): Open link in new tab [T] · Peek link Shift+click [P] · Open link in new window [W] — Copy link address [E] · Download linked file [D] — Inspect [N]. File link: Download linked file · Copy link address — Inspect. mailto: Copy email address [E] — Inspect; tel: Copy phone number [E] — Inspect. A selection inside the link adds Copy Ctrl+C [C] at the top of the copy group.
  - **Image** (264×234): Open image in new tab [I] · Peek image [P] — Save image as… [V] · Copy image [Y] · Copy image address [O] — Inspect [N]. Canvas: Save image as… · Copy image — Inspect.
  - **Image that is a link** (264×345): Open link in new tab [T] · Peek link Shift+click [P] · Open link in new window [W] — Copy link address [E] · Download linked file [D] — Open image in new tab [I] · Save image as… [V] · Copy image [Y] — Inspect [N].
  - **Selected text** (fits the quote, e.g. 320×166): Copy Ctrl+C [C] — Search for “float glass” [S] · Find “float glass” on page Ctrl+F [I] — Inspect [N]. Search for opens in a Peek (Alt+Enter promotes it); a selection that is a URL or domain shows Go to refract.wiki [G] instead. Find seeds the find field and starts on the selected occurrence.
  - **Editable** (264×302 or wider for Ctrl+Shift+V): Undo Ctrl+Z [U] · Redo Ctrl+Y [R] — Cut Ctrl+X [T] · Copy Ctrl+C [C] · Paste Ctrl+V [P] · Paste as plain text Ctrl+Shift+V [L] (if rich text and HTML on the clipboard) · Select all Ctrl+A [A] — Inspect [N]. Password fields grey out Cut and Copy.
  - **Misspelled word** ("flaot"): float · flat · flout (Semibold) · Add to dictionary [D] — Cut [T] · Copy [C] · Paste [P] · Select all [A] — Inspect [N].
  - **Video:** Pause or Play [P] · Mute or Unmute [M] · Loop (check) [L] · Show controls (check) [C] · Picture in picture (check) [I] — Download video… Ctrl+Shift+D [D] · Copy video address [O] (not for blob: or MSE sources) — Inspect [N]. Download video… opens the existing quality picker where the hover pill sits; on DRM video it is disabled with a dim "Protected" in the accelerator column.
  - **Audio:** Pause or Play [P] · Mute or Unmute [M] · Loop (check) [L] · Show controls (check) [C] — Download audio [D] · Copy audio address [O] — Inspect [N].
  - **Tab pill at rest** (hangs at y 64): Copy address [A] · Paste and go [G] (or Paste and search [S]; if the clipboard holds text) — Duplicate tab [D] · Mute tab [M] (if the tab has played sound) · Move tab to new window [W] — Close other tabs [O] · Close tab Ctrl+W [C]. While editing the address: Undo — Cut · Copy · Paste · Paste and go · Select all. A history suggestion row: Remove from history Shift+Delete [R] (only on a row the user moved to).
  - **Background tab circle:** caption "Slow light · Long Exposure Club" — Reload tab [R] · Duplicate tab [D] · Copy address [A] · Mute tab [M] (if…) · Move tab to new window [W] — Close other tabs [O] · Close tab [C] (no key: Ctrl+W closes the active tab).
  - **+ circle:** New window Ctrl+N [W] · Reopen closed tab Ctrl+Shift+T [R] (reads Reopen closed tab, Reopen closed peek or Reopen closed window for what comes back next; greyed when there is nothing to reopen) — Show downloads Ctrl+J [S] · Full screen F11 (check) [F] · Settings Ctrl+, [E].
  - **Downloads ring:** Show downloads Ctrl+J [S] · Open Downloads folder [F] — Pause all [P] (or Resume all [R]) · Download copied link [D] (if the clipboard holds a URL) · Clear finished [C] (removes rows, never files).
  - **Peek page:** Open as tab Alt+Enter [T] · Copy address [A] — Back · Forward · Reload — Find on page… Ctrl+F [I] · Print… Ctrl+P [P] — Inspect [N]. Inside a sheet peeks don't nest: Peek link and Peek image are left out and Search for opens a new tab. **Peek header:** Open as tab Alt+Enter [T] · Copy address [A] · Open in new window [W] — Close peek Esc [C].
  - **Home wallpaper** (no Inspect): Paste and go [G] (if the clipboard holds text) — Change background… [B] · Pause background [P] (if it is a video) · Show tab bar (check) [T] — Settings Ctrl+, [E].
- **Left out:** native Menu, popup-window menus, submenus (speed, spelling language, writing direction), a command strip of icons, adaptive or site-tinted menus; Emoji (Win+.), Delete, Copy link text, Copy link to highlight (Electron has no generator), Save link as… (Download plus "Ask where to save" covers it), Hard reload, Close tabs to the right, Pin, groups, bookmarks; Cast, Lens, Translate, QR code, Send to devices, Read aloud, Share, AI items; Copy video frame, Open video in new tab, playback speed, Rotate; Reload frame, View frame source; toasts, accent focus rings, fade masks.
- **Electron:** one warm transparent WebContentsView (setBackgroundColor '#00000000', setVisible(false) when closed, re-added on top when opened and sized to the content area so it absorbs the dismissing click; a right-click outside is replayed to the page with sendInputEvent). `itemsFor(params, tab, peek)` builds every page menu from the 'context-menu' params; chrome surfaces build theirs in the chrome renderer. Frost: capturePage on right mousedown at 1/4 scale, blurred 6 px in a canvas (24 px at full size), which also gives the luma for the raised rule. A preload (isolated world, subframes too) records the link rectangles for the wash and the Shift bypass. Actions: navigationHistory, undo/redo/cut/copy/paste/pasteAndMatchStyle/selectAll, copyImageAt, replaceMisspelling, addWordToSpellCheckerDictionary, savePage, print, inspectElement, view-source:, setAudioMuted; media verbs in an isolated world with userGesture; downloads go to the downloader helper with the session's cookies, User-Agent and Referer. Verify in the prototype: capturePage latency at 4K, a fresh 'context-menu' from a replayed click, no visible page blur on a row click, selectionRect and suggestedFilename in the pinned Electron.
- **Decided with the user (2026-10-01):** while a download runs, Home's downloads ring (44 px glass, bottom right at 1324,836) also shows over web pages, so menu and Peek downloads have somewhere to fly; it hides 6 s after the last download finishes. Settings › Tabs › "Opening and closing tabs" has "Searches from selected text: Open in a peek / Open in a new tab" (default peek); shown on SettingsTabs.
- **Keys these designs print:** all confirmed on the keyboard map (see "Keyboard map").

### Find and menu build notes

- Shared parts, so every board draws the same thing:
  - `CtxMenu.dc.html` holds every menu's item list (props `kind`, `theme`, `hover`, `pressed`, `keys`, `touch`, `quote`, `caption`); widths and heights follow the spec formula.
  - `FindPill.dc.html` is the active tab pill with both faces and the open/close morph built in (props `face`, `theme`, `site`, `query`, `status`, `ord`, `total`, `roll`, `rollKey`, `echo`, `snap`…), plus the 440×32 Peek capsule (`variant="capsule"`).
  - `Article` gained `find`, `active`, `ring`, `selected` (the 7 "float" matches) and `pick` ("surface tension" selected). `PeekIssue` gained `find`/`active` (5 "ETag" matches) and `draft`/`draftSelected` (a comment box with "flaot").
- Measured (1440×900): Article content is 1495 tall; "float" matches in document coordinates m1 (137,375.8) m2 (879,582) m3 (101.4,749) m4 (848.9,694) m5 (835.5,823.6) m6 (318.1,1307.8) m7 (1272.1,890.7); "surface tension" (300,1007.5,127×20). Gallery photos 324×190 at x 48/388/728/1068, y 184/390/596. Refract "tin" ×7 (see the build brief). PeekIssue ETag ×5; "flaot" at (82.4,634) in the 1440×900 layout.
- Local preview: the scratchpad `render.js` + headless Edge renders any board to PNG (blobs map to local copies); not part of the project.
- `design/tools/dccheck.py` checks any board: tag balance, holes against renderVals, sizes against canvas.json, imports and filters.

## Keyboard map (agreed: inventory + Windows audit + web-app audit, synthesized and checked by a skeptic)

The full map is `design/keymap.json` (105 entries in 11 groups, the reserved list by owner, 21 routing rules, every change versus earlier boards, and what Settings › Keyboard shortcuts offers). It is the source of truth for the boards and, later, for the Electron build. Highlights:

- **Three priorities.** *Browser-first* keys never reach the page (Chrome's reserved set: Ctrl+T, Ctrl+N, Ctrl+W, Ctrl+F4, Ctrl+Shift+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Page Up/Down; plus F6/Shift+F6, Esc Esc and Ctrl+W on a peek, and leaving full screen). Electron doesn't inherit Chrome's list, so these are caught in before-input-event on every WebContents. *Page-first* keys go to the page first (Ctrl+F, F3, Ctrl+L, Ctrl+J, Ctrl+Q, Ctrl+Shift+A, zoom, Ctrl+1–9, Ctrl+R/P/S/U, a single Esc…) and run through hidden application-menu accelerators on Chromium's unhandled-key path. *Local* keys work only inside Vitre surfaces (find field, address field, switcher, menus, panels, popovers).
- **Pages can never trap you:** F6 always leaves the page, and from the address pill every page-first key goes straight to Vitre. Menus add routes for Reload, Find on page…, Print…, Inspect, Show downloads, Full screen and Settings.
- **New keys:** Ctrl+T, Ctrl+W/Ctrl+F4, Ctrl+Shift+W, Ctrl+Page Up/Down, Ctrl+1–8, Ctrl+9 (last), Ctrl+Shift+Page Up/Down (move tab), F11, Ctrl+L/Alt+D, Alt+Enter and Ctrl+Enter in the address field (as Chrome), Ctrl+H (recent history in the address field), F5 and hard reload (Ctrl+Shift+R, Ctrl+F5; Shift+click the reload button), zoom (Ctrl+Plus/Minus/0), Ctrl+click and Ctrl+Shift+click, Ctrl+Shift+D (download this video), Alt+click (download a link), Ctrl+, (Settings), F1 (Settings › Keyboard shortcuts), Ctrl+Shift+Delete (clear browsing data), F12/Ctrl+Shift+I/J/C (developer tools), hardware Browser keys and mouse side buttons.
- **Changes to earlier designs:** the held switcher can't use Esc (Ctrl+Esc opens Start): cancel by stepping back to the starting card and letting go, or clicking the wallpaper; typing latches the switcher (then Esc cancels); Ctrl+letter types into the switcher's search; Delete also closes a card. Topmost order is panel, then peek, then tab. One Esc ladder for everything, one step per fresh keydown. Shift+click peeks only through setWindowOpenHandler (pages that use Shift+click keep it), with a switch back to Chrome's new window in Settings. Ctrl+Shift+T reopens a peek only while it is warm. Keys are spelled the Windows way everywhere (Ctrl+Tab, Shift+click, Shift+Delete).
- **Guards:** AltGr (no Alt binding fires with Ctrl down, no Ctrl binding with Alt down; modifiers match exactly), IME (nothing fires while composing), layouts (letters by virtual key, digits by physical key, Plus/Minus/Equals by the character typed), key repeat (anything that closes, opens or toggles ignores repeat), no single printable key is ever a page shortcut, every F-key action has a non-F route.
- **Never used (reserved):** Win+anything; Alt+Tab/Esc/Space/F4; Ctrl+Esc, Ctrl+Shift+Esc, Ctrl+Alt+Del/Tab; Ctrl+Alt+anything and AltGr; Alt+Shift and Ctrl+Shift alone; Ctrl+Shift+digits; IME keys (Ctrl+Space, Shift alone, Ctrl+period, Ctrl+Shift+F/B, Alt+grave, Kanji/Henkan…); accessibility and screen-reader keys (Caps Lock/Insert + anything, Shift ×5, Ctrl+Win+Enter, Alt codes); NVIDIA/Intel overlay keys; Ctrl+K, Ctrl+E, Ctrl+D and other keys left to pages. Rejected ideas: tap-Alt key tips, a Ctrl+K palette, Ctrl+Shift+O ghost mode.
- **Settings › Keyboard shortcuts** (F1 or Ctrl+, opens Settings there): the whole map, searchable; page-first keys marked "Sites can use this first"; a "Different from Chrome" list; a Shift+click switch (Peek / Open in new window); only Vitre's own verbs are rebindable (Peek Ctrl+Q, Open as tab Alt+Enter, Search tabs Ctrl+Shift+A, Download this video Ctrl+Shift+D), with refusals that say why (e.g. "Windows uses Ctrl+Shift+1 to switch input language").
- **Boards:** KeyMap (reference sheet), KeyRouting (how a keydown travels, the Esc ladder, the F6 cycle), SwitcherKeys (held vs latched), SettingsKeys (the settings page).

## Uploaded canvas assets (blob URLs)

| Asset | URL |
|---|---|
| Lake wallpaper 2880×1800 | `/_blob/d76ec6f8c20771e9dd10b6d141ebfc22` |
| Thumbnails: lake, ribbons, mist, orb | `e31b6a05051cebcce4d575ca3590b634`, `9896632e380f9fa298ee6ec877af3f1e`, `f467f60764881bd058585a212f67dab8`, `cf27d7061110604f6314bd40edc675b4` |
| Video frame 1920×1080 | `/_blob/dd320ac987dd96d049df92293f327323` |
| Up-next thumbnails: lake, ribbons, flats, orb, bath, dusk | `c8af8d7b…`, `3494d52a…`, `cebfadd7…`, `2c894f90…`, `ba8da8a2…`, `39bffc63…` |
| Lens maps | circle 44 `fbb9d57b142a16bacfbe2c03ac04e7b6`; tab 480×44 `288d693bd243616b99e29672a748d2df`; tab-open 640×48 `fc5d2f4f…`; panel 640×292 `a0883a42…`; popover 340×472 `4684eaeb…`; window controls 108×32 `6b64f841d59a2885d70cf9e62e1424d4`; float panel 960×688 `907d800cda0d60b0784640e4a27452c3`; downloads popover 360×300 `3ea81efa…`; pills 168/196/232×36 `15e6fcb9…`/`4b70b7ac…`/`fa66dfff…`; picker 340×448 `40dd2361…`; dock 476×52 `8bacb1a2cf3c6194f6ccee3c612a3b2a`; strip 1080×212 `4811fc0d…` |

New maps: `python design/tools/lensmap.py out.png W H radius bezel 2.2`, then upload as a canvas asset.

## Still to design (in order)

1. ~~Peek~~ (done, version 27).
2. ~~Find in page and the right-click menus~~ (done, version 28; both open questions approved, version 29).
   - ~~The keyboard map boards~~ (KeyMap, KeyRouting, SwitcherKeys, SettingsKeys; source of truth design/keymap.json).
3. ~~Remove the old Concept page placeholders~~ (done, version 31).
4. Then build: a bare Electron window with the glass tab bar, then tabs and the switcher, then the downloader port.
