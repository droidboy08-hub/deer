# History panel: agreed spec (proposed 2026-10-23, awaiting the owner's approval)

Boards: the "History" page of the design canvas (version 52): HistoryOpen, HistoryMotion (interactive), HistoryMenus, HistoryStates and HistorySpec. They use a new part, HistoryPanel, and six new CtxMenu kinds: `plushistory`, `historyrow`, `historysel`, `historyday`, `closedtab` and `closedwindow`. No existing kind changes, so the approved Menus page stays as it is.

## Decided by the owner 2026-10-23
These override anything else in this spec, which has been updated to match.
1. **A floating panel** in the glass of Settings and Downloads, over the current page.
2. **Ways in:** History in the + circle's menu, and Ctrl+H. The address field keeps its quick list of recent pages.
3. **Mockups first:** the boards and this spec are settled before any code is written.
4. **Deleting one entry removes only that day's visits** of that page, as Chrome does. The same page still shows under its other days and in the address field's suggestions, as long as it has other visits. A selection deletes each selected row's visits on that row's own day. Delete day deletes that day's visits. Undo brings back exactly what was deleted.
5. **Private windows show nothing.** In a private window the panel lists no history, no search results and no Recently closed (not even that window's own closed tabs). It shows one line: "History isn’t shown in private windows." Ctrl+H and the + menu's History row still open it there.
6. **Deletes stay instant, with the 10 s Undo** and no "Are you sure?". If Deer crashes during those 10 s, the pages stay in history; this is accepted.
7. **Delete day's accessible name** contains its visible label: "Delete day, Today".

## First, the question: does Deer already have a History tab?

No. Deer has no history page, panel or tab today. Here is everything it has:
- **Ctrl+H** opens the address field empty and lists about 7 recent pages. The core action `history` is `editAddress('')` (`browser.ts`), and the list comes from `places.ts`.
- **Clicking the address field** shows the same recent list.
- **Shift+Delete**, or "Remove from history", on a suggestion row removes that page (`places.ts removeFromHistory`).
- **Settings › Privacy and security › Clear browsing data**, also opened by Ctrl+Shift+Delete.
- **Reopen closed tab** (Ctrl+Shift+T, or the + menu) brings back only the most recent tab or window. Nothing lists the others.
- Firefox's Library window, history sidebar and Firefox View are still in the engine. Deer hides them and parks their keys (`keys.ts` → `fx.parkKeysets()`).

So no screen shows more than the last few pages, and nothing lists history by day. This spec adds that.

## History (agreed design: a design concept and an engineering concept, merged 2026-10-23)

History is a third floating panel, alongside Settings and Downloads. It shows:
- your history, grouped by day;
- a search over that history;
- the tabs and windows you recently closed;
- deletes that can be undone.

It reads Firefox 157's own history database (Places) and its session store directly. Firefox's own history interface stays hidden.

Every number below is for the canonical scene:
- **Window:** 1440×900, in Windows dark mode, as on every board.
- **Page:** Field Notes (fieldnotes.press, a light page) is active and the bar is shown.
- **Time:** Thursday, 23 October 2026, about 14:40. Times follow the Windows locale; the canvas uses 24-hour time, as Downloads does.
- **History:** pages from the house sites (fieldnotes.press, tideline.fm, refract.wiki, code.vitre.dev, longexposure.club), plus developer.mozilla.org, learn.microsoft.com and en.wiktionary.org.

### The owner's brief (2026-10-23)
These points were accepted as the starting point, and all of them are kept.
1. A floating panel in the glass of Settings and Downloads, over the current page.
2. It opens from the + circle's right-click menu ("History") and with Ctrl+H. Ctrl+H now opens the panel. The quick list of recent pages stays in the address field when you click it.
3. A search field. History is grouped by day (Today, Yesterday, then dates). Each row shows the favicon, title, host and time.
4. Recently closed tabs and windows.
5. Clicking a row opens it, and the usual modifier keys work. This spec decides that a plain click opens it in the current tab.
6. A row's menu has Open in new tab, Peek, Copy link and Delete from history. "Copy link" uses the house term, "Copy address".
7. You can select several rows and delete them, delete a whole day, and follow a link to Clear browsing data in Settings.

### Principles
- **A third panel, not a new kind of surface.**
  - History reuses the Downloads skeleton: the 960×688 frosted sheet, its lens, the 48 px title bar and a 216 px sidebar with the search field on top.
  - It also shares their scrim, the scaling rule, Esc and Ctrl+W, and the rule that only one panel is open at a time.
  - Nothing in it needs explaining to someone who has used Downloads.
- **Days are Windows 11 cards.** Each day is a Settings-style group: a small heading over a card of 40 px rows, with inset hairlines between them.
- **Rows are links.**
  - A click, Ctrl+click, middle-click and Shift+click do what they do on a link.
  - Selection has its own control, a checkbox, and never takes over those gestures.
- **Deletes look instant and can be undone.**
  - No dialog asks "Are you sure?" (the owner confirmed this).
  - A delete reaches no further than its day: a row takes that page's visits on that day, and nothing from other days.
  - Places is changed only when the undo line goes away, so Undo is exact.
- **Restraint.**
  - The panel has no thumbnails, letter tiles, visit counts, timeline, calendar or sticky headings, and no coloured match fills, toasts or chips.
  - Accent appears in only three places: the current view's 3 px bar, the search field's focus line, and checked checkboxes.

### Decided between the two concepts

| Topic | Design concept | Engineering concept | Agreed, and why |
|---|---|---|---|
| Surface | A 960×688 panel on the Downloads skeleton | The same | **The same.** It reuses the float lens (`907d800c…`), the scaling rule, the Esc and close ladders, and the one-panel rule. |
| Moving between days | A "Days" group in the sidebar: a jump list plus a marker for the day in view | Sticky 40 px day headers | **Neither.** Headings are 28 px and scroll with the list. Ctrl+Up and Ctrl+Down jump between them, and a row's tooltip carries its full date. The Days group needs a count over every visit and a list that can start anywhere, which costs time that has not been measured. A sticky heading needs a frosted bar, which the house rejected on glass. A jump list is not in v1. |
| Loading | A virtual list sized by per-day counts | Pages loaded one day at a time, built as DOM with `content-visibility` and fixed heights | **Engineering.** A day was measured at 2–42 ms however large the whole history is. v1 needs no windowed list, and the fixed 40 and 28 px heights keep one possible later. |
| Search | One row per visit, the Days group filtered, Ctrl+A over everything | Pages from `moz_places`, read by a full scan and sort (`+last_visit_date`), 150 at a time, no interrupt | **The engineering query with the design presentation.** One row per page, under the day of its last visit. A search stays under 40 ms for any word at 1M visits; walking the index took 1.2 s for a rare word. Matches are Semibold, and a match only in the path shows in the address column. |
| Clicking a row | Opens in the current tab; the panel closes | The same | **The same.** Firefox's sidebar, Edge and Safari all do this. |
| Peeking a row | The sheet opens above the panel, and Esc returns to the list | The panel closes first and comes back after the peek closes | **Engineering.** A peek's page is a real `<browser>` among the tab panels, below every chrome layer (peek at z 8, panels at z 30), so nothing can draw it above the panel. History coming back warm keeps the "peek, Esc, next row" rhythm, and the Esc ladder and topmost order stay as they are. |
| Selection | A Windows checkbox in the favicon slot | A check circle | **The Settings checkbox (20×20, radius 4).** It is the same control as in Settings, so there is no new shape. Both concepts keep Ctrl+click as a link gesture. |
| Deleting a row | Removes the page from every day | The same | **Neither: only that day's visits** (the owner's decision, as Chrome does). The same page stays under its other days and in the address field's suggestions. Shift+Delete in the address field still removes the whole page, because a suggestion has no day. |
| Deleting a day | `removeVisitsByFilter` for that day | The same | **The same.** Pages visited on other days stay under those days. |
| Safety | Deferred commit, one undo line, no dialogs | Immediate delete; an inline confirmation for a day | **Deferred commit with Undo, no confirmation, plus the engineering guards** (see "Deleting, and undo"). Places has no undo, so the panel leaves it untouched until the undo line goes away. The owner confirmed this, including that a crash during the 10 s leaves the pages in history. |
| "Delete all from fieldnotes.press" | In the row menu | Optional, phase 2 | **Not in v1.** It is not in the owner's brief, and a single menu row that deletes years of visits is the wrong default. |
| Recently closed | Its own view, with Tabs and Windows cards | The same | **The same.** A closed tab restores with its own back history; a visit does not. A window row shows its selected tab's title and "Window · 5 tabs", which is SessionStore's own data, and its tooltip lists the tabs. Closed rows have no Peek. |
| Private windows | Normal history hidden behind a button | Normal history shown, with a dim line | **Neither: nothing is shown** (the owner's decision). The panel opens to one line, "History isn’t shown in private windows.", with no list, search or Recently closed. See "Private windows". |
| Ctrl+H | Page-first, opens and closes the panel | The same | **The same.** Ctrl+H stays in the "Different from Chrome" list, reworded like Ctrl+J: "opens a panel, not a page". Both concepts dropped it, but Chrome opens a History tab. |
| Address field | Adds a "Show all history  Ctrl+H" row | Unchanged | **Unchanged.** Clicking the field still lists recent pages. Ctrl+H pressed in the field opens the panel and searches for the typed text. The extra row is not in v1. |
| Warm state | 60 s: view, query, scroll and focused row | 5 min, including the selection | **60 s, without the selection,** which is Peek's warm time. A forgotten selection must never meet a Delete. |
| Toolbar | Summary, match count, selection with Open in new tabs, Delete and ×, an undo line, and "Opened 3 tabs" | "3 selected · Delete · Cancel" | **One 32 px line** with the summary, the match count, the selection (Delete and ×) or the undo line. Open in new tabs is only in the selection menu, and there is no "Opened 3 tabs" line. |
| Type-to-search; Ctrl+A | Typing in the list searches; Ctrl+A selects all history | Neither | **No type-to-search.** The field already has focus when the panel opens, and keymap rule 15 keeps its short list. **Ctrl+A works only in search results;** deleting all history is Clear browsing data's job. |
| A page visited again while the panel is open | It moves to the top of Today | Its time updates in place | **In place.** Rows never jump under the pointer, and the order is corrected the next time the panel opens. |
| Loading and failure | — | Nothing is drawn for the first 50 ms; "History isn't available right now" | **Engineering.** There is never a false "No history" flash, and a failed read says so, with Try again. |
| Touch | 48 px rows by touch | — | **40 px rows, with 40×40 hit areas.** Press-and-hold opens the row menu. Selecting several rows by touch is not in v1. |

### Opening and closing

**Ways in**
- **Ctrl+H**, anywhere in the window.
  - It is page-first: Docs and Word keep Ctrl+H for Replace. F6 then Ctrl+H, or the + menu, is the route a page can't block.
  - It ignores key repeat, and the AltGr and IME guards apply.
- **History** in the + circle's menu: the first row of the panel group, printed with Ctrl+H.
- **Ctrl+H in the address field.** If the typed text differs from the page's address, it becomes the panel's search. The field closes.
- **In a private window** all three still open the panel, to its one line (see "Private windows").

**Ctrl+H toggles the panel.** It acts differently in these places:
- **Over Settings or Downloads:** that panel steps aside, and History opens. Ctrl+J and Ctrl+, behave the same way towards History.
- **In element full screen:** the page leaves full screen first, as with Ctrl+J.
- **In a popup window:** the panel opens in the most recent normal window of the same privacy, which comes to the front. This is the Settings and Downloads rule.
- **In the held switcher:** Ctrl+H types "h" into the switcher's search (keymap rule 18).
- **With a peek open:** History opens over the peek, because the topmost order is panel, then peek, then tab.

**Ways out**
- **Closing:** Esc (after the panel's own steps, see Keys), Ctrl+W, Ctrl+H, the × button, or a click on the dim.
  - Focus returns to the element that had it before, or to the page.
- **The address field:** Ctrl+L, Ctrl+T, or F6 to the address field closes the panel and leaves focus in the field, as with Settings.

**Focus on open.** Focus starts in the search field. It is empty, or it shows a warm query, selected. Down or Enter moves into the list. In a private window, focus starts on Close.

**Warm state.** If the panel reopens within 60 s, the view, query, scroll position and focused row come back. This is also the way back after a row opened in the current tab. The selection never comes back. After 60 s the panel opens fresh: All history, no query, scrolled to the top.

**Panel switching.** History, Downloads and Settings replace one another, as Settings' hand-off does today.
- The outgoing sheet closes in 140 ms while the incoming one opens.
- The scrim stays at 0.3 and never flashes.

### Anatomy (window coordinates, 1440×900)

| Element | Rectangle | Notes |
|---|---|---|
| Scrim | 0,0 1440×900 | rgba(8,8,12,0.3), over the page and the bar |
| Panel | 240,106 960×688 | Radius 22 and the float lens. Tint rgba(20,20,24,0.62), 1 px 165° rim, shadow 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3). In a window smaller than 992×720, the whole sheet scales down with 16 px margins, so nothing re-flows. |
| Title bar | 240,106 960×48 | History glyph 16 px at x 258; "History" in 14 px Semibold at x 284. Close button 30×30 (radius 15, white 0.08) at 1160,115, tooltip "Close  Esc". Bottom hairline white 0.08. |
| Sidebar | 240,154 216×640 | Padding 16 12 |
| Search field | 252,170 192×34 | Settings' field: radius 8, white 0.07, a 1 px bottom line at white 0.3. Focused: rgba(0,0,0,0.12) with a 2 px #4cc2ff line. 14 px search glyph. Placeholder "Search history" ("Search recently closed" in that view). A 26×26 clear button appears once there is text. |
| Views | 252,216 and 252,252, each 192×34 | "All history" (history glyph) and "Recently closed" (the house undo glyph), with a dim count ("8"). The current view gets a white 0.10 plate and a 3×16 accent bar, as Downloads' filters do. |
| Clear browsing data… | 252,744 192×34; hairline above at y 735 | "Open elsewhere" glyph (the opentab path). Tooltip "Ctrl+Shift+Delete". |
| Sidebar divider | x 456, y 170–778 | 1 px, white 0.08 |
| Content | 457,154 743×640 | Padding 18 20 0, so the inner area is x 477–1180 (703 wide) |
| Toolbar | 477,172 703×32 | Text on the left in 13 px. Downloads' 32 px buttons on the right. |
| List | 477,216 703×578 | Scrolls under the 2 px overlay thumb (`scrollthumb.ts`), with 20 px of padding at its end |
| First day heading | 477,216 703×28 | Followed by a 6 px gap |
| First card | 477,250, 703 wide | Radius 10, white 0.06, with an inset 1 px white 0.06 |
| Rows | 40 px each: 250–290, 290–330, … | Rows 1–13 are fully visible (row 13 ends at 770); row 14 is cut at 794 |
| Between days | 18 px before the next heading | — |

#### Row (card-local x; add 477 for the window x)

| Part | x | Look |
|---|---|---|
| Slot | 12–32 | A 16 px favicon at 14–30 (y 12–28). It becomes the 20×20 checkbox (y 10–30) on hover and in selection mode. |
| Title | 44–359 (315 px) | 13.5 px Segoe UI Variable Text in the full text colour. One line with an end ellipsis, `dir="auto"`. |
| Address | 375–575 (200 px) | 12.5 px at 0.6. The host without `www.`, cut at its start so the domain stays ("…docs.code.vitre.dev"). |
| Time | 591–655, right-aligned | 12.5 px tabular figures at 0.6, in Windows' short time format ("14:32" or "2:32 PM"), as a `<time datetime>`. |
| × | 663–691 (28×28, y 6–34) | Shown on hover and while the row has keyboard focus. Its slot is always reserved, so nothing shifts. Tooltip "Delete from history  Delete". |
| Hairline | From x 44 to 703, at the row's bottom | White 0.07. None under a card's last row. |

**Tooltip** (after 600 ms, tips.ts) has three lines:
- the full title;
- the full address;
- the visit's full date and time ("Thursday, 23 October 2026, 14:32").

**Fallbacks**
- **No favicon:** Deer's 16 px line globe at 0.6, never a letter tile.
- **No title:** the address without its scheme ("fieldnotes.press/archive"), at 0.85.
- **file:** "Local file" in the address column.

#### Row states

| State | Dark | Light |
|---|---|---|
| Rest | — | — |
| Hover | White 0.05 plate, shown at once. The favicon cross-fades to an empty checkbox (120 ms) and the × fades in (120 ms). | Black 0.04 |
| Pressed, or its menu open | White 0.08 | Black 0.06 |
| Selected | White 0.10 plate, checkbox checked | Black 0.06 |
| Keyboard focus (`:focus-visible` only) | Inset 2 px white ring, radius 6, × shown | Black 0.9 ring |
| Opened in the background, or back from a peek | Accent wash rgba(76,194,255,0.14), fading over 900 ms | rgba(0,95,184,0.10) |

The plate fills the row inside the card. The first and last rows clip to the card's 10 px corners.

**Checkbox:** Settings' own control, 20×20 with radius 4.
- **Dark:** unchecked is black 0.12 with an inset 1 px white 0.6; checked is #4cc2ff with a #0b1a24 check.
- **Light:** unchecked is black 0.02 with an inset black 0.45; checked is #005fb8 with a white check.
- **Mixed** (a day heading): the same fill as checked, with an 8×2 bar instead of the check.

#### Day heading (28 px)
- **Labels:**
  - "Today" in 13/20 Semibold at 0.86 at x 479 (card-local 2), then 8 px, then "Thursday, 23 October" in 12 px at 0.55.
  - "Yesterday" works the same way, with "Wednesday, 22 October".
  - Older days show only the date, as the Semibold label: "Tuesday, 21 October".
  - A day in another year adds the year: "Saturday, 14 June 2025".
- **Dates** follow the Windows locale. Days start at local midnight.
- **Delete day** sits at the right end: a 28 px text button (padding 0 10, radius 6, 12.5 px at 0.7, white 0.08 on hover).
  - It fades in over 120 ms on hover of the heading, or while the heading has focus.
  - It is neutral, not red, because red means damage in Deer.
- **In selection mode** a checkbox appears at card-local 12 (aligned with the rows' checkboxes). It is unchecked, mixed or checked. The heading text moves to card-local 44, aligned with the titles. This is the only place anything shifts.
- A heading is not collapsible.

#### Toolbar (32 px)

| State | Left (13 px) | Right (Downloads' 32 px buttons) |
|---|---|---|
| All history at rest | "1,284 pages since 3 March 2026" at 0.7 | — |
| Private window | No toolbar: the panel shows only its one line (see "Private windows") | — |
| Searching | "7 pages match “glass”". After 400 ms without an answer: "Searching…" | — |
| Selection | "3 selected" in the full text colour; "All 214 matches selected" after Ctrl+A | [Delete] (trash glyph) · [×] 32×32, tooltip "Clear selection  Esc" |
| After a delete | A row: "Deleted “Tin bath” from Today." (an older row names its date: "…from Tuesday, 21 October."). A selection: "Deleted 3 pages from 2 days." ("…from Today." when they share a day). A day: "Deleted Yesterday’s history (12 pages)." or "Deleted history from Tuesday, 21 October (4 pages)." The line always names the day, so it never reads as if the page left history everywhere. | [Undo], tooltip "Undo  Ctrl+Z" |
| Recently closed | "6 tabs and 2 windows" | — |
| Empty states | Nothing | — |

Quoted titles are cut at 40 characters plus "…". The text cross-fades (150 ms) when it changes.

### What the list shows
- **Rows per day.** Each page has one row per day it was visited, showing that day's latest visit. The row key is `guid|dayStart`.
- **What counts as a visit.** Places' own rule (`visit_type NOT IN (0,4,7,8,9)`) leaves out invalid, embedded, download, framed-link and reload visits. Pages that were only redirect sources (`hidden = 1`) are also left out.
- **Pages that can't be opened** are not listed. Only http, https and file pages appear.
- **Newest first:** days run from newest to oldest, and so do rows within a day.
- **First open:** Today loads first, then older days until at least 60 rows are on screen. Nothing is drawn for the first 50 ms, so there is never a false "No history" flash.
- **Scrolling:** within 600 px of the end, the next days load (at least 60 rows at a time). A very large day is built 200 rows per frame.
- **Home and End** go to the first and last loaded row. Reaching the end loads more.
- **Live, while the panel is open**:
  - **A new visit** to a page not yet under Today appears at the top of Today, and the view does not move. A visit to a page already under Today updates that row's time in place. While search results are shown, new visits are ignored.
  - **A title change** updates every row of that page in place.
  - **A deletion made elsewhere** (another window's panel, the address field's Shift+Delete, or Clear browsing data) fades out the rows it emptied over 150 ms, without the collapse motion. If the page still has visits (another panel deleted one of its days), only the rows of days left without a visit go.
  - **A bulk change** (50 or more events in one batch, or `history-cleared`) reloads the loaded days. The first visible row stays in place if it still exists.
  - **At midnight,** the headings relabel in place ("Today" becomes "Yesterday"). A new Today group appears with the first visit after midnight.

### Search
- **Where:** the top of the sidebar, as in Downloads and Settings. Ctrl+F focuses it and selects its text.
- **Live:** results update 60 ms after typing pauses, the address field's delay.
  - Nothing runs during IME composition.
  - A newer search wins by serial number, and older answers are dropped. Searches are never interrupted, because `interrupt()` would also stop other searches on the shared database connection.
- **No flash:** the old results stay until the new ones arrive, and rows do not animate on keystrokes.
- **What it matches:** every word, case-insensitive with Unicode folding, anywhere in the title or the whole address (host, path and query). This is Firefox's own matcher, `AUTOCOMPLETE_MATCH`.
- **What it lists:**
  - one row per page, grouped under the day of its last visit, newest first;
  - pages loaded 150 at a time as you scroll;
  - the total in the toolbar.
- **Highlighting:** matched characters are Semibold. In the dim address column they also turn to the full text colour. There is no colour fill, because yellow and orange belong to the page's find.
- **A match only in the path or query:** the address column shows the host and the matching segment, "fieldnotes.press/…/float-glass". The segment is kept whole, and the host is the part that gets cut.
- **Deleting a result** removes the page's visits on the day it is listed under (the day of its last visit), as for any row. If the page has older visits, it is listed again, under its new last day, the next time the search runs; rows never move in place.
- **Switching views:** the query filters the current view and stays when you switch between All history and Recently closed. In Recently closed, matching is done in memory.
- **A private window** has no search field (see "Private windows").
- **Keys in the field:**
  - Esc clears the text first; a second Esc closes the panel.
  - Down or Enter moves to the first result. Enter never opens a page from the field.

### Opening a row (All history and search results)
Rows load with the system principal through `b.navigate` and `b.newTab`, the same path the address field uses.

| Gesture | Result | Panel |
|---|---|---|
| Click, or Enter | Opens in the current tab: the focused side in split view, or the page that replaces Home | Closes; focus goes to the page |
| Ctrl+click, middle-click, or Ctrl+Enter | A new background tab, placed as Settings › Tabs says. The row gets the accent wash, and Narrator says "Opened in a new tab". | Stays |
| Ctrl+Shift+click, or Alt+Enter | A new tab, switched to | Closes |
| Shift+click, Shift+Enter, or Ctrl+Q | A peek (see "Peek from a row"). Shift+click and Shift+Enter follow the Shift+click setting in Settings › Keyboard shortcuts ("Open in new window" opens a window). Ctrl+Q always peeks. | Steps aside, then comes back |
| Double-click, or Alt+click | The same as a click (there is no download gesture here) | — |

- **Pending delete:** opening any page from the panel commits a pending delete first, so the new visit survives the commit.
- **A file: row** has no Peek. Shift+click opens it as a click would, and its menu leaves Peek out.

### Peek from a row
1. History steps aside. The sheet closes in 140 ms, and the scrim moves from 0.3 to Peek's 0.22 over 200 ms. A pending undo is kept, with its timer running.
2. The peek opens from the row's window rectangle: Peek's 400 ms open on the spring.
3. Peek works as usual: hop, Esc (with Esc Esc), a click on the dim, Ctrl+W, and Alt+Left on the first page.
4. **When the peek is put back,** the sheet shrinks into the row's remembered rectangle (280 ms) while History reopens warm with Settings' open motion, and the scrim returns to 0.3. That row gets the accent wash (900 ms) and keyboard focus. History draws the wash, not Peek.
5. **When the peek is opened as a tab** (Alt+Enter, the header button), History does not come back. Ctrl+H within 60 s brings it back warm.

If a peek was already open on the tab, it warm-closes first. Peeking another row replaces it. Peek takes only http(s) addresses.

### Selection
- **With the mouse:** only the checkbox selects.
  - A click on a checkbox toggles that row.
  - Shift+click on a checkbox selects the range from the last row toggled.
  - The row body always keeps its link gestures.
- **With the keyboard:**
  - Space toggles the focused row. On a day heading, it toggles the whole day.
  - Shift+Up/Down and Shift+Home/End extend the selection from the anchor.
  - Ctrl+A selects every match, but only in search results.
  - Plain arrows move focus without changing the selection.
- **Selection is by row,** which is a page on one day. The same page listed under another day is not selected, because a delete removes only the selected row's day. The count is in rows. Open and Copy use each address once.
- **Selection mode** starts with the first selected row and ends when nothing is selected, or when Esc clears it.
  - Every favicon cross-fades to its checkbox (120 ms).
  - Headings get their checkboxes.
  - The toolbar shows the selection.
- **Right-click:**
  - On a selected row, it opens the selection menu.
  - On a row outside the selection, it opens that row's own menu and leaves the selection alone.
- **What clears the selection:** Esc, the toolbar's ×, a delete, or closing the panel. Reopening never restores it.

### Deleting, and undo

| What | How | What it removes |
|---|---|---|
| A row | The × on hover; Delete or Shift+Delete on the focused row; or the row menu | Only that page's visits on that row's day, from local midnight to the next (`removeVisitsByFilter` with the page's address and the day's range), as Chrome does. Its rows under other days stay, and so does the page in the address field's suggestions. A page whose only visits were on that day leaves history. |
| A selection | Delete, the toolbar's Delete, or the selection menu | Each selected row's visits on that row's own day, as for a row |
| A day | The heading's Delete day; Delete on a focused heading; or the heading menu | Visits from local midnight to the next midnight (`removeVisitsByFilter`). A page visited only that day leaves history; a page visited on other days stays under them. |
| A Recently closed entry | × or Delete | That entry, at once, with no undo (SessionStore can't put it back). The row collapses, and Narrator says "Removed from Recently closed". |

- **What Delete acts on.** While anything is selected, Delete acts on the selection wherever focus is in the list. The toolbar shows "3 selected", so the target is always clear.
- **Undo.**
  - There is one level of undo. The line stays for 10 s and pauses while the pointer or keyboard focus is on it. With assistive technology running, it stays until the next action.
  - Undo and Ctrl+Z bring the rows back, and focus goes to the first restored row. Ctrl+Z is a local key in the list and the sidebar. It is not active in the search field, where Ctrl+Z edits text.
  - Undo is exact because Places has not changed yet: the rows come back from memory with their times, and no visit is written back.
  - A new delete commits the pending one and takes over the line.
- **Deferred commit.**
  - Rows leave the screen at once, but Places changes only when the commit runs.
  - **The commit runs** on any of these: the line goes away; another delete; the panel closes (any route, except the Peek hand-off); its window closes; Deer quits (Places' shutdown blocker); a page is opened from the panel; or Clear browsing data runs in any window.
  - **Until then,** the panel leaves the deleted rows out. This window's address field leaves out only the pages the delete would remove from history entirely (no visit on any other day); a page with other visits stays suggested. Other windows may show the rows for up to 10 s.
  - **During a pending delete,** search also leaves out a page whose listed row is pending: a deleted result, or a page whose last visit falls on a deleted day.
  - **A visit made after the delete is never removed by it.** For Today, the range ends at the moment of the delete. If the page is visited again while its Today row is pending, a fresh row appears at the top of Today.
  - **If Deer crashes before the commit,** the pages stay in history. The owner accepted this (2026-10-23).
- **Bookmarks.** A bookmarked page keeps its bookmark. That day's visits go, and the row leaves the list.

### Recently closed
- **Where:** the second view in the sidebar, with a dim count (tabs plus windows).
- **Two cards**, each under a 28 px heading, using the same 40 px row anatomy with no checkbox.
  - **"Tabs":** newest first, from every open normal window. Firefox keeps up to 25 per window. Private tabs are never listed, and a private window's panel lists none (see "Private windows").
  - **"Windows":** up to 5.
- **A tab row:**
  - favicon, title and host;
  - when it was closed: "14:36" today, "Yesterday", or "21 Oct" for anything older.
- **A window row:**
  - the window glyph and its selected tab's title;
  - "Window · 4 tabs" in the address column;
  - a tooltip listing up to 10 tab titles.
- **Leaving out:**
  - Home and blank tabs;
  - Deer's hidden tabs (peeks and resolver pages);
  - tabs inside a closed window, which come back with that window.
- **A side of a split pair** comes back as an ordinary tab, as in the split spec.

**Restoring**
- **Click or Enter** reopens the tab with its back history, scroll position and form text. It opens in this window, where Ctrl+Shift+T would put it (its old position, clamped), and switches to it. The panel closes.
- **A window row** reopens the whole window, which comes to the front.
- **Ctrl+click, middle-click or Ctrl+Enter** reopens the tab in the background; the panel stays open.
- **Opening the same page from All history** loads it fresh instead.
- **Ctrl+Shift+T** still works under the panel. The entry it reopens collapses out of the list.

**Search** placeholder: "Search recently closed".

### Empty and other states
All of these are centred in the list area, starting 56 px from its top, with no illustration. The toolbar is empty.
- **No history yet:** "Pages you visit will show up here." (13 px at 0.55).
- **Nothing found:**
  - "No pages match “obsidian”." (13 px at 0.86);
  - "Search looks in page titles and addresses." (12.5 px at 0.55);
  - a [Clear search] button.
- **Recently closed, empty:** "Tabs and windows you close show up here."
- **History unavailable** (Places can't be read, for example at startup or shutdown):
  - "History isn't available right now." (13 px at 0.86);
  - a [Try again] button.
- **Private window:** "History isn’t shown in private windows." (13 px at 0.55), and nothing else. It is centred across the whole sheet, because there is no sidebar (see "Private windows").
- **After everything is deleted:** the "No history yet" state shows once the collapse ends.

### Private windows
The owner decided (2026-10-23) that a private window's History panel shows no history at all.
- **What it shows:** the title bar (History and ×) and one plain line, "History isn’t shown in private windows.", in 13 px at 0.55, centred across the sheet at the other empty states' height (sheet y 166, window y 272), with no illustration.
  - There is no sidebar, search field, views, Clear browsing data…, toolbar or list.
  - So there are no days, no search results and nothing to select, delete or undo.
- **Recently closed shows nothing either,** not even this private window's own closed tabs. Ctrl+Shift+T and the + menu's Reopen closed tab still bring them back, as they do now.
- **Ways in still work:** Ctrl+H, and History in the + menu, open the panel to its line. Ctrl+H in the address field opens it too, but the typed text is not carried, because there is no search. The field closes, as it does in a normal window.
- **Keys:** focus starts on Close, and Tab stays there. Esc, Ctrl+W, Ctrl+H, the × and a click on the dim close the panel. Ctrl+F, the list keys, Delete and Ctrl+Z do nothing.
- **No warm state.** Each open is the same.
- **Unchanged:** the panel hand-off with Settings and Downloads, the motion, the scrim, and the rule for popup windows (a private popup opens the panel in a private window, so it shows the line). Normal windows never list private tabs or windows. The address field's suggestions in a private window are outside this spec and stay as they are.
- **Screen readers:** the dialog "History" is described by its line, so Narrator reads both when it opens.

### Clear browsing data
"Clear browsing data…" is the sidebar's last row. It opens a Deer surface, so its label ends in "…".
- History steps aside (the panel hand-off), and Settings opens at Privacy and security › Clear browsing data, as Ctrl+Shift+Delete does.
- A pending delete is committed first.
- When Settings closes, History does not come back by itself. Ctrl+H within 60 s brings it back warm.

### Menus
House rules (MenuSpec): height = 12 + 34 × rows + 9 × separators. Menus follow Appearance and sit at z 50, above panels. A row keeps its pressed look while its menu is open. A keyboard-opened menu hangs 4 px below the focused row.

- **+ circle** (`plushistory`, 296×259; 296×302 with Restart to update):
  - New window  Ctrl+N [W] · New private window  Ctrl+Shift+N [P] · Reopen closed tab  Ctrl+Shift+T [R]
  - **History  Ctrl+H [H]** (history glyph) · Show downloads  Ctrl+J [S] · Full screen  F11 (check) [F] · Settings  Ctrl+, [E]
  - (Restart to update [U])

  "History" is a noun, like "Settings": both rows open a panel. The canvas `plus` kind stays as approved; the new kind sits beside it. The History row is the same in a private window, where it opens the panel to its one line.
- **History row** (`historyrow`, 264×234):
  - Open in new tab [T] · Peek  Shift+click [P] · Open in new window [W] · Open in new private window [R]
  - Copy address [A]
  - Delete from history  Delete [D] (× glyph)

  A file: row leaves Peek out. There is no private-window variant, because a private window's panel has no rows. "Delete" is the panel's verb for rows, days and selections, which matches its Delete key; on a row it removes that day's visits only. The address field's approved "Remove from history  Shift+Delete" keeps its label and still removes the whole page, because a suggestion has no day.
- **Selection** (`historysel`, 328×166):
  - Open 3 pages in new tabs [T] · Open 3 pages in a new window [W]
  - Copy 3 addresses [A]
  - Delete 3 pages from history  Delete [D]

  Above 15 pages (Firefox's warn-on-open threshold), the two Open rows grey out with a dim "15 at most" in the accelerator column, the same pattern as "Protected". The Open and Copy rows count each address once, so a page selected under two days opens once. Delete counts rows, each deleted from its own day.
- **Day heading** (`historyday`, 312×80):
  - Select this day [S] · Delete this day’s history  Delete [D]
- **Closed tab** (`closedtab`, 264×123):
  - Reopen tab [R] · Copy address [A]
  - Remove from list  Delete [L]

  Ctrl+Shift+T is printed only on the entry that would come back next.
- **Closed window** (`closedwindow`, 264×89):
  - Reopen window [R]
  - Remove from list  Delete [L]

### Keys

**Anywhere in the window**

| Keys | Action | Priority |
|---|---|---|
| Ctrl+H | Opens or closes History. From the address field, it carries the typed text (not in a private window, which has no search). Ignores key repeat. | Page-first (Docs and Word keep Replace). F6 then Ctrl+H, or the + menu, is the route a page can't block. |
| Ctrl+Shift+H | Not bound; left to pages. Firefox's Library stays hidden. | — |

**In the panel (local keys)**

| Keys | Action |
|---|---|
| Up / Down | Move by row; day headings are stops |
| Home / End | First / last loaded row (reaching the end loads more) |
| Page Up / Page Down | One screen (13 rows) |
| Ctrl+Up / Ctrl+Down | Previous / next day heading |
| Enter · Alt+Enter · Ctrl+Enter · Shift+Enter or Ctrl+Q | Open here · new tab, switched to · background tab · peek |
| Space | Toggle the selection (a whole day on a heading) |
| Shift+Up/Down, Shift+Home/End | Extend the selection |
| Ctrl+A | Select every match (search results only) |
| Delete, Shift+Delete | Delete the selection, or else the focused row (that day's visits only); on a heading, the day. In Recently closed: remove the entry. |
| Ctrl+Z | Undo the last delete while its line shows (in the list and sidebar, not in the search field) |
| Ctrl+C | Copy the focused row's address, or the selection's addresses, one per line and each once |
| Shift+F10, Menu key | The row's or heading's menu, 4 px below it |
| Ctrl+F | Focus search and select its text (`vitre:panel-find`) |
| Tab / Shift+Tab | Search → views → Clear browsing data… → toolbar buttons → list (one stop, with roving focus) → Close. Focus stays inside the panel. |
| Esc | One step per keydown: close a menu → clear the selection → clear the search text (in the field) → close the panel |
| Ctrl+W | Closes the panel, never the tab |

- **Window keys still work under the panel.** Tab and window keys act on the window: Ctrl+Tab, Ctrl+1–9 and Ctrl+Shift+T switch tabs or reopen underneath, and the panel keeps focus (it reclaims it on `tab-activated`).
- **Page keys do nothing** while the panel is open, through the existing `panel-open` rule.
- **In a private window** the panel has only Close: Esc, Ctrl+W and Ctrl+H close it, Tab stays on Close, and the other local keys do nothing.

### With the rest of Deer
- **Address field.**
  - It is unchanged: clicking it, or Ctrl+L, still lists recent visits, and Shift+Delete still removes a whole page (every day).
  - The field sits under the panel (z 20 < 30): when it takes focus, History closes.
  - A page deleted from one day in the panel stays in the field's suggestions while it has visits on other days.
  - During a pending delete, the field leaves out the pages the delete would remove from history entirely, until the commit has finished.
- **+ menu:** one new row, History, at the top of the panel group. The menu grows to 7 rows: 296×259. In a private window the row is the same and opens the panel to its one line.
- **Settings and Downloads:** one panel at a time, with the hand-off. Settings › Keyboard shortcuts lists Ctrl+H under the panels, as "Open or close History".
- **Peek:** History steps aside and comes back (see "Peek from a row"). A History panel opened over a peek follows the existing order: panel, then peek, then tab.
- **Split view:**
  - "Open here" loads into the focused side.
  - A peek dims both panes.
  - New tabs open after the pair.
- **Home:** "open here" replaces Home with the page.
- **Popup windows:** the panel opens in the most recent normal window of the same privacy (`elsewhere()`).
- **Element full screen:** it is left before the panel shows.
- **Switcher:** it draws above History (z 40). Ctrl+H inside it types "h".
- **Other windows:** each window has its own panel. Deletes show up in other windows' panels live, after the commit.
- **Private windows:** the panel shows only its one line (see "Private windows").

### Motion
One spring, `cubic-bezier(0.22, 1, 0.36, 1)`, plus the expand curve `cubic-bezier(0.2, 0, 0, 1)`.

| Moment | Motion |
|---|---|
| Open | As Settings: the scrim fades from 0 to 0.3 over 200 ms; the sheet scales from 0.96 to 1 over 280 ms on the spring; the tint, rim and body fade in over 160 ms on the expand curve. The lens shows at once. |
| Close | The sheet scales from 1 to 0.985 and fades over 140 ms. The lens goes first. |
| Panel hand-off | The scrim holds at 0.3; the outgoing sheet closes (140 ms) while the incoming one opens |
| + menu → History | The menu fades out over 100 ms with its row lit, then the panel opens |
| Row hover | The plate appears at once; the favicon cross-fades to the checkbox (120 ms); the × fades in (120 ms) |
| Selection mode on / off | Every slot cross-fades over 120 ms. Heading checkboxes fade in while their text slides to the title column (240 ms, spring). The toolbar text cross-fades over 150 ms. |
| Delete a row or a selection | Content fades over 100 ms, then the height collapses from 40 to 0 over 240 ms on the spring while the rows below slide up. The card's edge follows. A day left empty collapses with its heading. With more than 40 rows on screen, the list cross-fades over 150 ms instead. |
| Delete a day | The group fades over 160 ms and collapses over 280 ms on the spring |
| Undo | The reverse: the height expands over 240 ms on the spring, and the content fades in over 160 ms, starting at 80 ms |
| Toolbar line | Text cross-fades over 150 ms |
| Background open | Accent wash on the row, fading over 900 ms. The new circle arrives in the bar under the dim, as usual. |
| Peek hand-off | History closes (140 ms) while the sheet grows from the row (400 ms, spring). The scrim goes from 0.3 to 0.22 over 200 ms. On close, the sheet shrinks into the row (280 ms) while History opens (280 ms). Then the wash fades over 900 ms. |
| Ctrl+Up/Down, Home, End | Instant, never smoothed |
| Reduced motion | Every moment becomes a 150 ms cross-fade, with no scale, collapse, slide or wash travel. Deleted rows vanish over 150 ms, and the rest close the gap at once. |

### Light and dark
The panel follows Settings › Appearance › Mode, as Settings and Downloads do, and so do its menus. The page under the panel never changes. History uses Settings' own tokens (`--vs-*`).

| Token | Dark | Light |
|---|---|---|
| Tint | rgba(20,20,24,0.62) | rgba(243,243,246,0.80) |
| Rim | White 0.5 / 0.1 / 0.04 / 0.2 | White 0.95 / 0.4 / 0.25 / 0.7 |
| Shadow | 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3) | 0 40px 100px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.16) |
| Text / dim / heading | #fff / 0.6 / 0.86 | Black 0.9 / 0.6 / 0.86 |
| Card / hairline / line | White 0.06 with an inset 0.06 / white 0.07 / white 0.08 | White 0.62 with an inset black 0.06 / black 0.07 / black 0.08 |
| Hover / pressed / selected | White 0.05 / 0.08 / 0.10 | Black 0.04 / 0.06 / 0.06 |
| Accent (bar, checkbox, field line) | #4cc2ff | #005fb8 |
| Focus ring | White, 2 px, inset | Black 0.9 |
| Wash | rgba(76,194,255,0.14) | rgba(0,95,184,0.10) |

### Accessibility
**Roles and names**
- **Panel:** `dialog`, `aria-modal`, named "History". In a private window it is described by its one line (`aria-describedby`), and Close is its only control.
- **Search field:** `searchbox` "Search history", described as "Searches page titles and addresses".
- **Views:** a `nav` named "History views", with the buttons "All history" and "Recently closed, 8" (`aria-current="page"`).
- **Clear browsing data:** a button named "Clear browsing data, opens Settings".

**The list** is a `grid` with `aria-multiselectable="true"`, named "All history", "Search results for glass" or "Recently closed".
- `aria-rowcount` is −1 until the end has loaded, and drawn rows carry `aria-rowindex`.
- Each day is a `rowgroup`.
- **A heading** is a `row` containing:
  - a `rowheader`, "Today, Thursday 23 October 2026, 14 pages";
  - a cell with the button "Delete day, Today" ("Delete day, Tuesday, 21 October" for an older day). The name starts with the visible label, "Delete day".
- **A page row** is a `row` with `aria-selected`, named "Float glass, refract.wiki, 14:27".
  - Its × is named "Delete from history, Float glass, Today": its tooltip's words, then the row and its day, so the name never suggests the page leaves every day.
  - The checkbox is `aria-hidden`: `aria-selected` carries the state, and Space changes it.

**Announcements** (polite, debounced 500 ms):
- "7 pages found" or "No pages found";
- "3 selected";
- the toolbar's line after a delete, then "Undo with Control+Z." ("Deleted 3 pages from 2 days. Undo with Control+Z."), and "Restored 3 pages";
- "Opened in a new tab";
- "Reopened Tideline";
- "Removed from Recently closed".

**Contrast:** the Settings and Downloads tokens, which are already reviewed.

**Forced colours:**
- Selected rows: Highlight with HighlightText.
- Focus: a 2 px Highlight outline.
- Cards: a 1 px CanvasText outline.
- Checkboxes and buttons: system colours, with no frost or shadow.

**Transparency effects off:** the solid Settings sheet.

**Touch:**
- 40 px rows, with 40×40 hit areas for the checkbox and the ×.
- Press-and-hold opens the row menu.
- Menu rows are 40 px.

### Edge cases
- **Very long histories:** a day loads in its own query. A huge day is built in chunks, and the scroll thumb grows as days load.
- **A day with only uncounted visits** (downloads, reloads) is skipped.
- **Daylight-saving days** last 23 or 25 hours. Day boundaries are `new Date(y, m, d)` in local time, never steps of 86 400 000 ms. A time-zone change takes effect on the next open.
- **The page is already open in another tab:** a click still opens it here. Switching to that tab stays the address field's job.
- **A peek already open on the tab:** "open here" warm-closes it first.
- **Clear browsing data in another window** while the panel is open: the bulk path runs. `history-cleared` resets the list to "No history yet".
- **A pending delete, then Clear browsing data:** the delete commits first.
- **A crash during a pending delete:** the pages stay. The owner accepted this.
- **The same page on several days:** deleting one of its rows leaves its other days' rows, and the address field still suggests it.
- **A page visited again during a pending delete:** the new visit is not removed (the range ends at the moment of the delete), and the page shows under Today again.
- **A private window:** the panel shows only "History isn’t shown in private windows." (see "Private windows").
- **History turned off** (Firefox's `places.history.enabled`, which Deer doesn't offer): the panel shows what Places still holds, and nothing new appears.
- **Right-to-left titles:** `dir="auto"` on the title and the tooltip.
- **A window smaller than 992×720:** the sheet scales as a whole.

### Not in v1, and rejected
**Not in v1:**
- history from other devices;
- a Sites view;
- a calendar, a date picker, or a jump-to-day list;
- "Delete all from fieldnotes.press";
- "Show all history" in the address field;
- type-to-search in the list;
- selecting several rows by touch;
- page thumbnails and visit counts;
- sessions or "journeys", and AI summaries;
- sort options;
- export;
- search operators (`site:`, date ranges);
- a history-retention setting;
- restoring one tab from a closed window;
- Peek on Recently closed rows;
- a History row in Settings › Privacy.

**Rejected:**
- letter-tile favicons;
- sticky frosted day headings;
- a timeline scrubber;
- coloured match fills;
- confirmation dialogs and toasts;
- a "Clear all history" button in the panel (Settings' job);
- Ctrl+click as selection;
- a peek drawn above the panel;
- Firefox's history sidebar and Library window;
- `PlacesQuery` as the engine: it loads a 60-day window in one query (151–323 ms) and refetches everything on any delete;
- `nsINavHistory` date queries, which run synchronous SQL on the main thread and group older history by month.

### Build notes (Gecko 157, for later)
- **Module `src/window/modules/history/`**, picked up by `tools/build.mjs`. It installs after `find` and before `menus`. Its files:
  - `index.ts`: install, the service and the actions;
  - `panel.ts`: DOM, keys and focus;
  - `store.ts`: day pages, search, observers and the deferred commit;
  - `closed.ts`: SessionStore;
  - `gecko.ts`: every Firefox internal, behind one function each, with its source path (the Settings rule);
  - `css.ts`: Settings' `--vs-*` tokens.

  All text is set with `textContent`; history titles never go through a parser.
- **Service `history`:** `{ open(opts?: { query?: string; view?: 'all' | 'closed' }), toggle(), close(), isOpen() }`, declared in `VitreServices`. Tests get `window.vitreHistory`.
  - `b.registerAction('history', () => toggle())` replaces the core's `editAddress('')`, which stays as the fallback for a build without the module.
- **Reading Places** uses the read-only `promiseDBConnection()` for day pages and `promiseLargeCacheDBConnection()` for search, as `places.ts` does.
  - **Day page** (2–42 ms):
    ```sql
    SELECT h.guid, h.url, h.title, MAX(v.visit_date) AS last
    FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
    WHERE v.visit_date >= :dayStart AND v.visit_date < :nextDayStart
      AND v.visit_type NOT IN (0,4,7,8,9) AND h.hidden = 0
      AND substr(h.url, 1, 6) IN ('http:/', 'https:', 'file:/')
    GROUP BY v.place_id ORDER BY last DESC
    ```
  - **Next older day:** `SELECT MAX(visit_date) FROM moz_historyvisits WHERE visit_date < :dayStart`. Places stores times in µs, and days are computed in local JS time.
  - **Search** (keyset, 150 rows a page). The `+` signs force a scan and sort, so a rare word can't walk the index:
    ```sql
    SELECT h.guid, h.url, h.title, h.last_visit_date AS last
    FROM moz_places h
    WHERE h.hidden = 0 AND +h.last_visit_date < :cursor AND <scheme filter>
      AND AUTOCOMPLETE_MATCH(:q, h.url, h.title, NULL, 1, 1, 1, 1, :MATCH_ANYWHERE_UNMODIFIED, :BEHAVIOR_HISTORY, NULL)
    ORDER BY +h.last_visit_date DESC LIMIT 150
    ```
    A `COUNT(*)` with the same filter runs after the first page. If the function's signature changes, `places.ts`'s multi-word `LIKE` is the fallback (ASCII case only).
  - **Summary:** a `COUNT(*)` of visited pages and `MIN(visit_date)`, both once per open and both async.
- **Deleting** uses only `PlacesUtils.history.removeVisitsByFilter` (Firefox 157 `History.sys.mjs`); the panel never calls `history.remove`, which takes a page from every day.
  - **A row:** `removeVisitsByFilter({ url, beginDate: new Date(dayStart), endDate: new Date(Math.min(nextDayStart - 1, deletedAt)) })`, where `url` is the row's `h.url` and `deletedAt` is the moment of the delete (it only matters for Today). Places matches the address on `url_hash` and `url`, and both dates are inclusive.
  - **A selection:** one such call per row, run one after another in the commit.
  - **A day:** `removeVisitsByFilter({ beginDate: new Date(dayStart), endDate: new Date(Math.min(nextDayStart - 1, deletedAt)) })`.
  - **What Places does then** (one `page-removed` per page): a page left with no visits and no bookmark is removed, with `isRemovedFromStore`. A bookmarked page left with no visits stays, with neither flag set. A page with visits left stays, with `isPartialVisistsRemoval`.
  - **The pending delete** is held in the store as a list of `{ guid, url, dayStart, endDate }` ranges, and the rows are hidden by their `guid|dayStart` key.
  - **Undo** drops the pending list and shows the rows again from memory. Places has not changed, so nothing is re-inserted: `insertMany` could not restore visit ids, referrers or frecency exactly, and it would send `page-visited` to every window.
  - **`places.ts`** gets a `pendingRemoval` filter for this window: the pages the pending delete would leave with no visits. One query at delete time finds them (no visit of that page outside its pending ranges).
  - The commit runs on every path listed under "Deleting, and undo". `settings/gecko.ts sanitize` asks History to commit first.
- **Live updates:** `PlacesObservers.addListener(['page-visited', 'page-removed', 'page-title-changed', 'history-cleared'])`, only while the panel is open or stepped aside for a peek.
  - Remove the listener on hide and in `b.onDestroy`.
  - Read both spellings of `isPartialVisistsRemoval` (misspelled in 157).
  - A `page-removed` without `isRemovedFromStore` re-reads that page's counted visits over the loaded days (one query on `url_hash`) and fades out only the rows of days left without one.
  - Bulk threshold: 50 events in one batch, debounced 500 ms.
- **Favicons:** `page-icon:<url>`. For closed tabs, use the icon of the entry's own URL, never `tabData.image`.
- **Private windows:** when `b.isPrivate`, `panel.ts` builds only the title bar and the line, and `store.ts` and `closed.ts` are never started. The panel opens no Places connection, reads nothing from SessionStore and adds no observers.
- **SessionStore** (normal windows only):
  - Read with `getClosedTabData({ sourceWindow: window, closedTabsFromClosedWindows: false })` and `getClosedWindowData()`.
  - Restore with `undoCloseById(closedId, b.isPrivate, window)`; forget with `forgetClosedTabById` and `forgetClosedWindowById`.
  - Re-read on `sessionstore-closed-objects-changed`.
  - Filter out Home and blank tabs, and `extData['vitre-hidden']`.
- **Panel plumbing**, the pattern of Settings and Downloads:
  - Layer `b.layer('history-panel', 30)` with the float lens.
  - `panel-open` and `history-open` on `b.root`.
  - `addEscLayer(60)` and `addCloseLayer(60)` while open; `vitre:panel-find`.
  - `elsewhere()` for popup windows; leave element full screen first.
  - Focus trap, focus reclaimed on `tab-activated`, `returnFocus`, `scrollThumb()`, and tips.ts tooltips.
  - **One panel at a time:** `show()` closes Settings (through its service) and Downloads (`b.run('downloads')` when `downloads-open` is set) before adding its classes. A MutationObserver on `b.root` makes History step aside when `settings-open` or `downloads-open` appears, without moving focus.
  - **Debt:** a fourth panel should bring a core slot (`b.claimPanel`) instead of more observers.
- **Peek hand-off:** `peek.open(url, { origin: rowRect })`. History then listens to `vitre:peek` and reopens on `closed`, never after `promoting`. Peek's own link wash is suppressed for this origin.
- **Menus:**
  - `chrome-items.ts plusRows()`: `item('History', 'history', 'Ctrl+H', 'H', () => historyService(b)?.open())` after the first separator, before Show downloads.
  - `menus/icons.ts`: a `history` glyph, a clock with a back arrow, so it doesn't read as Downloads' "Queued" clock.
  - `menus/services.ts`: `historyService`.
  - Row menus use `menus.show(items, at)`.
- **Keys:** Ctrl+H stays page-first in `keys.ts`, with the key-repeat guard. The local keys live in `panel.ts`.
- **Tests (new `tests/history/`):**
  - seed 100k visits with `history.insertMany`;
  - Ctrl+H to the first rows in under 100 ms;
  - day labels across midnight and a daylight-saving date;
  - a row's delete removes only that day's visits: the page stays under its other days and in the address field, and leaves both only when that day held all its visits;
  - a selection across days removes each row's day only; a deleted day leaves other days intact;
  - a visit made while a Today delete is pending survives the commit;
  - Undo makes no Places change; the commit runs on timeout, close, a new delete, opening a page and Clear browsing data;
  - a live insert from another window, and a partial removal from another window's panel;
  - restoring and forgetting closed tabs and windows;
  - every opening order of Settings, Downloads and History, with focus checked;
  - the Peek hand-off (returns after Esc, not after Open as tab);
  - popup windows;
  - a private window: only the line, from Ctrl+H, the + row and Ctrl+H in the address field, with no Places or SessionStore read;
  - `tests/input/omnibox.js` §6 now expects the panel, and the recent list stays covered by a click on the field.
- **Spikes:**
  - **H1:** Places cost in the real runtime, with `AUTOCOMPLETE_MATCH`, at 60k places / 500k visits and at 250k / 1M. Day page, search page, count and summary. Targets: first rows under 100 ms after Ctrl+H, a search page under 60 ms.
  - **H2:** the deferred commit on every exit path (including quit, through Places' shutdown blocker), the masks in the panel and the address field, and what a crash leaves. Also the per-row `removeVisitsByFilter` with `url`: its cost for a 1,000-row selection, and its last millisecond (it compares `visit_date <= :end * 1000`, while Places stores µs, so a visit in the final millisecond before midnight must still go).
  - **H3:** the Peek hand-off. The scrim moves 0.3 → 0.22 → 0.3 without a flash; focus and the wash land on the row; Esc Esc and Alt+Left still close the peek.
  - **H4:** the growing grid (`aria-rowcount` −1, rowgroups, `content-visibility` blocks) in Narrator and NVDA, in focus and browse modes.
  - **H5:** SessionStore read, restore and forget by id across normal windows; peeks, resolver pages and private tabs never listed.
- **Cost:** about 2–3 weeks after the spikes.
  - Phase 1: the panel, day list, search, opening, selection, deletes with undo, live updates, the + row, Ctrl+H and the keys.
  - Phase 2: Recently closed and the Peek hand-off.

### On approval
- **DESIGN-NOTES:**
  - a "History" section (this spec in short);
  - a "History" row in "Canvas pages" (version to follow);
  - an item in "Still to design";
  - the + circle item list, with History added.
- **keymap.json:**
  - **Ctrl+H** moves from "Address and search" to "Panels and app": "Open or close the History panel; from the address field, what you typed becomes its search". Its scope is anywhere in the window, and it stays page-first. Its note: "Docs and Word keep Ctrl+H for Replace; F6 then Ctrl+H, or History in the + menu, is the route a page can't block."
  - **Rule 10:** add Ctrl+H to the key-repeat list.
  - **Rule 11:** the panel rung reads "the Settings, Downloads or History panel (History clears its selection, then its search text, first)".
  - **Panels and app:** "Esc", "Ctrl+W" and "Ctrl+F" read "Settings, Downloads or History", and Ctrl+F adds "Search history".
  - **A new local group, "History panel",** holds the keys above. Ctrl+Z gets a note there: the one exception to "never a Vitre accelerator", in the list only.
  - **Different from Chrome:** "Ctrl+H (a panel, not a page)".
- **settings/keymap.ts:**
  - line 74 moves to the panels group as "Open or close History";
  - line 190 becomes "Ctrl+H opens a panel, not a page".
- **Later canvas updates** (each page stays as approved until then):
  - KeyMap, KeyRouting and SettingsKeys;
  - MenuChrome and MenuReference (+ menu).

### History artboards (to draw)
**New boards on page "History":**
- HistoryOpen, at 0,0
- HistoryMotion (interactive), at 1520,0
- HistoryMenus, at 0,1100
- HistoryStates, at 1520,1100
- HistorySpec, at 0,2120

**New part:** HistoryPanel.

**Part updates:** CtxMenu gains six kinds (`plushistory`, `historyrow`, `historysel`, `historyday`, `closedtab`, `closedwindow`) and a `history` glyph. No existing kind changes.
