// Styles for the Settings panel, the background picker, Home's background circle and popover,
// and the background media in #home. Values come from the Settings, SettingsTabs, SettingsKeys,
// HomeBackground and Home boards; the light set follows Windows 11 light mode.

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
  --vs-check-line: rgba(255,255,255,0.6);
  --vs-check-bg: rgba(0,0,0,0.12);
  --vs-knob-off: rgba(255,255,255,0.8);
  --vs-tile-line: rgba(255,255,255,0.12);
  --vs-error: #ff99a4;
  --vs-focus: #ffffff;
  --vs-scroll: rgba(255,255,255,0.32);
  --vs-pop: rgba(44,44,50,0.94);
  --vs-pop-line: rgba(255,255,255,0.1);
  --vs-opt-hover: rgba(255,255,255,0.08);
  --vs-tint: rgba(20,20,24,0.62);
  --vs-rim: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2));
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
  --vs-check-line: rgba(0,0,0,0.45);
  --vs-check-bg: rgba(0,0,0,0.02);
  --vs-knob-off: rgba(0,0,0,0.62);
  --vs-tile-line: rgba(0,0,0,0.1);
  --vs-error: #c42b1c;
  --vs-focus: rgba(0,0,0,0.9);
  --vs-scroll: rgba(0,0,0,0.3);
  --vs-pop: rgba(249,249,251,0.96);
  --vs-pop-line: rgba(0,0,0,0.1);
  --vs-opt-hover: rgba(0,0,0,0.05);
  --vs-tint: rgba(243,243,246,0.8);
  --vs-rim: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.4) 30%, rgba(255,255,255,0.25) 60%, rgba(255,255,255,0.7));
`;

const RIM_MASK = `-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;`;

export const CSS = `
.vs-root { position: absolute; inset: 0; font-family: var(--font); font-size: 13.5px; color: var(--vs-text); ${DARK} }
.hb-pop { ${DARK} }
@media (prefers-color-scheme: light) { .vs-root { ${LIGHT} } }
.vs-root[hidden] { display: none; }
.vs-root button { color: inherit; }
.vs-root :focus-visible, .hb-pop :focus-visible, .hb-circle :focus-visible { outline: 2px solid var(--vs-focus, #fff); outline-offset: 1px; }
.vs-root :focus:not(:focus-visible), .hb-pop :focus:not(:focus-visible) { outline: none; }

/* Scrim, sheet and material */
.vs-scrim { position: absolute; inset: 0; background: rgba(8,8,12,0.3); opacity: 0; transition: opacity 200ms ease; }
.vs-root.open .vs-scrim { opacity: 1; }
.vs-drag { position: absolute; left: 0; right: 0; top: 0; height: 10px; -webkit-app-region: drag; }
.vs-sheet {
  position: absolute; width: 960px; height: 688px; border-radius: 22px; transform-origin: 50% 50%;
  box-shadow: 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
  opacity: 0; scale: 0.96; transition: opacity 160ms var(--expand), scale 280ms var(--spring);
}
.vs-root.open .vs-sheet { opacity: 1; scale: 1; }
.vs-root.closing .vs-sheet { opacity: 0; scale: 0.985; transition: opacity 140ms ease, scale 140ms ease; }
.vs-lens, .vs-tint, .vs-rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.vs-tint { background: var(--vs-tint); }
.vs-rim { padding: 1px; background: var(--vs-rim); ${RIM_MASK} }
.vs-body { position: relative; height: 100%; display: flex; flex-direction: column; }

/* Title bar */
.vs-titlebar { height: 48px; flex-shrink: 0; padding: 0 10px 0 18px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--vs-line); }
.vs-tico { display: flex; }
.vs-ttl { flex-grow: 1; font-size: 14px; font-weight: 600; }
.vs-close { width: 30px; height: 30px; border-radius: 15px; background: var(--vs-ctl); display: flex; align-items: center; justify-content: center; }
.vs-close:hover { background: var(--vs-ctl-hover); }
.vs-close:active { background: var(--vs-ctl-press); }

/* Sidebar */
.vs-cols { flex-grow: 1; min-height: 0; display: flex; }
.vs-nav { width: 216px; flex-shrink: 0; padding: 16px 12px; display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
.vs-search {
  height: 34px; margin-bottom: 12px; padding: 0 4px 0 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px;
  background: var(--vs-search-bg); box-shadow: inset 0 -1px 0 var(--vs-search-line); color: var(--vs-text3); font-size: 13px;
}
.vs-search:focus-within { background: var(--vs-search-focus); box-shadow: inset 0 -2px 0 var(--vs-accent); }
.vs-search-ico { display: flex; flex-shrink: 0; }
.vs-search input { flex-grow: 1; min-width: 0; height: 100%; border: 0; padding: 0; background: transparent; color: var(--vs-text); font: inherit; outline: none !important; user-select: text; caret-color: var(--vs-accent); }
.vs-search input::placeholder { color: var(--vs-text3); }
.vs-search input::-webkit-search-cancel-button { display: none; }
.vs-search input::selection { background: rgba(76,194,255,0.42); }
.vs-search-clear { width: 26px; height: 26px; border-radius: 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--vs-text2) !important; }
.vs-search-clear[hidden] { display: none; }
.vs-search-clear:hover { background: var(--vs-hover); }
.vs-search-clear svg { width: 10px; height: 10px; }
.vs-navitem { position: relative; height: 34px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px; color: var(--vs-nav) !important; text-align: left; white-space: nowrap; flex-shrink: 0; }
.vs-navitem:hover { background: var(--vs-hover); }
.vs-navitem:active { background: var(--vs-ctl-press); }
.vs-navitem[aria-current="page"] { background: var(--vs-active); color: var(--vs-text) !important; }
.vs-navitem[aria-current="page"]::before { content: ''; position: absolute; left: 0; top: 9px; width: 3px; height: 16px; border-radius: 2px; background: var(--vs-accent); }
.vs-navico { display: flex; flex-shrink: 0; }
.vs-vsep { width: 1px; flex-shrink: 0; margin: 16px 0; background: var(--vs-line); }

/* Page */
.vs-main { position: relative; flex-grow: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; border-bottom-right-radius: 22px; outline: none; }
.vs-content { padding: 16px 28px 18px; display: flex; flex-direction: column; }
.vs-h1 { margin: 0; font: 600 26px/34px 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; }
.vs-headrow { height: 34px; display: flex; align-items: center; gap: 16px; }
.vs-headrow .vs-h1 { flex-grow: 1; }
.vs-intro { margin: 2px 2px 0; font-size: 12.5px; line-height: 18px; color: var(--vs-intro); }
.vs-empty { margin-top: 12px; }
.vs-h2 { margin: 16px 0 8px 2px; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--vs-h2); }
.vs-h1 + .vs-h2, .vs-headrow + .vs-h2 { margin-top: 12px; }
.vs-h1 + .vs-card, .vs-headrow + .vs-card, .vs-intro + .vs-card { margin-top: 16px; }
.vs-card + .vs-card { margin-top: 8px; }
.vs-card { position: relative; border-radius: 10px; background: var(--vs-card); box-shadow: inset 0 0 0 1px var(--vs-card-line); }
.vs-card > *, .vs-rows > * { position: relative; }
.vs-card > :not([hidden]) ~ :not([hidden])::before, .vs-rows > :not([hidden]) ~ :not([hidden])::before {
  content: ''; position: absolute; top: 0; left: 16px; right: 0; height: 1px; background: var(--vs-sep);
}
.vs-card > :not([hidden]) ~ .has-ico:not([hidden])::before, .vs-rows > :not([hidden]) ~ .has-ico:not([hidden])::before { left: 52px; }
.vs-rows > .vs-block::before { display: none; }

/* Rows */
.vs-row { min-height: 56px; padding: 0 16px; display: flex; align-items: center; gap: 16px; }
.vs-row.compact { min-height: 44px; }
.vs-row[hidden] { display: none; }
.vs-ico { width: 20px; height: 20px; flex-shrink: 0; display: flex; color: var(--vs-icon); }
.vs-text { flex-grow: 1; min-width: 0; padding: 9px 0; display: flex; flex-direction: column; gap: 2px; }
.vs-title { font-size: 14px; line-height: 20px; }
.vs-desc { font-size: 12px; line-height: 16px; color: var(--vs-text2); }
.vs-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
.vs-pickrow { cursor: default; }

/* Switch */
.vs-toggle { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.vs-state { min-width: 22px; text-align: right; font-size: 13px; color: var(--vs-state); }
.vs-switch { position: relative; width: 40px; height: 20px; flex-shrink: 0; border-radius: 10px; background: var(--vs-check-bg); box-shadow: inset 0 0 0 1px var(--vs-check-line); transition: background 120ms ease, box-shadow 120ms ease; }
.vs-knob { position: absolute; top: 4px; left: 4px; width: 12px; height: 12px; border-radius: 6px; background: var(--vs-knob-off); transition: left 220ms var(--spring), top 120ms ease, width 120ms ease, height 120ms ease, background 120ms ease; }
.vs-switch:hover .vs-knob { top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 7px; }
.vs-switch[aria-checked="true"] { background: var(--vs-accent); box-shadow: none; }
.vs-switch[aria-checked="true"] .vs-knob { top: 3px; left: 23px; width: 14px; height: 14px; border-radius: 7px; background: var(--vs-on-accent); }
.vs-switch[aria-checked="true"]:hover { background: var(--vs-accent-hover); }

/* Segmented */
.vs-seg { height: 30px; padding: 2px; border-radius: 8px; display: flex; gap: 2px; flex-shrink: 0; background: var(--vs-ctl); }
.vs-seg-btn { padding: 0 14px; border-radius: 6px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; font-size: 12.5px; white-space: nowrap; color: var(--vs-seg-text) !important; }
.vs-seg-btn::after { content: attr(data-label); height: 0; overflow: hidden; visibility: hidden; font-weight: 600; } /* keeps the width when the label turns bold */
.vs-seg-btn:hover { background: var(--vs-hover); color: var(--vs-text) !important; }
.vs-seg-btn[aria-checked="true"], .vs-seg-btn[aria-selected="true"] { background: var(--vs-seg-on); color: var(--vs-text) !important; font-weight: 600; box-shadow: inset 0 0.5px 0 var(--vs-seg-on-line); }
@media (prefers-color-scheme: light) { .vs-root .vs-seg-btn[aria-checked="true"], .vs-root .vs-seg-btn[aria-selected="true"] { box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.08); } }

/* Drop-down and its list */
.vs-dd { height: 32px; max-width: 300px; padding: 0 10px 0 12px; border-radius: 6px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; background: var(--vs-ctl); box-shadow: inset 0 0 0 1px var(--vs-ctl-line); font-size: 13px; white-space: nowrap; }
.vs-dd:hover { background: var(--vs-ctl-hover); }
.vs-dd:active, .vs-dd[aria-expanded="true"] { background: var(--vs-ctl-press); }
.vs-dd-label { overflow: hidden; text-overflow: ellipsis; }
.vs-dd-chev { display: flex; color: var(--vs-text2); }
.vs-pop {
  position: absolute; z-index: 5; min-width: 120px; max-height: 360px; overflow-y: auto; padding: 4px; border-radius: 8px;
  background: var(--vs-pop); box-shadow: 0 0 0 1px var(--vs-pop-line), 0 16px 40px rgba(0,0,0,0.32), 0 1px 3px rgba(0,0,0,0.2);
  backdrop-filter: blur(24px) saturate(1.6); outline: none !important; animation: vs-pop-in 200ms var(--spring);
}
@keyframes vs-pop-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.vs-opt { position: relative; height: 32px; padding: 0 14px 0 16px; border-radius: 4px; display: flex; align-items: center; font-size: 13px; white-space: nowrap; }
.vs-opt[aria-selected="true"] { background: var(--vs-hover); }
.vs-opt.active { background: var(--vs-opt-hover); }
.vs-opt[aria-selected="true"].active { background: var(--vs-active); }
.vs-opt[aria-selected="true"]::before { content: ''; position: absolute; left: 0; top: 8px; width: 3px; height: 16px; border-radius: 2px; background: var(--vs-accent); }

/* Buttons */
.vs-btn { height: 32px; padding: 0 14px; border-radius: 6px; flex-shrink: 0; background: var(--vs-ctl); box-shadow: inset 0 0 0 1px var(--vs-ctl-line); font-size: 13px; white-space: nowrap; }
.vs-btn:hover { background: var(--vs-ctl-hover); }
.vs-btn:active { background: var(--vs-ctl-press); }
.vs-btn:disabled { opacity: 0.4; pointer-events: none; }
.vs-btn.accent { background: var(--vs-accent); box-shadow: none; color: var(--vs-on-accent) !important; font-weight: 600; }
.vs-btn.accent:hover { background: var(--vs-accent-hover); }
.vs-btn.subtle { height: 30px; margin-right: 6px; padding: 0 10px; background: transparent; box-shadow: none; color: var(--vs-subtle) !important; }
.vs-btn.subtle:hover { background: var(--vs-hover); }
.vs-link { padding: 4px 6px; border-radius: 4px; font-size: 13px; color: var(--vs-value) !important; white-space: nowrap; flex-shrink: 0; }
.vs-link:hover { background: var(--vs-hover); color: var(--vs-text) !important; }
.vs-link[hidden] { display: none; }
.vs-go { display: flex; align-items: center; gap: 6px; }
.vs-go span { display: flex; }

/* Check boxes and radios */
.vs-check, .vs-radio { width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--vs-check-bg); box-shadow: inset 0 0 0 1px var(--vs-check-line); color: transparent; }
.vs-check { border-radius: 4px; }
.vs-radio { position: relative; border-radius: 10px; }
.vs-check[aria-checked="true"], .vs-radio[aria-checked="true"] { background: var(--vs-accent); box-shadow: none; color: var(--vs-on-accent); }
.vs-radio[aria-checked="true"]::after { content: ''; width: 10px; height: 10px; border-radius: 5px; background: var(--vs-on-accent); transition: width 120ms ease, height 120ms ease; }
.vs-pickrow:hover .vs-radio[aria-checked="true"]::after { width: 12px; height: 12px; border-radius: 6px; }
.vs-pickrow:hover .vs-check:not([aria-checked="true"]), .vs-pickrow:hover .vs-radio:not([aria-checked="true"]) { background: var(--vs-hover); }
.vs-actions { min-height: 60px; justify-content: flex-end; }
.vs-status { flex-grow: 1; font-size: 12.5px; color: var(--vs-text2); }

/* Keyboard shortcuts */
.vs-key { font-size: 13px; color: var(--vs-value); white-space: nowrap; flex-shrink: 0; }
.vs-keyctl { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.vs-keybtn { margin-right: -8px; padding: 5px 8px; border-radius: 6px; font-size: 13px; color: var(--vs-value) !important; white-space: nowrap; }
.vs-keybtn:hover { background: var(--vs-hover); color: var(--vs-text) !important; }
.vs-rebind { position: relative; }
.vs-capture { flex-direction: column; align-items: stretch; gap: 0; padding: 0 16px 12px; }
.vs-capline { height: 46px; display: flex; align-items: center; gap: 16px; }
.vs-capline .vs-title { flex-grow: 1; }
.vs-capfield { width: 148px; height: 30px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; flex-shrink: 0; background: var(--vs-card); box-shadow: inset 0 0 0 1px var(--vs-accent); font-size: 13px; white-space: nowrap; overflow: hidden; outline: none !important; }
.vs-capfield.empty { color: var(--vs-text3); }
.vs-capmsg { display: flex; align-items: baseline; gap: 16px; font-size: 12px; line-height: 18px; }
.vs-refusal { flex-grow: 1; color: var(--vs-error); }
.vs-hint { color: var(--vs-text3); white-space: nowrap; }

/* Switcher style tiles */
.vs-block { padding: 0 16px 16px; }
.vs-styleblock { padding: 16px 16px 10px; }
.vs-styles { display: flex; gap: 20px; }
.vs-style { position: relative; width: 205px; display: flex; flex-direction: column; gap: 10px; text-align: left; border-radius: 10px; }
.vs-style:focus-visible { outline: none !important; }
.vs-style:focus-visible .vs-style-preview { outline: 2px solid var(--vs-focus); outline-offset: 7px; }
.vs-style-preview { position: relative; display: block; width: 205px; height: 120px; border-radius: 10px; overflow: hidden; background: #1a1b20; transition: box-shadow 160ms ease; }
.vs-style-preview::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px var(--vs-tile-line); pointer-events: none; }
.vs-style:hover .vs-style-preview::after { box-shadow: inset 0 0 0 1px var(--vs-search-line); }
.vs-style[aria-checked="true"] .vs-style-preview { box-shadow: 0 0 0 2px var(--vs-accent), 0 0 0 5px var(--vs-accent-soft); }
.vs-style-name { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 600; color: var(--vs-nav); }
.vs-style[aria-checked="true"] .vs-style-name { color: var(--vs-text); }
.vs-style-default { font-size: 12px; font-weight: 400; color: var(--vs-text3); }
.vs-note { margin: 10px 2px 0; font-size: 12.5px; line-height: 18px; color: var(--vs-intro); }
.hb-badge { position: absolute; right: 7px; top: 7px; width: 18px; height: 18px; border-radius: 9px; display: none; align-items: center; justify-content: center; background: var(--vs-accent); color: var(--vs-on-accent); pointer-events: none; }
[aria-checked="true"] > .hb-badge { display: flex; }

/* Background picker */
.hb-picker { display: flex; flex-direction: column; }
.hb-grid { display: grid; gap: 12px; }
.hb-grid[hidden] { display: none; }
.hb-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hb-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.hb-tile { position: relative; min-width: 0; display: flex; flex-direction: column; gap: 8px; text-align: left; border-radius: 10px; }
.hb-tile:focus-visible { outline: none !important; }
.hb-tile:focus-visible .hb-face { outline: 2px solid var(--vs-focus); outline-offset: 4px; }
.hb-face { position: relative; display: block; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; background: var(--vs-card); transition: box-shadow 160ms ease; }
.hb-face::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px var(--vs-tile-line); pointer-events: none; }
.hb-face img, .hb-face video { display: block; width: 100%; height: 100%; object-fit: cover; }
.hb-plain { background: radial-gradient(120% 90% at 30% 20%, #3c4d6b, #1d2230 60%, #141720); }
.hb-tile[aria-checked="true"] .hb-face { box-shadow: 0 0 0 2px var(--vs-accent), 0 0 0 5px var(--vs-accent-soft); }
.hb-cap { font-size: 12px; line-height: 16px; color: var(--vs-text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hb-tile[aria-checked="true"] .hb-cap { color: var(--vs-text); }
.hb-note { margin: 10px 2px 0; font-size: 12.5px; line-height: 18px; color: var(--vs-intro); }
.hb-note[hidden] { display: none; }
.hb-note.error { color: var(--vs-error); }
.hb-panel .hb-grid:not([hidden]) + .hb-note { margin-top: 12px; }

/* Home: the background circle and popover */
.hb-circle { right: 20px; bottom: 20px; width: 44px; height: 44px; transition: opacity 200ms ease, transform 320ms var(--spring); }
.hb-circle.off { opacity: 0; transform: scale(0.8); pointer-events: none; }
.hb-circle-face { position: absolute; inset: 0; border-radius: 22px; display: flex; align-items: center; justify-content: center; color: var(--g-icon); }
.hb-circle-face:hover { background: var(--g-hover); }
.hb-circle-face:active { background: var(--g-press); }
.hb-circle-face[aria-expanded="true"] { background: var(--g-press); }
.hb-pop {
  position: absolute; right: 20px; bottom: 76px; width: 340px; height: 358px; border-radius: 20px; color: #fff; font-size: 13px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25); transform-origin: 100% 100%;
  opacity: 0; scale: 0.96; transition: opacity 90ms var(--expand), scale 200ms var(--spring);
}
.hb-pop.shown { opacity: 1; scale: 1; }
.hb-pop.leaving { opacity: 0; scale: 0.985; transition: opacity 120ms ease, scale 120ms ease; }
.hb-pop-lens, .hb-pop-tint, .hb-pop-rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.hb-pop-tint { background: rgba(22,22,26,0.52); }
.hb-pop-rim { padding: 1px; background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.22)); ${RIM_MASK} }
.hb-pop-body { position: relative; height: 100%; padding: 16px; display: flex; flex-direction: column; }
.hb-pop-head { height: 28px; display: flex; align-items: center; justify-content: space-between; }
.hb-pop-title { font-size: 14px; font-weight: 600; }
.hb-pop-close { width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.1); color: #fff; }
.hb-pop-close:hover { background: rgba(255,255,255,0.16); }
.hb-popover { flex-grow: 1; min-height: 0; }
.hb-popover .hb-tabs { margin-top: 14px; height: 32px; border-radius: 10px; }
.hb-popover .vs-seg-btn { flex-grow: 1; flex-basis: 0; border-radius: 8px; color: rgba(255,255,255,0.72) !important; }
.hb-popover .vs-seg-btn[aria-selected="true"] { color: #fff !important; }
.hb-popover .hb-panel { margin: 12px -10px 0 0; padding-right: 10px; height: 196px; overflow-y: auto; }
.hb-popover .hb-face { aspect-ratio: auto; height: 94px; background: rgba(255,255,255,0.08); }
.hb-popover .hb-face::after { display: none; }
.hb-popover .hb-tile[aria-checked="true"] .hb-face { box-shadow: 0 0 0 2px #ffffff; }
.hb-popover .hb-badge { right: 6px; top: 6px; background: #ffffff; color: #16181d; }
.hb-popover .hb-note { margin: 4px 2px 0; }
.hb-add { margin-top: 8px; height: 36px; flex-shrink: 0; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 13px; }
.hb-add:hover { background: rgba(255,255,255,0.14); }
.hb-add:active { background: rgba(255,255,255,0.08); }
.hb-add-ico { display: flex; }

/* Scrollbars: thin, Windows 11 style */
.vs-root ::-webkit-scrollbar, .hb-pop ::-webkit-scrollbar { width: 10px; }
.vs-root ::-webkit-scrollbar-track, .hb-pop ::-webkit-scrollbar-track { background: transparent; }
.vs-root ::-webkit-scrollbar-button, .hb-pop ::-webkit-scrollbar-button { display: none; }
.vs-root ::-webkit-scrollbar-thumb, .hb-pop ::-webkit-scrollbar-thumb { border: 4px solid transparent; border-radius: 5px; background: var(--vs-scroll) content-box; }
.vs-root ::-webkit-scrollbar-thumb:hover, .hb-pop ::-webkit-scrollbar-thumb:hover { border-width: 3px; }

/* Home's own background */
#home .hb-media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 300ms ease; pointer-events: none; }
#home .hb-media.shown { opacity: 1; }
body.hb-custom #wallpaper, body.hb-none #wallpaper { display: none; }
body.hb-pending #wallpaper { visibility: hidden; }
body.hb-none #home { background: radial-gradient(120% 90% at 30% 20%, #3c4d6b, #1d2230 60%, #141720); }

@media (prefers-reduced-motion: reduce) {
  .vs-sheet, .vs-root.closing .vs-sheet, .hb-pop, .hb-pop.leaving { scale: none !important; transition: opacity 150ms ease !important; }
  .vs-scrim, .hb-circle, #home .hb-media { transition: opacity 150ms ease !important; transform: none !important; }
  .vs-pop { animation: vs-fade 150ms ease; }
  .vs-knob, .vs-switch, .vs-style-preview, .hb-face { transition: none !important; }
}
@keyframes vs-fade { from { opacity: 0; } to { opacity: 1; } }
@media (forced-colors: active) {
  .vs-tint, .hb-pop-tint { background: Canvas; }
  .vs-lens, .hb-pop-lens { backdrop-filter: none !important; }
  .vs-switch, .vs-check, .vs-radio { forced-color-adjust: none; }
}
`;
