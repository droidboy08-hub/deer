// Styles of the History panel: the HistoryPanel part on the design canvas (../design/HISTORY-SPEC.md
// "Anatomy", "Row states", "Light and dark", "Motion", "Accessibility"). The sheet is Settings' and
// Downloads': the 960x688 frost, its lens, the 48 px title bar and the 216 px sidebar; the tokens are
// Settings' own (--vs-*: settings/styles.ts), declared here again on the panel's root so a build
// without the Settings module draws the same.
// Gecko notes (as Settings): every rule starts with #vitre-root (the core's button reset would win
// over a bare class); nothing between #vitre-root and the lens fades (the sheet scales, its tint, rim
// and body fade, the lens shows at once and goes first); the panel follows Settings › Appearance ›
// Mode through prefers-color-scheme (the Mode setting switches Firefox's theme, which decides the
// chrome document's colour scheme).

const DARK = `
  --vs-text: #ffffff;
  --vs-text2: rgba(255,255,255,0.6);
  --vs-text3: rgba(255,255,255,0.55);
  --vs-nav: rgba(255,255,255,0.88);
  --vs-h2: rgba(255,255,255,0.86);
  --vs-value: rgba(255,255,255,0.7);
  --vs-card: rgba(255,255,255,0.06);
  --vs-card-line: rgba(255,255,255,0.06);
  --vs-sep: rgba(255,255,255,0.07);
  --vs-line: rgba(255,255,255,0.08);
  --vs-ctl: rgba(255,255,255,0.08);
  --vs-ctl-hover: rgba(255,255,255,0.12);
  --vs-ctl-press: rgba(255,255,255,0.05);
  --vs-ctl-line: rgba(255,255,255,0.08);
  --vs-hover: rgba(255,255,255,0.05);
  --vs-pressed: rgba(255,255,255,0.08);
  --vs-active: rgba(255,255,255,0.1);
  --vs-search-bg: rgba(255,255,255,0.07);
  --vs-search-focus: rgba(0,0,0,0.12);
  --vs-search-line: rgba(255,255,255,0.3);
  --vs-accent: #4cc2ff;
  --vs-on-accent: #0b1a24;
  --vs-check-line: rgba(255,255,255,0.6);
  --vs-check-bg: rgba(0,0,0,0.12);
  --vs-focus: #ffffff;
  --vs-wash: rgba(76,194,255,0.14);
  --vs-del-hover: rgba(255,255,255,0.08);
  --vs-del-hover-line: transparent;
  --vt-thumb: rgba(255,255,255,0.4);
  --vs-tint: rgba(20,20,24,0.62);
  --vs-rim: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2));
  --vs-shadow: 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
`;

const LIGHT = `
  --vs-text: rgba(0,0,0,0.9);
  --vs-text2: rgba(0,0,0,0.6);
  --vs-text3: rgba(0,0,0,0.55);
  --vs-nav: rgba(0,0,0,0.86);
  --vs-h2: rgba(0,0,0,0.86);
  --vs-value: rgba(0,0,0,0.62);
  --vs-card: rgba(255,255,255,0.62);
  --vs-card-line: rgba(0,0,0,0.06);
  --vs-sep: rgba(0,0,0,0.07);
  --vs-line: rgba(0,0,0,0.08);
  --vs-ctl: rgba(255,255,255,0.72);
  --vs-ctl-hover: rgba(249,249,249,0.55);
  --vs-ctl-press: rgba(249,249,249,0.32);
  --vs-ctl-line: rgba(0,0,0,0.09);
  --vs-hover: rgba(0,0,0,0.04);
  --vs-pressed: rgba(0,0,0,0.06);
  --vs-active: rgba(0,0,0,0.06);
  --vs-search-bg: rgba(255,255,255,0.7);
  --vs-search-focus: #ffffff;
  --vs-search-line: rgba(0,0,0,0.45);
  --vs-accent: #005fb8;
  --vs-on-accent: #ffffff;
  --vs-check-line: rgba(0,0,0,0.45);
  --vs-check-bg: rgba(0,0,0,0.02);
  --vs-focus: rgba(0,0,0,0.9);
  --vs-wash: rgba(0,95,184,0.10);
  --vs-del-hover: rgba(255,255,255,0.72);
  --vs-del-hover-line: rgba(0,0,0,0.09);
  --vt-thumb: rgba(0,0,0,0.4);
  --vs-tint: rgba(243,243,246,0.8);
  --vs-rim: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.4) 30%, rgba(255,255,255,0.25) 60%, rgba(255,255,255,0.7));
  --vs-shadow: 0 40px 100px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.16);
`;

const RIM_MASK = 'mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;';
const R = '#vitre-root';

export const CSS = `
${R} .vh-root { position: absolute; inset: 0; font-family: var(--font); font-size: 13.5px; color: var(--vs-text); ${DARK} }
@media (prefers-color-scheme: light) { ${R} .vh-root { ${LIGHT} } }
/* The panel's own button reset, weightless (:where) so each button's class sets its size and colour
   (Delete day 12.5 px at --vs-value, the row's x at --vs-text2, toolbar buttons 13 px, the views at
   --vs-nav), as Downloads does: #vitre-root .vh-root button would outrank #vitre-root .vh-hdel. */
${R} .vh-root :where(button) { color: inherit; font: inherit; }
${R} .vh-root :focus:not(:focus-visible) { outline: none; }
${R} .vh-root :is(button, input):focus-visible { outline: 2px solid var(--vs-focus); outline-offset: 1px; }

/* Scrim, sheet and material (spec "Motion": Open, Close; as Settings) */
${R} .vh-scrim { position: absolute; inset: 0; background: rgba(8,8,12,0.3); opacity: 0; transition: opacity 200ms ease; }
${R} .vh-root.open .vh-scrim { opacity: 1; }
${R} .vh-sheet {
  position: absolute; width: 960px; height: 688px; border-radius: 22px; transform-origin: 50% 50%;
  box-shadow: 0 0 0 transparent; scale: 0.96; transition: scale 280ms var(--spring), box-shadow 160ms var(--expand);
  -moz-window-dragging: no-drag;
}
${R} .vh-root.open .vh-sheet { scale: 1; box-shadow: var(--vs-shadow); }
${R} .vh-root.closing .vh-sheet { scale: 0.985; box-shadow: 0 0 0 transparent; transition: scale 140ms ease, box-shadow 140ms ease; }
${R} .vh-lens, ${R} .vh-tint, ${R} .vh-rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
${R} .vh-lens { visibility: hidden; }
${R} .vh-root.open .vh-lens { visibility: visible; }
${R} .vh-tint { background: var(--vs-tint); }
${R} .vh-rim { padding: 1px; background: var(--vs-rim); ${RIM_MASK} }
${R} .vh-tint, ${R} .vh-rim, ${R} .vh-body { opacity: 0; transition: opacity 160ms var(--expand); }
${R} .vh-root.open :is(.vh-tint, .vh-rim, .vh-body) { opacity: 1; }
${R} .vh-root.closing :is(.vh-tint, .vh-rim, .vh-body) { opacity: 0; transition: opacity 140ms ease; }
${R} .vh-body { position: relative; height: 100%; border-radius: 22px; overflow: hidden; display: flex; flex-direction: column; }

/* Title bar */
${R} .vh-titlebar { height: 48px; flex-shrink: 0; padding: 0 10px 0 18px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--vs-line); }
${R} .vh-tico, ${R} .vh-ico { display: flex; flex-shrink: 0; }
${R} .vh-ttl { flex-grow: 1; font-size: 14px; font-weight: 600; }
${R} .vh-close { width: 30px; height: 30px; border-radius: 15px; background: var(--vs-ctl); display: flex; align-items: center; justify-content: center; }
${R} .vh-close:hover { background: var(--vs-ctl-hover); }
${R} .vh-close:active { background: var(--vs-ctl-press); }

/* Sidebar */
${R} .vh-cols { flex-grow: 1; min-height: 0; display: flex; }
${R} .vh-side { position: relative; width: 216px; flex-shrink: 0; padding: 16px 12px; font-size: 13.5px; }
${R} .vh-search {
  height: 34px; margin-bottom: 12px; padding: 0 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px;
  background: var(--vs-search-bg); box-shadow: inset 0 -1px 0 var(--vs-search-line); color: var(--vs-text3); font-size: 13px;
}
${R} .vh-search.has-text { padding-right: 4px; }
${R} .vh-search:focus-within { background: var(--vs-search-focus); box-shadow: inset 0 -2px 0 var(--vs-accent); }
${R} .vh-search-input { appearance: none; flex-grow: 1; min-width: 0; height: 100%; border: 0; margin: 0; padding: 0; background: transparent; color: var(--vs-text); font: inherit; outline: none !important; user-select: text; caret-color: var(--vs-accent); }
${R} .vh-search-input::placeholder { color: var(--vs-text3); opacity: 1; }
${R} .vh-search-input::selection { background: rgba(76,194,255,0.42); }
${R} .vh-search-clear { width: 26px; height: 26px; border-radius: 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--vs-text2); }
${R} .vh-search-clear:hover { background: var(--vs-hover); }
${R} .vh-search-clear[hidden] { display: none; }
${R} .vh-views { display: flex; flex-direction: column; gap: 2px; }
${R} .vh-view, ${R} .vh-cleardata {
  position: relative; height: 34px; width: 192px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px;
  color: var(--vs-nav); text-align: left; white-space: nowrap; font-size: 13.5px;
}
${R} .vh-view:hover, ${R} .vh-cleardata:hover { background: var(--vs-hover); }
${R} .vh-view:active, ${R} .vh-cleardata:active { background: var(--vs-ctl-press); }
${R} .vh-view[aria-current="page"] { background: var(--vs-active); color: var(--vs-text); }
${R} .vh-view[aria-current="page"]::before { content: ''; position: absolute; left: 0; top: 9px; width: 3px; height: 16px; border-radius: 2px; background: var(--vs-accent); }
${R} .vh-view-label { flex-grow: 1; }
${R} .vh-count { font-size: 12px; color: var(--vs-text2); }
${R} .vh-sideline { position: absolute; left: 12px; top: 581px; width: 192px; height: 1px; background: var(--vs-line); }
${R} .vh-cleardata { position: absolute; left: 12px; top: 590px; }
${R} .vh-vsep { width: 1px; flex-shrink: 0; margin: 16px 0; background: var(--vs-line); }

/* Content: toolbar and list */
${R} .vh-content { flex-grow: 1; min-width: 0; padding: 18px 20px 0; display: flex; flex-direction: column; }
${R} .vh-toolbar { position: relative; height: 32px; flex-shrink: 0; }
${R} .vh-tbline { position: absolute; left: 0; top: 0; width: 703px; height: 32px; display: flex; align-items: center; gap: 8px; opacity: 0; visibility: hidden; transition: opacity 150ms ease, visibility 0ms linear 150ms; }
${R} .vh-tbline.on { opacity: 1; visibility: visible; transition: opacity 150ms ease, visibility 0ms linear; }
${R} .vh-tbtext { flex-grow: 1; min-width: 0; font-size: 13px; color: var(--vs-value); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${R} .vh-tbline.sel .vh-tbtext { color: var(--vs-text); }
${R} .vh-tbline.undo .vh-tbtext { color: var(--vs-h2); }
${R} .vh-btn { height: 32px; flex-shrink: 0; padding: 0 12px; border-radius: 6px; display: flex; align-items: center; gap: 6px; background: var(--vs-ctl); box-shadow: inset 0 0 0 1px var(--vs-ctl-line); font-size: 13px; white-space: nowrap; }
${R} .vh-btn:hover { background: var(--vs-ctl-hover); }
${R} .vh-btn:active { background: var(--vs-ctl-press); }
${R} .vh-btn.vh-tb-delete { padding: 0 12px 0 10px; }
${R} .vh-btn.vh-tb-clear { width: 32px; padding: 0; justify-content: center; }
/* The scroller reaches the sheet's right edge, so the 2 px overlay thumb sits in the content's 20 px
   padding, beside the cards (scrollthumb.ts: right 3). */
${R} .vh-listbox { position: relative; margin: 12px -20px 0 0; height: 578px; flex-shrink: 0; }
${R} .vh-scroll { position: absolute; inset: 0; padding-right: 20px; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; border-bottom-right-radius: 22px; }
${R} .vh-list { padding-bottom: 20px; outline: none; }
${R} .vh-msg { position: absolute; left: 0; top: 56px; width: 703px; display: flex; flex-direction: column; align-items: center; text-align: center; }
${R} .vh-msg[hidden] { display: none; }
${R} .vh-msg p { margin: 0; font-size: 13px; line-height: 20px; color: var(--vs-text3); }
${R} .vh-msg p.strong { color: var(--vs-h2); }
${R} .vh-msg p.small { margin-top: 6px; font-size: 12.5px; line-height: 18px; color: var(--vs-text3); }
${R} .vh-msg .vh-btn { margin-top: 14px; }

/* A day (or Tabs / Windows): a 28 px heading, 6 px, the card, 18 px before the next */
${R} .vh-group { transition: opacity 160ms ease; }
${R} .vh-head { position: relative; height: 34px; overflow: hidden; outline: none; transition: height 280ms var(--spring); }
${R} .vh-hbox { position: absolute; left: 0; top: 0; width: 703px; height: 28px; border-radius: 6px; }
${R} .vh-head:focus-visible .vh-hbox { box-shadow: inset 0 0 0 2px var(--vs-focus); }
${R} .vh-hcb { position: absolute; left: 12px; top: 4px; opacity: 0; transition: opacity 240ms ease; pointer-events: none; }
${R} .vh-list.selmode .vh-hcb { opacity: 1; pointer-events: auto; }
${R} .vh-htext { position: absolute; left: 2px; top: 4px; height: 20px; display: flex; align-items: baseline; gap: 8px; white-space: nowrap; transition: transform 240ms var(--spring); }
${R} .vh-list.selmode .vh-htext { transform: translateX(42px); }
${R} .vh-hl { font-size: 13px; line-height: 20px; font-weight: 600; color: var(--vs-h2); }
${R} .vh-hs { font-size: 12px; line-height: 20px; color: var(--vs-text3); }
${R} .vh-hdelcell { position: absolute; right: 0; top: 0; height: 28px; }
${R} .vh-hdel { height: 28px; padding: 0 10px; border-radius: 6px; font-size: 12.5px; color: var(--vs-value); white-space: nowrap; opacity: 0; transition: opacity 120ms ease; }
${R} .vh-head:is(:hover, :focus-within) .vh-hdel, ${R} .vh-hdel:focus-visible { opacity: 1; }
${R} .vh-hdel:hover { background: var(--vs-del-hover); box-shadow: inset 0 0 0 1px var(--vs-del-hover-line); }
${R} .vh-card { position: relative; border-radius: 10px; overflow: hidden; background: var(--vs-card); }
${R} .vh-cardline { position: absolute; inset: 0; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--vs-card-line); pointer-events: none; z-index: 1; }
${R} .vh-gap { height: 18px; transition: height 280ms var(--spring); }
${R} .vh-group:last-child > .vh-gap { height: 0; }
${R} .vh-group.gone { opacity: 0; }
${R} .vh-group.gone .vh-head, ${R} .vh-group.gone .vh-gap, ${R} .vh-group.gone .vh-row { height: 0; }
${R} .vh-group.gone .vh-row { transition: height 280ms var(--spring); }

/* Checkbox: Settings' control, 20x20 radius 4 (checked and mixed share the fill) */
${R} .vh-cb { position: absolute; width: 20px; height: 20px; border-radius: 4px; background: var(--vs-check-bg); box-shadow: inset 0 0 0 1px var(--vs-check-line); color: var(--vs-on-accent); }
${R} .vh-cb svg { position: absolute; left: 0; top: 0; opacity: 0; }
${R} .vh-cb .vh-mix { position: absolute; left: 6px; top: 9px; width: 8px; height: 2px; border-radius: 1px; background: var(--vs-on-accent); opacity: 0; }
${R} .vh-cb.on, ${R} .vh-cb.mixed { background: var(--vs-accent); box-shadow: none; }
${R} .vh-cb.on svg, ${R} .vh-cb.mixed .vh-mix { opacity: 1; }

/* Row: 40 px; card-local x (spec "Row") */
${R} .vh-row { position: relative; height: 40px; overflow: hidden; outline: none; transition: height 240ms var(--spring); }
${R} .vh-in { position: absolute; left: 0; top: 0; width: 703px; height: 40px; transition: opacity 160ms ease 80ms; }
${R} .vh-plate, ${R} .vh-wash, ${R} .vh-ring { position: absolute; left: 0; top: 0; width: 703px; height: 40px; pointer-events: none; }
${R} .vh-row:hover .vh-plate { background: var(--vs-hover); }
${R} .vh-row:is(:active, .pressed) .vh-plate { background: var(--vs-pressed); }
${R} .vh-row[aria-selected="true"] .vh-plate { background: var(--vs-active); }
${R} .vh-wash { background: var(--vs-wash); opacity: 0; transition: opacity 900ms ease; }
${R} .vh-row.washed .vh-wash { opacity: 1; transition: none; }
${R} .vh-ring { box-sizing: border-box; border-radius: 6px; }
${R} .vh-row:focus-visible .vh-ring { box-shadow: inset 0 0 0 2px var(--vs-focus); }
${R} .vh-slot { position: absolute; left: 2px; top: 0; width: 40px; height: 40px; }
${R} .vh-fav { position: absolute; left: 12px; top: 12px; width: 16px; height: 16px; color: var(--vs-text2); transition: opacity 120ms ease; }
${R} .vh-fav img, ${R} .vh-fav svg { display: block; width: 16px; height: 16px; }
${R} .vh-slot .vh-cb { left: 10px; top: 10px; opacity: 0; transition: opacity 120ms ease; }
${R} .vh-list.pages .vh-row:hover .vh-slot .vh-cb, ${R} .vh-list.selmode .vh-slot .vh-cb { opacity: 1; }
${R} .vh-list.pages .vh-row:hover .vh-fav, ${R} .vh-list.selmode .vh-fav { opacity: 0; }
${R} .vh-title { position: absolute; left: 44px; top: 0; width: 315px; height: 40px; line-height: 40px; font-size: 13.5px; color: var(--vs-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${R} .vh-title.bare { opacity: 0.85; }
${R} .vh-addr { position: absolute; left: 375px; top: 0; width: 200px; height: 40px; line-height: 40px; font-size: 12.5px; color: var(--vs-text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
${R} .vh-addr > span { direction: ltr; unicode-bidi: isolate; }
${R} .vh-title b, ${R} .vh-addr b { font-weight: 600; }
${R} .vh-addr b { color: var(--vs-text); }
${R} .vh-time { position: absolute; left: 591px; top: 0; width: 64px; height: 40px; line-height: 40px; text-align: right; font-size: 12.5px; color: var(--vs-text2); font-variant-numeric: tabular-nums; white-space: nowrap; }
${R} .vh-xcell { position: absolute; left: 663px; top: 6px; width: 28px; height: 28px; }
${R} .vh-x { width: 28px; height: 28px; border-radius: 14px; color: var(--vs-text2); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 120ms ease, background 120ms ease; }
${R} .vh-row:is(:hover, :focus-visible) .vh-x { opacity: 1; }
${R} .vh-x:hover { background: var(--vs-ctl); }
${R} .vh-hair { position: absolute; left: 44px; top: 39px; width: 659px; height: 1px; background: var(--vs-sep); transition: opacity 160ms ease 100ms; }
${R} .vh-row.last .vh-hair { opacity: 0; }

/* Deletes and Undo (spec "Motion"): the content fades over 100 ms, then the height collapses over
   240 ms on the spring; a day's group fades 160 ms and collapses 280 ms; Undo is the reverse. */
${R} .vh-row.gone { height: 0; transition: height 240ms var(--spring) 100ms; }
${R} .vh-row.gone .vh-in { opacity: 0; transition: opacity 100ms ease; }
${R} .vh-row.fade .vh-in { opacity: 0; transition: opacity 150ms ease; }

/* Private window: only the title bar and one line (spec "Private windows") */
${R} .vh-private { position: absolute; left: 0; top: 166px; width: 960px; margin: 0; text-align: center; font-size: 13px; line-height: 20px; color: var(--vs-text3); }

@media (prefers-reduced-motion: reduce) {
  ${R} .vh-sheet { scale: none !important; transition: box-shadow 150ms ease !important; }
  ${R} :is(.vh-tint, .vh-rim, .vh-body, .vh-scrim, .vh-tbline) { transition: opacity 150ms ease !important; }
  ${R} :is(.vh-row, .vh-head, .vh-gap) { transition: none !important; }
  ${R} :is(.vh-in, .vh-group, .vh-fav, .vh-slot .vh-cb, .vh-x, .vh-hcb, .vh-hdel, .vh-hair, .vh-wash) { transition: opacity 150ms ease !important; }
  ${R} .vh-row.gone .vh-in { transition: opacity 150ms ease !important; }
  ${R} .vh-htext { transition: none !important; }
}
@media (forced-colors: active) {
  ${R} .vh-tint { background: Canvas; }
  ${R} .vh-lens { backdrop-filter: none !important; }
  ${R} .vh-sheet { outline: 1px solid CanvasText; }
  ${R} :is(.vh-search, .vh-card, .vh-btn, .vh-close):not(:focus-visible) { outline: 1px solid CanvasText; outline-offset: -1px; }
  ${R} .vh-row[aria-selected="true"] .vh-plate { forced-color-adjust: none; background: Highlight; }
  ${R} .vh-row[aria-selected="true"] :is(.vh-title, .vh-addr, .vh-time, .vh-addr b) { forced-color-adjust: none; color: HighlightText; }
  ${R} :is(.vh-row, .vh-head):focus-visible :is(.vh-ring, .vh-hbox) { box-shadow: none; outline: 2px solid Highlight; outline-offset: -2px; }
  ${R} .vh-cb { forced-color-adjust: none; background: Canvas; box-shadow: inset 0 0 0 1px CanvasText; color: HighlightText; }
  ${R} .vh-cb :is(svg) { color: HighlightText; }
  ${R} .vh-cb:is(.on, .mixed) { background: Highlight; box-shadow: none; }
  ${R} .vh-cb .vh-mix { background: HighlightText; }
  ${R} .vh-view[aria-current="page"]::before { forced-color-adjust: none; background: Highlight; }
  ${R} .vh-hair { forced-color-adjust: none; background: GrayText; }
}
`;
