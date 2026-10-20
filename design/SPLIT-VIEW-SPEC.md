# Split view: agreed spec (proposed 2026-10-19; updated with the owner's decisions of 2026-10-20)

Boards: the "Split view" page of the design canvas (version 34): SplitPill.dc.html, SplitOpen.dc.html, SplitMotion.dc.html, SplitStart.dc.html, SplitDrop.dc.html, SplitSpec.dc.html.

## Split view (agreed design: a design concept and an engineering concept, merged 2026-10-19)

Split view shows two pages side by side in one window, left and right only, with no stacking and no grid. Deer runs Firefox 157's own split view, which is on by default in the engine, from Deer's own bar, menus and divider, and hides Firefox's split-view chrome.

Every number below is for the canonical scene:
- a 1440×900 window;
- Field Notes (fieldnotes.press, a light page) paired with Tideline (tideline.fm, a dark page);
- Field Notes on the left and focused, at 50/50;
- Refract, vitre-shell, Long Exposure Club and Home as circles, in house order.

The boards set the bar to Always so pages keep their 68 px strip. The default, auto-hide, appears on SplitSpec.

### Decided by the owner 2026-10-20
These override anything that differs elsewhere in this spec.
1. **The tab bar stays centred and never moves.** In a split, the bar group (the split pill, the other tab circles and the + circle) is laid out exactly as for one tab: centred in the window, top 12, at every divider position and window width. It does not follow the divider, and the pill's seam is not aligned with the gutter. Dragging the divider moves only the panes.
   - The whole group takes the light or dark theme of the focused side, because the address field acts on that side. The window controls keep sampling the page under them.
2. **Ctrl+Shift+U toggles split view.** On a single tab it is "New tab in split view" (an empty Home on the right, focused). In a split it is Separate tabs. It is printed beside those two menu rows.
3. **Image links get no split row.** Their menu is already full, so it stays as specced.
4. **Confirmed as specced:**
   - a tab circle is dragged to a page edge after a 300 ms press-and-hold, because a plain drag on the bar moves the window;
   - the tab pill's menu has "New tab in split view".

**Principles**
- **The pill is a clasp.** The pair is one pill split into two halves: the left half is the left page and the right half is the right page. The bar stays centred where it always is, so the halves match the pages by order, not by position, and the seam meets the gutter only by chance.
- **One side has focus, and it shows quietly.** The focused side is the side last clicked. In Firefox 157 it *is* the selected tab, so page keys, the address field, find, Reload and Back already act on it with no new routing. It shows as an outlined half in the pill and a 1 px accent rim on its pane, and the bar's glass takes that side's theme. Nothing is dimmed, because both pages are being read.
- **Starting a split never moves focus.** The page you were on keeps focus. The one exception is "New tab in split view", whose empty side needs typing.
- **Pages never animate their width.** A page lays out once at its final width, and only transforms and opacity animate (the Peek rule).

### Decided between the two concepts

| Topic | Design concept | Engineering concept | Agreed, and why |
|---|---|---|---|
| Engine | — | Drive Firefox 157's split view through one wrapper file | **Engineering.** The model, focus, docshell activity, session restore, per-pane notification bars and DOM full screen come free. |
| Between the pages | 8 px Mica gutter, rounded panes | 1 px seam, no gutter | **An 8 px gutter in a solid colour, with 8 px inner corners.** Firefox already lays out split panels with a margin and clips them to rounded corners, so a gutter is the engine's own path. It keeps both pages' scrollbars clear of the divider. Mica for an 8 px strip would need a spike for almost nothing. |
| Divider hit area | 12 px | 10 px over the right page | **The 8 px gutter itself** (24 px by touch). It takes no pixels from either page. |
| Minimum pane | 320 px | 360 px, with 50/50 locked below a 720 px window | **320 px, and the split collapses below a 648 px window.** 320 is WCAG's reflow width, and it lets split work in half of a 1366 px laptop screen. The collapse is one CSS rule. |
| Snaps / limits / reset | Snaps at 1/3, 1/2, 2/3 with a pulse; rubber band; 240 ms glide on reset | Snap at 1/2; clamp; one re-layout | **Engineering.** One magnet at 50/50 (±8 px), no pulse, a hard clamp, and double-click resets in one step. |
| Live resize | Live, with a ghost mode | Live, at most once per frame | **Live at most once per frame, with ghost mode as the fallback** when a pane takes more than 50 ms to lay out (the threshold comes from spike S2). |
| Focus cue | A plate on the focused half plus a 1 px accent rim | A 2 px ring, plus 288/192 faces that re-weight on focus | **The plate plus a 1 px rim (the Windows accent-border width).** The rim pulses to 2 px only when focus moves by keyboard. It honours the owner's "that side outlined" and stays quiet. |
| Pill layout | Equal halves; one Back, Forward and Reload | Each face has its own buttons and the faces re-weight on focus | **Equal halves with shared buttons that act on the focused side.** Nothing moves when focus moves except the plate. |
| Where the pill sits | The seam rides the gutter and the bar follows the divider | The pill keeps its slot | **The owner's decision (2026-10-20): the bar stays centred and never moves.** It is laid out exactly as for one tab. The seam is not aligned with the gutter, and dragging the divider moves only the panes. |
| Bar glass | Per element, from the page under it | One theme for the window; clear when the sides disagree | **The owner's decision (2026-10-20): the whole group (split pill, circles, +) takes the focused side's theme,** because the address field and the pill's buttons act on that side. When one page is light and the other is not, glass over the other page uses the mixed tint, because a plain tint over the wrong page is unreadable (dark text on light glass over a black page, white text on clear glass over a white one). The window controls keep sampling the page under them. |
| A pair in the background | 80×44 twin; its × closes both | 96×44 capsule; × per half | **The 96×44 capsule.** It has exactly the footprint of two circles, so the bar keeps today's coordinates. Each half has its own ×, a click focuses that side, and the menu has "Close both". |
| Address field | 640 px, centred on the pill, with a side glyph | Centred over the focused pane | **Centred in the window as today (400–1040 at 1440 px), growing from the clicked half,** with a side glyph, and the mixed tint when one page is light and the other is not. No new placement rule. |
| Keys | New Ctrl+Shift+U; F6 cycles both pages; the pair is one stop for Ctrl+Page Down and Ctrl+1–9 | No new key; F6 unchanged; sides are tabs | **Ctrl+Shift+U toggles split view (the owner's decision, 2026-10-20).** F6 cycles both pages, which is the Windows meaning of "next pane". The sides are tabs for Ctrl+Page Up/Down and Ctrl+1–9, which costs nothing in Firefox and keeps "count the favicons" true. The pair is one Ctrl+Tab entry. |
| Drag a circle to an edge | Pull a circle downward | Press and hold for 300 ms | **Hold for 300 ms.** Today, dragging a bar item 5 px starts Windows' move loop, which keeps the mouse. A downward rule would also break Aero Snap's drag-down-to-restore and block a later reorder drag. *(Confirmed by the owner, 2026-10-20.)* |
| Drop zones and preview | Zone within 25% of each edge (at least 160 px); a frosted plate showing the tab | 40% columns with an accent wash | **The outer thirds of the window below the bar band, with a frosted plate that shows the tab.** No accent, because menus never use it. No outline of the remaining page. |
| Link row | [S], third row; in a pair it loads into the other side | [V], after Peek; same pair behaviour | **[S], third row; in a pair it reads "Open link on the right side".** V is already "Save image as…" in the image-link menu. |
| Focus after a link opens | Stays on the page | Moves to the new side | **Stays on the page.** In index-and-article reading the index keeps focus. |
| Empty side | Ctrl+Shift+U and a + menu item | An optional pill-menu row | **One pill-menu row, "New tab in split view" [N], and Ctrl+Shift+U.** No + menu item. *(The row was confirmed and the key chosen by the owner, 2026-10-20.)* |
| Peek in a pair | A sheet over its own pane only | A window-centred sheet over both panes | **Unchanged:** window-centred, with both panes dimmed. |
| Permission prompt from the unfocused side | Hangs from that side's half | Waits until that side is focused | **Engineering.** Firefox's PopupNotifications follow the selected tab. |
| Ctrl+Shift+T after closing a side | Re-pairs the tab | Reopens it as an ordinary tab | **An ordinary tab.** Firefox keeps no record of closed pairs. |

### How to start split view

**From a tab circle.** Right-click a circle. "Open in split view" [S] is the first row, in its own group, and pairs that tab with the active tab.
- The circle keeps its side of the bar: a circle left of the pill becomes the left half, and a circle right of it becomes the right half.

**From a link.** "Open link in split view" [S] is the third row of the link menu, after Peek link. It opens the link as a new tab on the right of the current page.
- **Inside a pair**, the row reads "Open link on the right side" (or "…left side", whichever side is opposite the link's own page). It loads the link into that side's tab, so Back on that side returns to the previous page. This makes index-and-article reading easy.

**By dragging a tab circle to an edge.**
- **Lift.** Press a circle and hold it for 300 ms without moving 5 px, and it lifts.
  - A press that moves 5 px within 300 ms still moves the window, exactly as today.
  - Releasing a lifted circle within 5 px of where it lifted counts as a click.
  - By touch and pen, press-and-hold is Windows' context menu, so those inputs use the menu row instead.
- **Drop zones.** The zones are the left and right thirds of the window below the 68 px bar band; at 1440 that means x < 480 or x > 960. They extend past the window edge, because the pointer is captured.
- **Drop.** Releasing in a zone pairs the tab on that side. Releasing anywhere else, on the bar, or pressing Esc cancels.

**From the tab pill, with an empty side.** "New tab in split view" [N] is in the pill's menu, and Ctrl+Shift+U does the same.
- The current page goes to the left. A new Home tab opens on the right with its 640 px field already open and focused.
- Typing loads the page into that side. Open tabs that match what you type list "Show here" instead of "Switch to tab"; choosing one moves that tab into the side, the Home tab is dropped, and the moved tab's circle leaves the bar (420 ms on the spring).
- The row is not offered on Home, and Ctrl+Shift+U does nothing there.

**Rules for every route**
- **Bar slot.** The pair takes the active tab's place in the bar. The joining circle's slot closes up and the group re-centres, exactly as when a tab closes (420 ms on the spring). In the canonical scene the pill moves 26 px right (322 to 348) and the circles after Tideline's slot move 26 px left.
- **Focus** stays where it was (except for the empty side).
- **When a pair is already active**, the circle row reads "Open in split view instead of Tideline" (up to 20 characters of the title, then …).
  - It replaces the Home side if there is one, otherwise the unfocused side.
  - The replaced tab returns to the bar as a circle beside the pair on its side; it is not closed.
  - A drop onto a side replaces that side in the same way.
- **Home.** At most one side is Home, and Home is never paired with Home (those rows are left out).
- **Too narrow.** Below a 648 px window (2 × 320 + 8), every start is refused:
  - the rows grey out with a dim "Window too narrow" in the accelerator column, the same pattern as the video menu's "Protected";
  - Ctrl+Shift+U on a single tab does nothing, and Narrator says "Window too narrow for split view";
  - no drop zones appear.
- **Where split view is not offered:** popup windows, a peek sheet's link menu, the peek header, file, mailto:, tel: and javascript: links, and image links (their menu is already full; the owner's decision, 2026-10-20).

### Anatomy (1440×900, 50/50)

The bar group is laid out exactly as for one tab: centred in the window, top 12. Its centre is the window's centre at every divider position and window width, so only the panes and the gutter move.

| Element | Window rectangle | Notes |
|---|---|---|
| Left pane (Field Notes) | 0, 0, 716×900 | 0–68 is the page's own strip (Always mode) |
| Gutter | 716, 0, 8×900 | Full height; the bar floats over its top |
| Right pane (Tideline) | 724, 0, 716×900 | Has its own strip |
| Split pill | 348, 12, 480×44 | In the centred group, as for one tab; seam at x 588. The gutter falls under the right half (pill-local 368–376). |
| Back / Forward | 356 / 386, y 20, 28×28 | Act on the focused side |
| Left half / right half | 418–588 / 588–758 (170×44 each) | Focused plate 420–586 × 18–50, inset 2 px |
| Download-mark slot / Reload | 758–786 / 790–818 | As in the single pill |
| Refract, vitre-shell, Long Exposure Club, Home | 836, 888, 940, 992 (y 12, 44×44) | Light glass, the focused side's theme; mixed tint, because they sit over Tideline |
| + | 1048, 12, 44×44 | Light glass, mixed tint, as the circles |
| Window controls | 1320, 18, 108×32 | Over Tideline, so dark: they sample the page under them |
| Grip (on hover) | 718–722 × 430–470 | Centred on the window's height |

Other bar positions, for reference:
- **One tab active (before a split):** Field Notes pill 322–802, Tideline 810, Refract 862, vitre-shell 914, Long Exposure 966, Home 1018, + 1074.
- **Pair at 1/3:** gutter 477–485. The bar does not move: pill 348–828, Refract 836, vitre-shell 888, Long Exposure 940, Home 992, + 1048.
- **Refract active, pair in the background:** capsule 322–418, Refract pill 426–906, vitre-shell 914, Long Exposure 966, Home 1018, + 1074. These are today's coordinates.

#### Panes
- **Widths.** Left = round(r × (W − 8)) and right = W − 8 − left.
  - r is stored per pair (three decimals, default 0.5) and kept through window resizes, clamped to the minimums.
  - At 1440 the left pane can be 320–1112 px.
- **Gutter: 8 px.** It matches the bar's 8 px gap and the 8 px window radius.
  - Its colour follows Deer's Appearance mode, as menus do, never the pages: #202020 in dark mode, #F3F3F3 in light mode.
  - In forced colours it is Canvas.
- **Corners.** Inner corners at the gutter are 8 px. Outer corners follow the window: DWM's 8 px when restored, 0 when maximized or in F11.
- **Rims.** A 1 px line inside each pane, not hit-testable.
  - **Focused pane:** #005FB8 over a light page; #4CC2FF over a dark page, Home or a photo.
  - **Other pane:** rgba(0,0,0,0.10) over a light page, rgba(255,255,255,0.10) over a dark one.
- **Strips.** Each page keeps its own 68 px strip in Always mode. There is none with auto-hide or in F11.
- **Both pages are live and visible.**
  - Neither is throttled, and videos keep playing.
  - The wheel scrolls the pane under the pointer without moving focus.
  - Drag and drop between the two pages works as it does between two windows.

#### Divider

| Property | Value |
|---|---|
| Look at rest | The gutter itself; no grip |
| Hit area | The 8 px gutter (24 px by touch). The centred bar often covers the gutter's top: the bar wins inside its own elements (y 12–56), and the gutter is grabbed anywhere else. |
| Cursor | ew-resize (↔), as soon as the pointer enters |
| Hover | After the pointer rests 120 ms, a grip fades in over 120 ms: 4×40, radius 2, white 0.70 on the dark gutter, black 0.45 on the light one. The gutter lightens by white 0.04 (or darkens by ink 0.04). |
| Drag | The grip turns #4CC2FF (dark gutter) or #005FB8 (light gutter). Both pages resize live, at most once per animation frame. Only the panes move; the bar never does. |
| Ghost mode | Used if a pane takes more than 50 ms to lay out. For the rest of that drag only the gutter and grip move, with a 2 px accent line in the gutter, and the pages resize on release. |
| Limits | Each pane is at least 320 px, with a hard clamp. One magnet at 50/50, ±8 px. |
| Double-click (double-tap by touch) | Back to 50/50 in one re-layout. The bar does not move. |
| Esc while dragging | Cancels; the divider returns to where the drag started |
| Keyboard | One Tab stop between the tab bar and the focused page. Left/Right move it 16 px, Shift+Left/Right 64 px, Home/End go to the minimums, Enter returns to 50/50. Focus shows the accent grip and a 2 px focus ring around it (offset 2). |

#### Split pill
The pill is 480×44, takes the active slot, and uses the existing 480×44 tab lens.

| Part | Pill-local x | Window x | Notes |
|---|---|---|---|
| Back / Forward | 8–36 / 38–66 | 356–384 / 386–414 | Tooltip "Back  Alt+Left"; Narrator "Back, left page" |
| Left half | 70–240 | 418–588 | Half-local: favicon 16 px at 14–30 (y 14–30); host from 38, ending at 158 in a 12 px fade; × 24×24 at 140–164 (y 10–34), shown on hover only, and the text then ends at 136 |
| Seam | 240, 1×20, y 12–32 | 588 | In the bar's theme: rgba(22,24,29,0.12) on light glass, white 0.16 on dark or clear glass. It is not aligned with the gutter. |
| Right half | 240–410 | 588–758 | Same inner layout |
| Download-mark slot | 410–438 | 758–786 | Shows the focused side's "Download this video" mark; otherwise kept empty, as today |
| Reload / Stop | 442–470 | 790–818 | Stop only while the focused side loads; Shift+click hard-reloads |

- **Focused half.** A plate inset 2 px (half-local 2–168, y 6–38, radius 16) in Deer's "on" style:
  - light glass: rgba(0,95,184,0.10) with an inset 1 px rgba(0,95,184,0.35);
  - dark glass: rgba(76,194,255,0.18) with an inset rgba(76,194,255,0.45);
  - clear glass: white 0.16 with an inset white 0.45.

  The host is --g-text at weight 500.
- **Unfocused half.** No plate. The host is --g-icon at weight 400. The favicon stays at full strength. On hover it gets a --g-hover plate in the same geometry, and while its menu is open a --g-press plate.
- **What a half shows.**
  - The **host** (fieldnotes.press, tideline.fm), so the half keeps its meaning as a small address field.
  - If both sides share a host, both halves show **page titles** instead.
  - The full title shows in the dark tooltip under the half at y 64.
  - A Home side shows the search glyph and "Search" in --g-placeholder.
  - Zoom keys flash "110%" in that side's half for 2 s.
  - Load lines: a 2 px accent line along the bottom of each half that is loading.
- **Glass.**
  - One lens, one tint and one 1 px rim for the whole pill, in the bar's theme, which is the focused side's (the owner's decision, 2026-10-20).
  - The pill spans the gutter at most divider positions. When one page is light and the other is not, it uses that theme's mixed tint (see "Mixed tint" below).
  - One contact shadow, the darker page's.
  - When focus moves to a side with another theme, the whole group cross-fades to it (150 ms).
- **Clicks.**
  - Unfocused half: works like a circle. A click focuses that side and puts keyboard focus in its page.
  - Focused half: works like the pill. A click opens the address field for that side.
  - Middle-click or the × closes that side. The ×'s tooltip is "Close this side".
  - Right-click opens that half's menu without moving focus.
  - Dragging the pill still moves the window. Halves never lift in v1.
- **Extensions.** Extension buttons sit between the right half and the mark slot, and both halves give way equally. Today's rule (pinned buttons give way below a 140 px address, the cluster below 100 px) is applied to each half.
- **Give-way.** Before circles shrink, the pill narrows from 480 to 360 and the halves narrow equally from 170 to 110. Below that, the bar's steps 3 and 4 apply as today.
- **Address field for one side** (Ctrl+L, Alt+D, F6 to the pill, or a click on the focused half).
  - It is the usual 640×48 field, centred in the window as today (400–1040 at every divider position), growing from that half in 240 ms.
  - Its leading icon is a 16 px side glyph. The outline is `M5 4.5h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM10 4.5v11`, and the edited half is filled at 0.35 (left half: `M5 4.5h5v11H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z`).
  - Narrator: "Address for the left page".
  - Enter loads into that side, Alt+Enter opens a new tab, and Shift+Enter or Ctrl+Q peeks.
- **Mixed tint.** When one page is light and the other is not, any glass in the bar group that sits over the other page, even partly, uses the mixed tint of the bar's theme: the split pill, this field and its suggestions, the find face, and circles or + over that page. When both pages share a theme, the normal tint is used.
  - Light theme: linear-gradient(180deg, rgba(255,255,255,0.70), rgba(255,255,255,0.54)).
  - Dark or clear theme: the dark gradient over rgba(16,16,20,0.72).
  - In the worst case (dark text over a black page, white text over a white page) text stays at 4.5:1 or better.

#### Pair capsule (a pair while another tab is active)
- **Shape.** 96×44, radius 22, the same glass as a circle. That is 2 × 44 + 8, exactly the footprint of two circles. With compact circles it is (2s + gap) × s, for example 64×30.
- **Contents.** 18 px favicons centred at x 22 and x 74, and a 1×16 hairline at x 48 (y 14–30) in the text colour at 0.12.
- **Hover a half.** The capsule takes the circle hover tint, and the 18 px close badge appears at that half's outer top corner (−5, −5). The badge closes that side, and the other side becomes a plain circle.
- **Click a favicon.** Shows the pair with that side focused. The capsule morphs into the pill over 420 ms on the spring, as a circle does.
- **Names.** Tooltip: that side's title. Narrator: "Field Notes and Tideline, split view".
- **Lens.** Needs a new 96×44 lens map (and 64×30). In code, `rowLens` already takes capsules of any width.

#### Where the bar sits
The owner's decision (2026-10-20): the bar stays centred and never moves.
- **Layout.** The bar runs `arrange()` as today, with the active pair counted as one 480-wide unit and a background pair as a 2·size + gap capsule. The group is centred in the window at top 12, exactly as for one tab.
- **Canonical scene.** The group is 348–1092 and the pill 348–828, at every divider position. At 50/50 the gutter (716–724) falls under the right half.
- **Dragging the divider** moves only the panes and the gutter. Nothing in the bar moves, re-flows or changes its lens.
- **Theme.** The whole group (the split pill, the other circles and +) takes the focused side's theme, because the address field and the pill's buttons act on that side.
  - When one page is light and the other is not, glass over the other page uses the mixed tint (see "Mixed tint").
  - When focus moves to a side with another theme, the group cross-fades to it over 150 ms.
  - When the gutter passes under a glass element during a drag, that element cross-fades between the normal and the mixed tint over 150 ms.
  - The window controls keep sampling the page under them: over Tideline in the canonical scene, so dark.

  Menus and tooltips still follow the Appearance mode.

### States
- **At rest:** left focused or right focused.
- **Hovering a half:** its plate and its ×. Hovering the ×: a --g-hover circle behind it.
- **A half's menu open:** that half pressed.
- **Loading:** a load line per half, and Stop in place of Reload while the focused side loads.
- **Divider:** rest, hover, drag, keyboard focus, ghost.
- **Pair in the background:** the capsule at rest, or hovered with one half's badge.
- **Home side:** "Search" and the wallpaper; the bar takes clear glass while that side is focused (see Home under "With the rest of Deer").
- **Find open** on the focused side.
- **Address field open** for one side.
- **Bar hidden** (auto-hide, the default): only the panes, gutter and rims.
- **Lifted circle:** no zone, left zone, or right zone; when a pair is active, a zone replaces that side.
- **Collapsed** (window narrower than 648 px).
- **Element full screen** from one pane.

### Focus
- **The focused side** is the pair's selected tab, and it is stored with the pair. It is the side keys, the address field, find, Reload, Back, Forward and the mark act on.
- **It moves on:**
  - a primary or secondary mouse-down in a pane (hover never moves it);
  - a click on the unfocused half;
  - F6 or Shift+F6;
  - Ctrl+Page Up/Down;
  - a mouse Back/Forward side button over the other pane;
  - closing the focused side (the partner takes focus).
- **Pages can't steal it.** `window.focus()` from the unfocused page does not move focus unless that pane had input in the last second. A page dialog such as `alert()` does take focus, because it must be answered.
- **How it shows:** the plate, the 1 px rim, the bar's glass taking that side's theme, and Narrator saying "Right page, Tideline". After a keyboard move the new rim pulses to 2 px at full strength, holds 200 ms, then settles to 1 px over 400 ms on the expand curve. A click gets no pulse.

### Menus
All menus use Windows 11 menu rules (see MenuSpec). Bar menus hang at y 64.

- **Background tab circle** (264×305, or 339 with Mute):
  - caption
  - **Open in split view [S]** (split glyph)
  - Reload tab [R] · Duplicate tab [D] · Copy address [A] · Mute tab [M] (only if it has played sound) · Move tab to new window [W]
  - Close other tabs [O] · Close tab [C]

  While a pair is active the first row reads "Open in split view instead of Tideline" (336 px wide).
- **Link** (288×302):
  - Open link in new tab [T] · Peek link  Shift+click [P] · **Open link in split view [S]** · Open link in new window [W] · Open link in new private window [R]
  - Copy link address [E] · Download linked file [D]
  - Inspect [N]

  In a pair, the third row reads "Open link on the right side" (or "…left side").
- **Tab pill** (320×268 with Paste and go; the Ctrl+Shift+U accelerator widens it from 264):
  - Copy address [A] · Paste and go [G] (or Paste and search [S])
  - Duplicate tab [D] · **New tab in split view  Ctrl+Shift+U [N]** · Mute tab [M] (only if it has played sound) · Move tab to new window [W]
  - Close other tabs [O] · Close tab  Ctrl+W [C]
- **Split pill, on a half** (264×234; it acts on that half's side):
  - Copy address [A] · Paste and go [G] (or Paste and search [S])
  - **Swap sides [P]** (swap glyph) · **Separate tabs  Ctrl+Shift+U [E]** · Mute tab [M] (only if it has played sound)
  - Close other tabs [O] (keeps both sides) · Close tab [C] (Ctrl+W is printed only on the focused half)

  Separate tabs acts on the whole pair, so Ctrl+Shift+U is printed on both halves.
- **Pair capsule** (264×194):
  - caption "Field Notes · Tideline"
  - Swap sides [P] · Separate tabs [E] (no accelerator: Ctrl+Shift+U acts on the active tab, not on a pair in the background)
  - Close other tabs [O] · Close both tabs [C]
- **Separate tabs:** both tabs stay open. The focused side stays active and the other becomes a circle beside it on its own side.
- **Swap sides:** the divider stays where it is and the pages trade places.
- Every other menu is unchanged, including + and the peek header.

### Motion
One spring, `cubic-bezier(0.22, 1, 0.36, 1)`, plus the expand curve `cubic-bezier(0.2, 0, 0, 1)`.

| Moment | Motion |
|---|---|
| Split forms | **At 0 ms:** the menu fades out over 100 ms with its row lit, and the current page lays out at its pane width in one step. The new pane slides 24 px in from its outer edge (280 ms, spring) and fades in (200 ms). An unpainted page keeps a frosted cover until first paint (at most 600 ms), which then fades over 200 ms. **0–420 ms (spring):** the joining circle morphs into its half (a dropped circle flies in), its slot closes up and the group re-centres, as when a tab closes. The current tab's favicon and host slide into its half (240 ms). If one page is light and the other is not, glass over the new pane cross-fades to the mixed tint (200 ms); with "New tab in split view" focus moves to the Home side, so the whole group cross-fades to that side's clear theme (200 ms). **120–240 ms:** the seam fades in. **240–390 ms:** the focused plate and rim fade in. |
| Focus moves | The plate glides between halves (240 ms, spring); text weight and colour change over 150 ms; the rims cross-fade over 150 ms; if the new side has another theme, the bar group cross-fades to it over 150 ms; a keyboard move adds the 2 px pulse (hold 200 ms, settle 400 ms) |
| Divider | The grip fades in over 120 ms after a 120 ms rest; the accent comes in over 120 ms; only the panes move, never the bar; a reset or keyboard step re-lays out in one step |
| Lift, drop, cancel | At 300 ms the circle scales to 1.08 with the shadow 0 14px 32px rgba(0,0,0,0.26) (160 ms, spring), and its slot keeps the glass rim alone at 0.5. The lifted circle keeps the bar's theme, and uses the mixed tint while it is over a plate of the other theme. The plate fades in over 120 ms and reveals from its outer edge with clip-path (240 ms, spring). Moving to the other zone cross-fades over 120 ms. A drop runs "Split forms", with the circle flying into its half (420 ms). A cancel flies the circle back (280 ms) and fades the plate (120 ms). |
| Swap sides | The halves' contents cross over (320 ms, spring); the pages swap in one re-layout and fade in over 150 ms |
| Close one side | Its half collapses into the seam (280 ms, spring); its pane slides 24 px outward and fades (200 ms); then the other page widens in one step. The pill keeps its slot, and the bar's glass settles on the remaining page's theme (200 ms) |
| Separate | The other half shrinks into a 44 px circle and slides to its slot as the group re-centres (420 ms, spring); the remaining favicon and host re-centre (240 ms); the seam fades (120 ms); the other pane slides out 24 px and fades (200 ms); then the page widens |
| Pair ↔ another tab | The capsule and the pill morph into each other (420 ms, spring), as a circle and the pill do; the pages swap at once |
| Collapse / restore | The hidden pane fades over 150 ms; restoring uses the page motion of "Split forms" |
| Reduced motion | Every row becomes a 150 ms cross-fade, with no glide, scale, slide, flight or pulse. Drags stay direct. A cancelled lift fades out at the pointer and back in at its slot. |

### Keys

| Keys | In split view | Priority |
|---|---|---|
| Ctrl+Shift+U | Toggles split view (the owner's decision, 2026-10-20). On a single tab it runs "New tab in split view": the page goes left, and an empty Home opens on the right with its field open and focused. In a pair it runs Separate tabs: the focused side stays active. It does nothing on a single Home tab or in a popup window. On a single tab below a 648 px window it does nothing and Narrator says "Window too narrow for split view". Printed beside "New tab in split view" and "Separate tabs". Ignores key repeat; the AltGr and IME guards apply. | page-first, like Ctrl+Shift+A and Ctrl+Shift+D. F6 then Ctrl+Shift+U, or the pill's menu, is the route a page can't block. |
| F6 / Shift+F6 | Cycles left page → right page → address pill → left page (Shift reverses). Moving into a page focuses that side. While find is open, the pill stop is the find field. A peek's own stops replace its source page's stop. | browser-first. "F6 always leaves the page" stays true. |
| Ctrl+Page Down / Up | Tabs in bar order. The two sides are two stops, left then right. | browser-first |
| Ctrl+1 … Ctrl+8, Ctrl+9 | Count favicons from the left; each side counts | page-first |
| Ctrl+Tab (tap or hold), Ctrl+Shift+Tab | The pair is one most-recent entry. Landing on it restores the side that last had focus. Switching sides is not recorded. | browser-first |
| Ctrl+Shift+Page Up / Down | Moves the pair as one | page-first |
| Ctrl+W, Ctrl+F4 | Closes the focused side (a peek or panel on top closes first); the other side fills the window | browser-first |
| Ctrl+Shift+T | Reopens a closed side as an ordinary tab | browser-first |
| Ctrl+L, Alt+D, Ctrl+F, F3, Ctrl+G, Ctrl+R, F5, Ctrl+P, Ctrl+S, Ctrl+U, zoom, F12, Alt+Left, Alt+Right, Ctrl+Q, Ctrl+Shift+D | Act on the focused side (topmost first: panel, then that side's peek, then that side) | page-first |
| Mouse side buttons, hardware Back/Forward | Act on the pane under the pointer and focus it | — |
| Divider keys | Left/Right 16 px, Shift+Left/Right 64 px, Home/End to the minimums, Enter for 50/50 | local |
| Esc during a drag | Cancels a divider drag or a lifted circle. This is a new rung of the Esc ladder, right after the IME. | local |

### With the rest of Deer
- **Find.**
  - Ctrl+F finds in the focused side. The whole 480 px pill becomes the find face, in the bar's theme (the mixed tint when one page is light and the other is not), showing the focused side's favicon.
  - Highlights, the landing ring and the scroll guard appear only in that pane.
  - Find state stays per tab. Focusing the other side shows that side's find state, and coming back restores this side's, parked.
- **Peek.**
  - The sheet is unchanged: window-centred, 1040×804 at (200, 72), with both panes dimmed at 0.22.
  - A click on either dimmed pane closes the peek, and focus returns to the link in its own pane.
  - Open as tab places the new tab after the pair, and the pair becomes a capsule.
  - Both panes stay on screen while the promote animation runs.
- **Downloads.**
  - The ring is unchanged.
  - The mark in the pill is the focused side's video.
  - The "Download this video" hover pill works over either pane, and its quality picker opens over that pane.
- **Home.**
  - A Home side shows the wallpaper covering its pane, and nothing else.
  - A video background shows its poster frame until Home fills the window again.
  - While it is the focused side, the whole bar takes clear glass (in the mixed tint when the web side is light).
  - Navigating it makes it an ordinary web side.
  - If the web side closes, the pair becomes a plain Home tab.
- **Auto-hide (the default) and F11.**
  - No strips; panes start at y 0.
  - The bar reveals centred, exactly where it sits for one tab.
  - The rim is the cue that is always visible.
  - Ctrl+L, Ctrl+F and drags hold the bar shown.
  - In F11 the split stays and outer corners are 0.
- **Element full screen** from one pane fills the screen, using Firefox's inDOMFullscreen rules. The other pane is hidden but keeps its sound, and Esc returns to the split.
- **Settings and Downloads panels:** unchanged, dimming both panes.
- **Switcher.**
  - A pair is one card showing both pages at the ratio, with the gutter scaled.
  - In the dock the pair is the capsule at dock size.
  - Search matches either side, and opening a result focuses the side that matched.
  - Ctrl+W or Delete on a pair card closes both tabs.
- **New tabs** from either pane (Ctrl+T, +, target=_blank) open after the pair and are selected, so the pair becomes a capsule. Ctrl+click still opens a background tab.
- **Prompts and other per-pane surfaces.**
  - Permission prompts hang from the focused half. A prompt from the other side shows when that side is focused.
  - Page dialogs show inside their own pane.
  - The link status bubble sits 12 px in from the bottom-left of the pane under the pointer.
  - Developer tools dock in the focused pane.
  - The window title shows the focused side.
- **Theme sampling** runs for each pane, over that pane's part of the strip under the bar. Both shown tabs accept scroll and paint samples. The focused pane's result sets the bar's theme, the other pane's decides where the mixed tint is needed, and the window controls use the pane under them.

### Edge cases
- **Collapsed window.** Below 648 px wide, only the focused side is shown, filling the window.
  - The pill keeps both halves, and clicking the other half shows that side instead.
  - The divider hides; the bar stays centred, as always.
  - "Open link on the … side" also shows that side.
  - Narrator says "Window too narrow: showing Field Notes".
  - The split comes back at 680 px or wider (a 32 px hysteresis), at its stored ratio, clamped.
- **The bar over the gutter.** The bar never moves, so at most divider positions, and in any narrow window that still shows the split (648 px and up, where the pill and circles give way as usual), it covers the top of the gutter.
  - The bar wins inside its own elements (y 12–56). The divider is grabbed anywhere else along the gutter, and its hover grip sits at the window's mid-height, never under the bar.
  - Nothing moves out of the way. Glass that crosses onto the other page uses the mixed tint when one page is light and the other is not.
  - With auto-hide (the default) and in F11 the bar is hidden, so the whole gutter is free.
  - The halves still match the pages by order: the left half is the left page even when the divider is far to one side.
- **After a restart**, pairs, the focused side and the ratio all come back.
  - Both sides load when the pair is first shown.
  - A window narrower than 648 px restores collapsed.
- **A crashed unfocused pane** shows a small frosted card centred in that pane: "This page stopped" with a Reload button. Firefox shows its crash page only for the selected tab.
- **Mouse Back/Forward over the unfocused pane** acts on that pane and focuses it.
- **A Home side plus a circle's "Open in split view"** replaces the Home side.
- **Two Home tabs** are never paired.
- **Unloaded tabs** load when they join a pair, behind the frosted cover.
- **Zoom** stays per side (Firefox's per-site zoom).
- **Private windows** work like normal windows. **Popup windows** never split.
- **Closing both tabs** (from the capsule menu, or from a switcher card) puts two entries on the closed list, and each reopens as an ordinary tab.

### Accessibility
- **Names and roles.**
  - Pill: `group` "Split view: Field Notes, left; Tideline, right".
  - Focused half: button "fieldnotes.press, left page, edit address", `aria-pressed="true"`.
  - Other half: button "tideline.fm, right page", `aria-pressed="false"`.
  - Half ×: "Close left page, Field Notes".
  - Back, Forward and Reload names carry the side.
  - Panes are labelled "Left page: Field Notes" and "Right page: Tideline".
  - Divider: `separator`, `aria-orientation="vertical"`, focusable, named "Split divider". `aria-valuenow` is the left pane's percentage, `aria-valuemin`/`aria-valuemax` come from the minimums (22–78 at 1440), and `aria-valuetext` reads "Left page 50 percent".
  - Capsule: "Field Notes and Tideline, split view".
- **Announcements (polite):** "Tideline opened on the right", "Right page, Tideline", "Sides swapped", "Split view closed", "Field Notes closed. Tideline fills the window.", "Window too narrow: showing Field Notes".
- **Contrast.**
  - Rim #005FB8 on cream: about 5.4:1. Rim #4CC2FF on #0e0f12: about 9.5:1.
  - Grip white 0.70 on #202020: about 8.6:1. Grip black 0.45 on #F3F3F3: about 3.3:1.
  - The hairline and the seam are decorative; the rim, the plate and the names carry the meaning.
- **Forced colours.**
  - Gutter Canvas; pane edges 1 px CanvasText; focused pane 2 px Highlight.
  - Focused half: a 2 px Highlight outline.
  - Grip ButtonText, or Highlight while focused or dragging.
  - Drop plate: Canvas with a 2 px Highlight outline, no frost.
- **Transparency effects off:** a solid gutter, and a solid #2C2C2C or #F9F9F9 drop plate.
- **Touch:** a 24 px divider hit area and double-tap to reset; split is started from the menus. Menu rows are 40 px by touch.
- **Keyboard routes for every gesture:** the menus for starting and swapping, Ctrl+Shift+U for an empty side and for separating, the divider keys for resizing, and F6 for moving between pages.

### Not in v1
**Not in v1:**
- More than two pages, stacking or a grid (the owner's decision).
- Dragging a link or URL to an edge. Lifting pill halves or capsules (swapping by drag). Reordering tabs by drag (the lift is built so reordering can reuse it).
- Moving a pair to another window, or tearing a tab off.
- Synchronised scrolling. A setting that makes links from one side open in the other.
- "Open in split view" in the peek header. A split row on image links (their menu is already full; the owner's decision, 2026-10-20).
- Re-pairing a closed side on Ctrl+Shift+T.
- An attention dot on a half for a permission prompt waiting on the other side.
- Snap points other than 50/50. Mica in the gutter.
- Any setting for split view.

**Rejected:**
- Firefox's per-pane footer or toolbar, because the pill already names both sides.
- A × in a pane's corner, which would sit under the bar and cover sites' own buttons.
- Dimming the unfocused pane.
- A permanent 2 px accent outline.
- Back, Forward and Reload that move with focus.
- Re-weighted faces.
- A one-time hint.

### Build notes (Gecko 157, for later)
- **What Firefox already provides.** Split view is on by default (`browser.tabs.splitView.enabled`):
  - `gBrowser.addTabSplitView([a, b], { insertBefore })`, which refuses pinned tabs;
  - the `<tab-split-view-wrapper>` element, with `unsplitTabs()`, `reverseTabs()`, `replaceTab()` and `close()`;
  - `activeSplitView`, `splitViewBrowsers`, and `showSplitViewPanels`, which keeps both docshells active;
  - the events `SplitViewCreated`, `SplitViewRemoved`, `TabSplitViewActivate`, `TabSplitViewDeactivate` and `SplitViewTabChange`;
  - session save and restore of pairs (the ratio is not saved);
  - per-pane notification bars.

  Clicking or focusing a pane selects its tab.
- **One Deer file, `src/window/split.ts`,** wraps these and names its sources. The Browser API gains:
  - `b.split()`, `b.separate()`, `b.swapSides()`, `b.splitRatio()`;
  - `b.units()` and `b.shown(tab)`;
  - a `split-changed` event.
- **CSS on `#tabbrowser-tabpanels[splitview]`.**
  - Column 0: `width: calc(var(--vitre-split, .5) * (100% - 8px)) !important; margin: 0 8px 0 0 !important`.
  - Column 1: `flex: 1; margin: 0`.
  - Panels have radius 8, and Firefox's 50 ms width transition is removed.
  - Firefox's splitter, `split-view-footer` and outline are hidden. Deer's rims are drawn as an inset outline on `.browserContainer`.
  - A `[vitre-collapsed]` rule hides the panel that is not selected.
  - Deer's divider is one absolutely placed element inside the tab panels, like Peek's dim.
- **Fixes for "only the active tab is on screen" assumptions.**
  - `setSuccessor` both ways, so closing the right side doesn't jump past the pair.
  - `fx.moveTab` moves `node.splitview ?? node`.
  - `tab-activated` gains `{ withinPair }`, and the switcher skips its thumbnail capture.
  - The switcher and core `cycleMru` treat the pair as one most-recent unit.
  - `b.shown(tab)` replaces `tab.id === activeId` in video.ts (hover pill) and pageactions.ts.
  - Peek promote keeps `.vitre-peek-under` on both panes.
  - A `framefocusrequested` guard (the pattern of Peek's `blockFocusRequests`).
  - The crash card.
  - The ratio is saved as tab value `vitre-split-ratio` on the column-0 tab and re-applied on `TabSplitViewActivate`.
  - `openLink` gains a `targetBrowser` option, for "Open link on the … side".
  - The omnibox's "Show here" calls `wrapper.replaceTab(home, chosen)`.
- **Bar.**
  - Pairs as units in `arrange()`; the group stays centred, with no shift.
  - One theme class for the group, from the focused pane's sample, plus a `mixed` modifier on glass over the other page when one page is light and the other is not (the glass.css selectors also match `#vitre-root .theme-*`). The window controls keep their own sample.
  - Per-pane sampling.
  - A 300 ms hold timer in `watchDrag()` that runs before the 5 px `beginWindowMove`, plus a transparent overlay over the pages and `setPointerCapture` during drags.
- **Keys.** Ctrl+Shift+U joins the page-first accelerators, with the key-repeat guard, and calls `b.split()` or `b.separate()`.
- **Cost.** About 3–4 weeks after the spikes.
- **Spikes.**
  - **S1.** `addTabSplitView` under Deer's CSS: both panes paint, no Firefox UI leaks, a click selects the side, Peek's dim covers both panes.
  - **S2.** `--vitre-split` overriding Firefox's pixel widths; dragging over remote browsers; reflow cost on heavy pages (sets the ghost threshold).
  - **S3.** After a restart, pairs, the focused side and the ratio come back, including for lazy tabs.
  - **S4.** Closing either side; `window.focus()`, `alert()` and a crash in the unfocused pane; right-clicking the unfocused pane (the menu must survive the selection change).
  - **S5.** The 300 ms hold next to `beginWindowMove`, Aero Snap from maximized, and touch press-and-hold.
  - **S6.** The cost of sampling both panes while one scrolls.

### On approval
- **DESIGN-NOTES:** this section; a "Split view" row in "Canvas pages"; and "5. Split view" in "Still to design".
- **keymap.json:**
  - Ctrl+Shift+U in "Tabs and windows": toggle split view, scope "anywhere in the window", page-first, new; printed beside "New tab in split view" and "Separate tabs". It joins the page-first list and the key-repeat list in the rules, and is rebindable like Vitre's other own verbs (Ctrl+Q, Ctrl+Shift+A, Ctrl+Shift+D);
  - the F6 ring in split view;
  - notes on Ctrl+Page Up/Down, Ctrl+1–9, Ctrl+Tab and Ctrl+W for a pair;
  - the divider's local keys;
  - the drag rung on the Esc ladder;
  - "F6 cycles both pages" in the "Different from Chrome" list.
- **MenuReference:** the new rows and menus.

### Split view artboards (to draw)
**New boards on page "Split view":**
- SplitOpen
- SplitMotion (interactive)
- SplitStart
- SplitDrop
- SplitSpec

**New part:** SplitPill.

**Part updates:**
- Article and VideoPage gain a `w` prop for pane widths.
- FindPill gains the mixed themes.
- CtxMenu gains the split rows and menus, plus the private-window row that the canvas copy still lacks.
- A new 96×44 capsule lens map.
