// Styles for the Settings panel, the background picker, and Home's background circle and popover.
// Values come from the Settings, SettingsTabs, SettingsKeys, HomeBackground and Home boards; the
// light set follows Windows 11 light mode. Ported from app/src/renderer/modules/settings/styles.ts.
// Gecko notes:
//   - Every rule starts with #vitre-root: the core's `#vitre-root button` reset (shell.css) would
//     otherwise win over a class selector.
//   - The panel follows Settings › Appearance › Mode through prefers-color-scheme: the Mode setting
//     switches Firefox's built-in theme (VitreSettings.syncEngine), which decides the chrome
//     document's colour scheme.
//   - Faded things are never ancestors of a lens (an element at opacity < 1 is a backdrop root and
//     its backdrop-filter descendants would see nothing): the sheet and the popover scale, their
//     tint, rim and body fade, and the lens is shown at once / hidden first.
//   - Scrollbars: the sidebar and the page scroll under the board's 2 px overlay thumb (right 3,
//     white 0.4 dark / black 0.4 light): src/window/scrollthumb.ts, colour --vt-thumb below.

const DARK = `
  --vs-text: #ffffff;
  --vs-text2: rgba(255,255,255,0.6);
  --vs-text3: rgba(255,255,255,0.55);
  --vs-intro: rgba(255,255,255,0.62);
  --vs-nav: rgba(255,255,255,0.88);
  --vs-h2: rgba(255,255,255,0.86);
  --vs-icon: rgba(255,255,255,0.85);
  --vs-value: rgba(255,255,255,0.7);
  --vs-state: rgba(255,255,255,0.8);
  --vs-subtle: rgba(255,255,255,0.78);
  --vs-card: rgba(255,255,255,0.06);
  --vs-card-line: rgba(255,255,255,0.06);
  --vs-sep: rgba(255,255,255,0.07);
  --vs-line: rgba(255,255,255,0.08);
  --vs-ctl: rgba(255,255,255,0.08);
  --vs-ctl-hover: rgba(255,255,255,0.12);
  --vs-ctl-press: rgba(255,255,255,0.05);
  --vs-ctl-line: rgba(255,255,255,0.08);
  --vs-seg-text: rgba(255,255,255,0.75);
  --vs-seg-on: rgba(255,255,255,0.2);
  --vs-seg-on-line: rgba(255,255,255,0.35);
  --vs-hover: rgba(255,255,255,0.06);
  --vs-active: rgba(255,255,255,0.1);
  --vs-search-bg: rgba(255,255,255,0.07);
  --vs-search-focus: rgba(0,0,0,0.12);
  --vs-search-line: rgba(255,255,255,0.3);
  --vs-accent: #4cc2ff;
  --vs-accent-hover: #47b1e8;
  --vs-accent-soft: rgba(76,194,255,0.22);
  --vs-on-accent: #0b1a24;
  --vs-badge-bg: rgba(76,194,255,0.2);
  --vs-badge-text: #9fe3ff;
  --vs-check-line: rgba(255,255,255,0.6);
  --vs-check-bg: rgba(0,0,0,0.12);
  --vs-knob-off: rgba(255,255,255,0.8);
  --vs-tile-line: rgba(255,255,255,0.12);
  --vs-error: #ff99a4;
  --vs-focus: #ffffff;
  --vs-scroll: rgba(255,255,255,0.32);
  --vt-thumb: rgba(255,255,255,0.4);
  --vs-pop: rgba(44,44,50,0.94);
  --vs-pop-line: rgba(255,255,255,0.1);
  --vs-opt-hover: rgba(255,255,255,0.08);
  --vs-tint: rgba(20,20,24,0.62);
  --vs-rim: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2));
  --vs-shadow: 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
`;

const LIGHT = `
  --vs-text: rgba(0,0,0,0.9);
  --vs-text2: rgba(0,0,0,0.6);
  --vs-text3: rgba(0,0,0,0.5);
  --vs-intro: rgba(0,0,0,0.62);
  --vs-nav: rgba(0,0,0,0.86);
  --vs-h2: rgba(0,0,0,0.86);
  --vs-icon: rgba(0,0,0,0.78);
  --vs-value: rgba(0,0,0,0.62);
  --vs-state: rgba(0,0,0,0.8);
  --vs-subtle: rgba(0,0,0,0.72);
  --vs-card: rgba(255,255,255,0.62);
  --vs-card-line: rgba(0,0,0,0.06);
  --vs-sep: rgba(0,0,0,0.07);
  --vs-line: rgba(0,0,0,0.08);
  --vs-ctl: rgba(255,255,255,0.72);
  --vs-ctl-hover: rgba(249,249,249,0.55);
  --vs-ctl-press: rgba(249,249,249,0.32);
  --vs-ctl-line: rgba(0,0,0,0.09);
  --vs-seg-text: rgba(0,0,0,0.7);
  --vs-seg-on: #ffffff;
  --vs-seg-on-line: rgba(0,0,0,0.06);
  --vs-hover: rgba(0,0,0,0.05);
  --vs-active: rgba(0,0,0,0.06);
  --vs-search-bg: rgba(255,255,255,0.7);
  --vs-search-focus: #ffffff;
  --vs-search-line: rgba(0,0,0,0.45);
  --vs-accent: #005fb8;
  --vs-accent-hover: #1a6fc0;
  --vs-accent-soft: rgba(0,95,184,0.18);
  --vs-on-accent: #ffffff;
  --vs-badge-bg: rgba(0,95,184,0.12);
  --vs-badge-text: #005fb8;
  --vs-check-line: rgba(0,0,0,0.45);
  --vs-check-bg: rgba(0,0,0,0.02);
  --vs-knob-off: rgba(0,0,0,0.62);
  --vs-tile-line: rgba(0,0,0,0.1);
  --vs-error: #c42b1c;
  --vs-focus: rgba(0,0,0,0.9);
  --vs-scroll: rgba(0,0,0,0.3);
  --vt-thumb: rgba(0,0,0,0.4);
  --vs-pop: rgba(249,249,251,0.96);
  --vs-pop-line: rgba(0,0,0,0.1);
  --vs-opt-hover: rgba(0,0,0,0.05);
  --vs-tint: rgba(243,243,246,0.8);
  --vs-rim: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.4) 30%, rgba(255,255,255,0.25) 60%, rgba(255,255,255,0.7));
  --vs-shadow: 0 40px 100px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.16);
`;

const RIM_MASK = 'mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;';
const R = '#vitre-root';

export const CSS = `
/* The scrim leaves the window's drag strip working (the region is geometric, shell.css #vitre-drag);
 * the sheet itself never drags, also when a small window brings it into the strip. */
${R} .vs-root { position: absolute; inset: 0; font-family: var(--font); font-size: 13.5px; color: var(--vs-text); ${DARK} }
${R} .hb-pop, ${R} .hb-circle { ${DARK} }
@media (prefers-color-scheme: light) { ${R} .vs-root { ${LIGHT} } }
${R} .vs-root button, ${R} .hb-pop button, ${R} .hb-circle button { color: inherit; }
${R} .vs-root :focus-visible, ${R} .hb-pop :focus-visible, ${R} .hb-circle :focus-visible { outline: 2px solid var(--vs-focus, #fff); outline-offset: 1px; }
${R} .vs-root :focus:not(:focus-visible), ${R} .hb-pop :focus:not(:focus-visible) { outline: none; }

/* Scrim, sheet and material */
${R} .vs-scrim { position: absolute; inset: 0; background: rgba(8,8,12,0.3); opacity: 0; transition: opacity 200ms ease; }
${R} .vs-root.open .vs-scrim { opacity: 1; }
${R} .vs-sheet {
  position: absolute; width: 960px; height: 688px; border-radius: 22px; transform-origin: 50% 50%;
  box-shadow: 0 0 0 transparent; scale: 0.96; transition: scale 280ms var(--spring), box-shadow 160ms var(--expand);
  -moz-window-dragging: no-drag;
}
${R} .vs-root.open .vs-sheet { scale: 1; box-shadow: var(--vs-shadow); }
${R} .vs-root.closing .vs-sheet { scale: 0.985; box-shadow: 0 0 0 transparent; transition: scale 140ms ease, box-shadow 140ms ease; }
${R} .vs-lens, ${R} .vs-tint, ${R} .vs-rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
${R} .vs-lens { visibility: hidden; }
${R} .vs-root.open .vs-lens { visibility: visible; }
${R} .vs-tint { background: var(--vs-tint); }
${R} .vs-rim { padding: 1px; background: var(--vs-rim); ${RIM_MASK} }
${R} .vs-tint, ${R} .vs-rim, ${R} .vs-body { opacity: 0; transition: opacity 160ms var(--expand); }
${R} .vs-root.open :is(.vs-tint, .vs-rim, .vs-body) { opacity: 1; }
${R} .vs-root.closing :is(.vs-tint, .vs-rim, .vs-body) { opacity: 0; transition: opacity 140ms ease; }
${R} .vs-body { position: relative; height: 100%; display: flex; flex-direction: column; }

/* Title bar */
${R} .vs-titlebar { height: 48px; flex-shrink: 0; padding: 0 10px 0 18px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--vs-line); }
${R} .vs-tico, ${R} .vs-close-ico, ${R} .vs-clear-ico, ${R} .vs-go-ico { display: flex; }
${R} .vs-ttl { flex-grow: 1; font-size: 14px; font-weight: 600; }
${R} .vs-close { width: 30px; height: 30px; border-radius: 15px; background: var(--vs-ctl); display: flex; align-items: center; justify-content: center; }
${R} .vs-close:hover { background: var(--vs-ctl-hover); }
${R} .vs-close:active { background: var(--vs-ctl-press); }

/* Sidebar */
${R} .vs-cols { flex-grow: 1; min-height: 0; display: flex; }
${R} .vs-nav { width: 216px; flex-shrink: 0; padding: 16px 12px; display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; overflow-y: auto; }
${R} .vs-search {
  height: 34px; margin-bottom: 12px; padding: 0 4px 0 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px; flex-shrink: 0;
  background: var(--vs-search-bg); box-shadow: inset 0 -1px 0 var(--vs-search-line); color: var(--vs-text3); font-size: 13px;
}
${R} .vs-search:focus-within { background: var(--vs-search-focus); box-shadow: inset 0 -2px 0 var(--vs-accent); }
${R} .vs-search-ico { display: flex; flex-shrink: 0; }
${R} .vs-search-input { appearance: none; flex-grow: 1; min-width: 0; height: 100%; border: 0; margin: 0; padding: 0; background: transparent; color: var(--vs-text); font: inherit; outline: none !important; user-select: text; caret-color: var(--vs-accent); }
${R} .vs-search-input::placeholder { color: var(--vs-text3); opacity: 1; }
${R} .vs-search-input::selection { background: rgba(76,194,255,0.42); }
${R} .vs-search-clear { width: 26px; height: 26px; border-radius: 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--vs-text2); }
${R} .vs-search-clear:hover { background: var(--vs-hover); }
${R} .vs-search-clear svg { width: 10px; height: 10px; }
${R} .vs-navitem { position: relative; height: 34px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px; color: var(--vs-nav); text-align: left; white-space: nowrap; flex-shrink: 0; }
${R} .vs-navitem:hover { background: var(--vs-hover); }
${R} .vs-navitem:active { background: var(--vs-ctl-press); }
${R} .vs-navitem[aria-current="page"] { background: var(--vs-active); color: var(--vs-text); }
${R} .vs-navitem[aria-current="page"]::before { content: ''; position: absolute; left: 0; top: 9px; width: 3px; height: 16px; border-radius: 2px; background: var(--vs-accent); }
${R} .vs-navico { display: flex; flex-shrink: 0; }
${R} .vs-navico img { width: 18px; height: 18px; }
${R} .vs-navlabel { overflow: hidden; text-overflow: ellipsis; }
${R} .vs-vsep { width: 1px; flex-shrink: 0; margin: 16px 0; background: var(--vs-line); }

/* Page */
${R} .vs-main { position: relative; flex-grow: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; border-bottom-right-radius: 22px; outline: none; }
${R} .vs-content { padding: 16px 28px 18px; display: flex; flex-direction: column; }
${R} .vs-h1 { margin: 0; font: 600 26px/34px 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; }
${R} .vs-headrow { height: 34px; display: flex; align-items: center; gap: 16px; }
${R} .vs-headrow .vs-h1 { flex-grow: 1; }
${R} .vs-intro { margin: 2px 2px 0; font-size: 12.5px; line-height: 18px; color: var(--vs-intro); }
${R} .vs-empty { margin-top: 12px; }
${R} .vs-h2 { margin: 16px 0 8px 2px; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--vs-h2); }
${R} .vs-h1 + .vs-h2, ${R} .vs-headrow + .vs-h2 { margin-top: 12px; }
${R} :is(.vs-h1, .vs-headrow, .vs-intro) + :is(.vs-card, .vs-ext) { margin-top: 16px; }
${R} .vs-card + .vs-card { margin-top: 8px; }
${R} .vs-card { position: relative; border-radius: 10px; background: var(--vs-card); box-shadow: inset 0 0 0 1px var(--vs-card-line); }
${R} .vs-card > *, ${R} .vs-rows > * { position: relative; }
${R} :is(.vs-card, .vs-rows) > :not([hidden]) ~ :not([hidden])::before { content: ''; position: absolute; top: 0; left: 16px; right: 0; height: 1px; background: var(--vs-sep); }
${R} :is(.vs-card, .vs-rows) > :not([hidden]) ~ .has-ico:not([hidden])::before { left: 52px; }
${R} .vs-rows > .vs-block::before { display: none; }
${R} .vs-ext { display: flex; flex-direction: column; }
/* A page added with registerPage sits in .vs-ext right after the h1: its own first element keeps the
   distance a built-in page's would (SettingsTabs: first h2 12 px under the h1; SettingsKeys: the
   intro 2 px under it; a card 16 px). */
${R} :is(.vs-h1, .vs-headrow) + .vs-ext { margin-top: 0; }
${R} :is(.vs-h1, .vs-headrow) + .vs-ext > :first-child { margin-top: 16px; }
${R} :is(.vs-h1, .vs-headrow) + .vs-ext > .vs-h2:first-child { margin-top: 12px; }
${R} :is(.vs-h1, .vs-headrow) + .vs-ext > .vs-intro:first-child { margin-top: 2px; }

/* Rows */
${R} .vs-row { min-height: 56px; padding: 0 16px; display: flex; align-items: center; gap: 16px; }
${R} .vs-row.compact { min-height: 44px; }
${R} .vs-ico { width: 20px; height: 20px; flex-shrink: 0; display: flex; color: var(--vs-icon); }
${R} .vs-ico img { width: 20px; height: 20px; }
${R} .vs-text { flex-grow: 1; min-width: 0; padding: 9px 0; display: flex; flex-direction: column; gap: 2px; }
${R} .vs-title { font-size: 14px; line-height: 20px; }
${R} .vs-desc { font-size: 12px; line-height: 16px; color: var(--vs-text2); }
${R} .vs-desc.vs-conflict { color: var(--vs-error); }
${R} .vs-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
${R} .vs-pickrow { cursor: default; }

/* Switch */
${R} .vs-toggle { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
${R} .vs-state { min-width: 22px; text-align: right; font-size: 13px; color: var(--vs-state); }
${R} .vs-switch { position: relative; width: 40px; height: 20px; flex-shrink: 0; border-radius: 10px; background: var(--vs-check-bg); box-shadow: inset 0 0 0 1px var(--vs-check-line); transition: background 120ms ease, box-shadow 120ms ease; }
${R} .vs-knob { position: absolute; top: 4px; left: 4px; width: 12px; height: 12px; border-radius: 6px; background: var(--vs-knob-off); transition: left 220ms var(--spring), top 120ms ease, width 120ms ease, height 120ms ease, background 120ms ease; }
${R} .vs-switch:hover .vs-knob { top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 7px; }
${R} .vs-switch[aria-checked="true"] { background: var(--vs-accent); box-shadow: none; }
${R} .vs-switch[aria-checked="true"] .vs-knob { top: 3px; left: 23px; width: 14px; height: 14px; border-radius: 7px; background: var(--vs-on-accent); }
${R} .vs-switch[aria-checked="true"]:hover { background: var(--vs-accent-hover); }

/* Segmented */
${R} .vs-seg { height: 30px; padding: 2px; border-radius: 8px; display: flex; gap: 2px; flex-shrink: 0; background: var(--vs-ctl); }
${R} .vs-seg-btn { padding: 0 14px; border-radius: 6px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; font-size: 12.5px; white-space: nowrap; color: var(--vs-seg-text); }
${R} .vs-seg-btn::after { content: attr(data-label); height: 0; overflow: hidden; visibility: hidden; font-weight: 600; } /* keeps the width when the label turns bold */
${R} .vs-seg-btn:hover { background: var(--vs-hover); color: var(--vs-text); }
${R} .vs-seg-btn:is([aria-checked="true"], [aria-selected="true"]) { background: var(--vs-seg-on); color: var(--vs-text); font-weight: 600; box-shadow: inset 0 0.5px 0 var(--vs-seg-on-line); }
@media (prefers-color-scheme: light) { ${R} .vs-root .vs-seg-btn:is([aria-checked="true"], [aria-selected="true"]) { box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.08); } }

/* Drop-down and its list */
${R} .vs-dd { height: 32px; max-width: 300px; padding: 0 10px 0 12px; border-radius: 6px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; background: var(--vs-ctl); box-shadow: inset 0 0 0 1px var(--vs-ctl-line); font-size: 13px; white-space: nowrap; }
${R} .vs-dd:hover { background: var(--vs-ctl-hover); }
${R} .vs-dd:is(:active, [aria-expanded="true"]) { background: var(--vs-ctl-press); }
${R} .vs-dd-label { overflow: hidden; text-overflow: ellipsis; }
${R} .vs-dd-chev { display: flex; color: var(--vs-text2); }
${R} .vs-pop {
  position: absolute; z-index: 5; min-width: 120px; max-height: 360px; overflow-y: auto; padding: 4px; border-radius: 8px;
  background: var(--vs-pop); box-shadow: 0 0 0 1px var(--vs-pop-line), 0 16px 40px rgba(0,0,0,0.32), 0 1px 3px rgba(0,0,0,0.2);
  backdrop-filter: blur(24px) saturate(1.6); outline: none !important; animation: vs-pop-in 200ms var(--spring); scrollbar-width: thin;
}
@keyframes vs-pop-in { from { transform: translateY(-4px); } to { transform: none; } }
${R} .vs-opt { position: relative; height: 32px; padding: 0 14px 0 16px; border-radius: 4px; display: flex; align-items: center; font-size: 13px; white-space: nowrap; }
${R} .vs-opt[aria-selected="true"] { background: var(--vs-hover); }
${R} .vs-opt.active { background: var(--vs-opt-hover); }
${R} .vs-opt[aria-selected="true"].active { background: var(--vs-active); }
${R} .vs-opt[aria-selected="true"]::before { content: ''; position: absolute; left: 0; top: 8px; width: 3px; height: 16px; border-radius: 2px; background: var(--vs-accent); }

/* Buttons */
${R} .vs-btn { height: 32px; padding: 0 14px; border-radius: 6px; flex-shrink: 0; background: var(--vs-ctl); box-shadow: inset 0 0 0 1px var(--vs-ctl-line); font-size: 13px; white-space: nowrap; }
${R} .vs-btn:hover { background: var(--vs-ctl-hover); }
${R} .vs-btn:active { background: var(--vs-ctl-press); }
${R} .vs-btn:disabled { opacity: 0.4; pointer-events: none; }
${R} .vs-btn.accent { background: var(--vs-accent); box-shadow: none; color: var(--vs-on-accent); font-weight: 600; }
${R} .vs-btn.accent:hover { background: var(--vs-accent-hover); }
${R} .vs-btn.subtle { height: 30px; margin-right: 6px; padding: 0 10px; background: transparent; box-shadow: none; color: var(--vs-subtle); }
${R} .vs-btn.subtle:hover { background: var(--vs-hover); }
${R} .vs-link { padding: 4px 6px; border-radius: 4px; font-size: 13px; color: var(--vs-value); white-space: nowrap; flex-shrink: 0; }
${R} .vs-link:hover { background: var(--vs-hover); color: var(--vs-text); }
${R} .vs-go { display: flex; align-items: center; gap: 6px; }

/* Check boxes and radios */
${R} :is(.vs-check, .vs-radio) { width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--vs-check-bg); box-shadow: inset 0 0 0 1px var(--vs-check-line); color: transparent; }
${R} .vs-check { border-radius: 4px; }
${R} .vs-radio { position: relative; border-radius: 10px; }
${R} :is(.vs-check, .vs-radio)[aria-checked="true"] { background: var(--vs-accent); box-shadow: none; color: var(--vs-on-accent); }
${R} .vs-radio[aria-checked="true"]::after { content: ''; width: 10px; height: 10px; border-radius: 5px; background: var(--vs-on-accent); transition: width 120ms ease, height 120ms ease; }
${R} .vs-pickrow:hover .vs-radio[aria-checked="true"]::after { width: 12px; height: 12px; border-radius: 6px; }
${R} .vs-pickrow:hover :is(.vs-check, .vs-radio):not([aria-checked="true"]) { background: var(--vs-hover); }
${R} .vs-actions { min-height: 60px; justify-content: flex-end; }
${R} .vs-status { flex-grow: 1; font-size: 12.5px; color: var(--vs-text2); }

/* Keyboard shortcuts */
${R} .vs-key { font-size: 13px; color: var(--vs-value); white-space: nowrap; flex-shrink: 0; }
${R} .vs-keyctl { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
${R} .vs-keybtn { margin-right: -8px; padding: 5px 8px; border-radius: 6px; font-size: 13px; color: var(--vs-value); white-space: nowrap; }
${R} .vs-keybtn:hover { background: var(--vs-hover); color: var(--vs-text); }
${R} .vs-rebind { position: relative; }
${R} .vs-capture { flex-direction: column; align-items: stretch; gap: 0; padding: 0 16px 12px; }
${R} .vs-capline { height: 46px; display: flex; align-items: center; gap: 16px; }
${R} .vs-capline .vs-title { flex-grow: 1; }
${R} .vs-capfield { width: 148px; height: 30px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; flex-shrink: 0; background: var(--vs-card); box-shadow: inset 0 0 0 1px var(--vs-accent); font-size: 13px; white-space: nowrap; overflow: hidden; outline: none !important; }
/* Refused: the field keeps its accent ring (it is still listening); the reason under it is red (board SettingsKeys). */
${R} .vs-capfield.empty { color: var(--vs-text3); }
${R} .vs-capmsg { display: flex; align-items: baseline; gap: 16px; font-size: 12px; line-height: 18px; }
${R} .vs-refusal { flex-grow: 1; color: var(--vs-error); }
${R} .vs-hint { color: var(--vs-text3); white-space: nowrap; }

/* Switcher style tiles */
${R} .vs-block { padding: 0 16px 16px; }
${R} .vs-styleblock { padding: 16px 16px 10px; }
${R} .vs-styles { display: flex; gap: 20px; }
${R} .vs-style { position: relative; width: 205px; display: flex; flex-direction: column; gap: 10px; text-align: left; border-radius: 10px; }
${R} .vs-style:focus-visible { outline: none !important; }
${R} .vs-style:focus-visible .vs-style-preview { outline: 2px solid var(--vs-focus); outline-offset: 7px; }
${R} .vs-style-preview { position: relative; display: block; width: 205px; height: 120px; border-radius: 10px; overflow: hidden; background: #1a1b20; transition: box-shadow 160ms ease; }
${R} .vs-style-preview::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px var(--vs-tile-line); pointer-events: none; }
${R} .vs-style:hover .vs-style-preview::after { box-shadow: inset 0 0 0 1px var(--vs-search-line); }
${R} .vs-style[aria-checked="true"] .vs-style-preview { box-shadow: 0 0 0 2px var(--vs-accent), 0 0 0 5px var(--vs-accent-soft); }
${R} .vs-style[aria-checked="true"] .vs-style-preview::after { display: none; }
${R} .vs-style-name { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--vs-nav); }
${R} .vs-style[aria-checked="true"] .vs-style-name { color: var(--vs-text); }
${R} .vs-style-default { padding: 0 6px; border-radius: 4px; background: var(--vs-badge-bg); color: var(--vs-badge-text); font-size: 11px; font-weight: 600; line-height: 18px; }
${R} .vs-note { margin: 10px 2px 0; font-size: 12.5px; line-height: 18px; color: var(--vs-intro); }
${R} .vs-appicons .vs-style, ${R} .vs-appicons .vs-style-preview { width: 120px; }
${R} .vs-appicons .vs-style-preview { height: 96px; display: flex; align-items: center; justify-content: center; background: var(--vs-tile-line); }
${R} .hb-badge { position: absolute; right: 7px; top: 7px; width: 18px; height: 18px; border-radius: 9px; display: none; align-items: center; justify-content: center; background: var(--vs-accent); color: var(--vs-on-accent); pointer-events: none; }
${R} [aria-checked="true"] > .hb-badge { display: flex; }

/* Background picker */
${R} .hb-picker { display: flex; flex-direction: column; }
${R} .hb-grid { display: grid; gap: 12px; }
${R} .hb-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
${R} .hb-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
${R} .hb-tile { position: relative; min-width: 0; display: flex; flex-direction: column; gap: 8px; text-align: left; border-radius: 10px; }
${R} .hb-tile:focus-visible { outline: none !important; }
${R} .hb-tile:focus-visible .hb-face { outline: 2px solid var(--vs-focus); outline-offset: 4px; }
${R} .hb-face { position: relative; display: block; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; background: var(--vs-card); transition: box-shadow 160ms ease; }
${R} .hb-face::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px var(--vs-tile-line); pointer-events: none; }
${R} .hb-face :is(img, video) { display: block; width: 100%; height: 100%; object-fit: cover; }
/* "No picture": what Home shows then, its base colour (src/pages/home/home.css). */
${R} .hb-face.hb-plain, ${R} .hb-popover .hb-face.hb-plain { background: #2b2a2e; }
${R} .hb-tile[aria-checked="true"] .hb-face { box-shadow: 0 0 0 2px var(--vs-accent), 0 0 0 5px var(--vs-accent-soft); }
${R} .hb-cap { font-size: 12px; line-height: 16px; color: var(--vs-text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${R} .hb-tile[aria-checked="true"] .hb-cap { color: var(--vs-text); }
${R} .hb-note { margin: 10px 2px 0; font-size: 12.5px; line-height: 18px; color: var(--vs-intro); }
${R} .hb-note.error { color: var(--vs-error); }
${R} .hb-panel .hb-grid:not([hidden]) + .hb-note { margin-top: 12px; }

/* Home: the background circle and popover (board Home / HomeBackground) */
${R} .hb-circle { right: 20px; bottom: 20px; width: 44px; height: 44px; transition: opacity 200ms ease, transform 320ms var(--spring); -moz-window-dragging: no-drag; }
${R} .hb-circle.off { opacity: 0; transform: scale(0.8); pointer-events: none; }
${R} .hb-circle-face { position: absolute; inset: 0; border-radius: 22px; display: flex; align-items: center; justify-content: center; color: var(--g-icon); }
${R} .hb-circle-ico { display: flex; }
${R} .hb-circle-face:hover { background: var(--g-hover); }
${R} .hb-circle-face:active, ${R} .hb-circle-face[aria-expanded="true"] { background: var(--g-press); }
${R} .hb-pop {
  position: absolute; right: 20px; bottom: 76px; width: 340px; height: 358px; border-radius: 20px; color: #fff; font-size: 13px;
  box-shadow: 0 0 0 transparent; transform-origin: 100% 100%; scale: 0.96; -moz-window-dragging: no-drag;
  transition: scale 200ms var(--spring), box-shadow 90ms var(--expand);
}
${R} .hb-pop.shown { scale: 1; box-shadow: 0 24px 60px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25); }
${R} .hb-pop.leaving { scale: 0.985; box-shadow: 0 0 0 transparent; transition: scale 120ms ease, box-shadow 120ms ease; }
${R} .hb-pop-lens, ${R} .hb-pop-tint, ${R} .hb-pop-rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
${R} .hb-pop-lens { visibility: hidden; }
${R} .hb-pop.shown .hb-pop-lens { visibility: visible; }
${R} .hb-pop-tint { background: rgba(22,22,26,0.52); }
/* A bright wallpaper (Home's glass theme light): the board's 0.52 tint leaves white text at 4.2:1 and
 * the dim labels at 3:1 over white; 0.72 keeps them at 7:1 and 4.6:1 (as the menus' raised rule). */
${R}.theme-light .hb-pop-tint { background: rgba(22,22,26,0.72); }
${R} .hb-pop-rim { padding: 1px; background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.22)); ${RIM_MASK} }
${R} :is(.hb-pop-tint, .hb-pop-rim, .hb-pop-body) { opacity: 0; transition: opacity 90ms var(--expand); }
${R} .hb-pop.shown :is(.hb-pop-tint, .hb-pop-rim, .hb-pop-body) { opacity: 1; }
${R} .hb-pop.leaving :is(.hb-pop-tint, .hb-pop-rim, .hb-pop-body) { opacity: 0; transition: opacity 120ms ease; }
${R} .hb-pop-body { position: relative; height: 100%; padding: 16px; display: flex; flex-direction: column; }
${R} .hb-pop-head { height: 28px; display: flex; align-items: center; justify-content: space-between; }
${R} .hb-pop-title { font-size: 14px; font-weight: 600; }
${R} .hb-pop-close { width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.1); color: #fff; }
${R} .hb-pop-close:hover { background: rgba(255,255,255,0.16); }
${R} .hb-pop-close-ico, ${R} .hb-add-ico { display: flex; }
${R} .hb-popover { flex-grow: 1; min-height: 0; }
${R} .hb-popover .hb-tabs { margin-top: 14px; height: 32px; border-radius: 10px; }
${R} .hb-popover .vs-seg-btn { flex-grow: 1; flex-basis: 0; border-radius: 8px; color: rgba(255,255,255,0.72); }
${R} .hb-popover .vs-seg-btn:is([aria-selected="true"], :hover) { color: #fff; }
${R} .hb-popover .hb-panel { margin: 12px -10px 0 0; padding-right: 10px; height: 196px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.32) transparent; }
${R} .hb-popover .hb-face { aspect-ratio: auto; height: 94px; background: rgba(255,255,255,0.08); }
${R} .hb-popover .hb-face::after { display: none; }
${R} .hb-popover .hb-tile[aria-checked="true"] .hb-face { box-shadow: 0 0 0 2px #ffffff; }
${R} .hb-popover .hb-badge { right: 6px; top: 6px; background: #ffffff; color: #16181d; }
${R} .hb-popover .hb-note { margin: 4px 2px 0; }
${R} .hb-add { margin-top: 8px; height: 36px; flex-shrink: 0; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 13px; }
${R} .hb-add:hover { background: rgba(255,255,255,0.14); }
${R} .hb-add:active { background: rgba(255,255,255,0.08); }

@media (prefers-reduced-motion: reduce) {
  ${R} :is(.vs-sheet, .hb-pop) { scale: none !important; transition: box-shadow 150ms ease !important; }
  ${R} :is(.vs-tint, .vs-rim, .vs-body, .hb-pop-tint, .hb-pop-rim, .hb-pop-body, .vs-scrim, .hb-circle) { transition: opacity 150ms ease !important; transform: none !important; }
  ${R} .vs-pop { animation: none; }
  ${R} :is(.vs-knob, .vs-switch, .vs-style-preview, .hb-face) { transition: none !important; }
}
@media (forced-colors: active) {
  ${R} :is(.vs-tint, .hb-pop-tint) { background: Canvas; }
  ${R} :is(.vs-lens, .hb-pop-lens) { backdrop-filter: none !important; }
  ${R} :is(.vs-switch, .vs-check, .vs-radio) { forced-color-adjust: none; }
  /* Box-shadow outlines are dropped in contrast themes: draw the edges that tell controls and cards apart. */
  ${R} :is(.vs-sheet, .hb-pop) { outline: 1px solid CanvasText; }
  ${R} :is(.vs-search, .vs-card, .vs-dd, .vs-btn:not(.subtle), .vs-seg, .vs-capfield, .vs-pop, .vs-close, .vs-style-preview, .hb-face):not(:focus-visible) { outline: 1px solid CanvasText; outline-offset: -1px; }
  ${R} :is(.vs-card, .vs-rows) > :not([hidden]) ~ :not([hidden])::before { forced-color-adjust: none; background: GrayText; }
  ${R} :is(.vs-navitem[aria-current="page"], .vs-opt[aria-selected="true"])::before { forced-color-adjust: none; background: Highlight; }
  ${R} .vs-seg-btn:is([aria-checked="true"], [aria-selected="true"]) { forced-color-adjust: none; background: Highlight; color: HighlightText; }
  ${R} :is(.vs-style, .hb-tile)[aria-checked="true"] :is(.vs-style-preview, .hb-face) { outline: 3px solid Highlight; outline-offset: 2px; }
}
`;
