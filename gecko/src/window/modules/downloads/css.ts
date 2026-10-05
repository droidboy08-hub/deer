// Styles for the downloads surfaces. Values come from the Downloads, DownloadsPopover,
// VideoDownload, VideoPicker, VideoStates and Home boards and the menu spec in DESIGN-NOTES; ported
// from app/src/renderer/modules/downloads/css.ts. Everything is scoped under #vitre-root (b.css
// applies to all of browser.xhtml). The glass structure (.glass > .lens/.tint/.rim) is the core's
// (skin/glass.css); these rules give each surface its own tint, rim, size and place, with one more
// class than the core's so they win whatever the sheet order.
export const CSS = `
#vitre-root .vd-panel, #vitre-root .vd-pop, #vitre-root .vd-picker, #vitre-root .vd-pill, #vitre-root .vd-quit { color: #fff; }
#vitre-root .vd-panel :focus-visible, #vitre-root .vd-pop :focus-visible, #vitre-root .vd-picker :focus-visible,
#vitre-root .vd-pill :focus-visible, #vitre-root .vd-quit :focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
#vitre-root .vd-panel input, #vitre-root .vd-quit input { font: inherit; }
#vitre-root .vd-panel button, #vitre-root .vd-pop button, #vitre-root .vd-picker button, #vitre-root .vd-quit button { color: inherit; }

/* ---- Panel (960x688 over the page dimmed 0.3) ---- */
#vitre-root .module-layer > .vd-scrim { position: fixed; inset: 0; background: rgba(8,8,12,0.3); opacity: 0; transition: opacity 240ms ease; }
#vitre-root .module-layer > .vd-scrim.in { opacity: 1; }
#vitre-root .module-layer > .vd-panel.glass { position: fixed; border-radius: 22px; font-size: 13.5px; box-shadow: 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
  scale: 0.98; transition: scale 300ms var(--spring); }
#vitre-root .vd-panel.glass.in { scale: 1; }
#vitre-root .vd-panel.glass > .tint { background: rgba(20,20,24,0.62); }
#vitre-root .vd-panel.glass > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2)); }
#vitre-root .vd-body { position: relative; height: 100%; display: flex; flex-direction: column; transition: opacity 160ms ease; }
#vitre-root .vd-panel:not(.in) .vd-body { opacity: 0; }
#vitre-root .vd-head { height: 48px; flex-shrink: 0; padding: 0 10px 0 18px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
#vitre-root .vd-head h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
#vitre-root .vd-close { width: 30px; height: 30px; border-radius: 15px; background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; }
#vitre-root .vd-close:hover { background: rgba(255,255,255,0.14); }
#vitre-root .vd-close:active { background: rgba(255,255,255,0.06); }
#vitre-root .vd-main { flex: 1; min-height: 0; display: flex; }
#vitre-root .vd-nav { width: 216px; flex-shrink: 0; padding: 16px 12px; display: flex; flex-direction: column; overflow-y: auto; }
/* Scrolling areas: a thin light thumb on no track, as the Settings panel (never the default black track). */
/* Scrollers carry the board's 2 px overlay thumb (src/window/scrollthumb.ts; colour --vt-thumb). */
#vitre-root .vd-panel, #vitre-root .vd-picker { --vt-thumb: rgba(255,255,255,0.4); }
#vitre-root .vd-filters { display: flex; flex-direction: column; gap: 2px; }
#vitre-root .vd-search { height: 34px; margin-bottom: 12px; flex-shrink: 0; padding: 0 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.07); box-shadow: inset 0 -1px 0 rgba(255,255,255,0.3); color: rgba(255,255,255,0.55); font-size: 13px; }
#vitre-root .vd-search:focus-within, #vitre-root .vd-field:focus-within { background: rgba(255,255,255,0.1); box-shadow: inset 0 -2px 0 #4cc2ff; }
#vitre-root .vd-search input, #vitre-root .vd-field input { flex: 1; min-width: 0; border: 0; padding: 0; outline: none; background: transparent; color: #fff; font: inherit; user-select: text; -moz-user-select: text; }
#vitre-root .vd-search input::placeholder, #vitre-root .vd-field input::placeholder { color: rgba(255,255,255,0.55); opacity: 1; }
/* The field's own accent underline is its focus mark. */
#vitre-root .vd-search input:focus-visible, #vitre-root .vd-field input:focus-visible { outline: none; }
/* .vd-panel too: it must outrank "#vitre-root .vd-panel button { color: inherit }" (board: 0.88). */
#vitre-root .vd-panel .vd-filter { position: relative; width: 100%; height: 34px; flex-shrink: 0; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px; color: rgba(255,255,255,0.88); text-align: left; }
#vitre-root .vd-filter:hover { background: rgba(255,255,255,0.06); }
#vitre-root .vd-filter:active { background: rgba(255,255,255,0.04); }
#vitre-root .vd-filter[aria-current="page"] { background: rgba(255,255,255,0.1); color: #fff; }
#vitre-root .vd-filter[aria-current="page"]::before { content: ''; position: absolute; left: 0; top: 9px; width: 3px; height: 16px; border-radius: 2px; background: #4cc2ff; }
#vitre-root .vd-filter svg { flex-shrink: 0; }
#vitre-root .vd-filter .label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-filter .count { font-size: 12px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; }
#vitre-root .vd-nav-head { margin: 16px 10px 6px; font-size: 12px; color: rgba(255,255,255,0.55); }
#vitre-root .vd-divider { width: 1px; flex-shrink: 0; margin: 16px 0; background: rgba(255,255,255,0.08); }
#vitre-root .vd-content { flex: 1; min-width: 0; padding: 18px 20px 20px; display: flex; flex-direction: column; }
#vitre-root .vd-toolbar { height: 32px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
#vitre-root .vd-summary { flex: 1; min-width: 0; font-size: 13px; color: rgba(255,255,255,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-btn { height: 32px; padding: 0 12px; border-radius: 6px; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
  font-size: 13px; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; flex-shrink: 0; }
#vitre-root .vd-btn:hover { background: rgba(255,255,255,0.12); }
#vitre-root .vd-btn:active { background: rgba(255,255,255,0.06); }
#vitre-root .vd-btn:disabled { opacity: 0.4; background: rgba(255,255,255,0.08); }
#vitre-root .vd-btn.accent { padding: 0 14px 0 10px; gap: 6px; background: #4cc2ff; color: #04121a; font-weight: 600; box-shadow: none; }
#vitre-root .vd-btn.accent:hover { background: #62c9ff; }
#vitre-root .vd-btn.accent:active { background: #42a8de; }
#vitre-root .vd-limit { padding: 0 10px 0 12px; }
#vitre-root .vd-add { margin-top: 12px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#vitre-root .vd-field { flex: 1; min-width: 240px; height: 32px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.07); box-shadow: inset 0 -1px 0 rgba(255,255,255,0.3); color: rgba(255,255,255,0.55); font-size: 13px; }
#vitre-root .vd-add-note { width: 100%; font-size: 12px; color: #ff99a4; }
#vitre-root .vd-add-note:empty { display: none; }
#vitre-root .vd-cols, #vitre-root .vd-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) 150px 76px 60px 64px; column-gap: 12px; align-items: center; }
/* Narrow: a slimmer sidebar whose labels ("Downloading", "Compressed") still fit beside the counts. */
#vitre-root .vd-cols { margin-top: 14px; height: 28px; flex-shrink: 0; padding: 0 12px; font-size: 12px; color: rgba(255,255,255,0.55); border-bottom: 1px solid rgba(255,255,255,0.08); }
#vitre-root .vd-list { flex: 1; min-height: 0; overflow-y: auto; padding-top: 4px; outline: none; }
#vitre-root .vd-row { position: relative; height: 50px; padding: 0 12px; border-radius: 8px; outline: none; }
#vitre-root .vd-row:hover { background: rgba(255,255,255,0.05); }
#vitre-root .vd-row[aria-selected="true"] { background: rgba(255,255,255,0.1); }
#vitre-root .vd-row[aria-selected="true"]::before { content: ''; position: absolute; left: 0; top: 17px; width: 3px; height: 16px; border-radius: 2px; background: #4cc2ff; }
#vitre-root .vd-panel .vd-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px #fff; }
#vitre-root .vd-tile { width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.03em; background: rgba(255,255,255,0.12); color: #fff; }
#vitre-root .vd-name { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
#vitre-root .vd-name .n { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-name .s { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-name .s.err { color: #ff99a4; }
#vitre-root .vd-progcell { min-width: 0; }
#vitre-root .vd-prog { display: flex; align-items: center; gap: 8px; }
#vitre-root .vd-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.14); overflow: hidden; }
#vitre-root .vd-bar > i { display: block; width: 0; height: 6px; border-radius: 3px; background: #4cc2ff; transition: width 250ms linear; }
#vitre-root .vd-bar.dim > i { background: rgba(255,255,255,0.45); }
#vitre-root .vd-pct { width: 30px; font-size: 12px; color: rgba(255,255,255,0.75); font-variant-numeric: tabular-nums; }
#vitre-root .vd-status { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: rgba(255,255,255,0.75); white-space: nowrap; overflow: hidden; }
#vitre-root .vd-status.err { color: #ff99a4; }
#vitre-root .vd-status.dim { color: rgba(255,255,255,0.45); }
#vitre-root .vd-cell { font-size: 13px; white-space: nowrap; overflow: hidden; font-variant-numeric: tabular-nums; }
#vitre-root .vd-cell.dim { color: rgba(255,255,255,0.45); }
#vitre-root .vd-cell.soft { font-size: 12.5px; color: rgba(255,255,255,0.75); }
#vitre-root .vd-cell.time.soft { font-size: 13px; }
#vitre-root .vd-acts { display: flex; justify-content: flex-end; gap: 4px; }
#vitre-root .vd-icon-btn { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
#vitre-root .vd-icon-btn:hover { background: rgba(255,255,255,0.08); }
#vitre-root .vd-icon-btn:active { background: rgba(255,255,255,0.05); }
#vitre-root .vd-empty { padding: 56px 0; text-align: center; font-size: 13px; color: rgba(255,255,255,0.55); }
#vitre-root .vd-details { margin-top: 12px; flex-shrink: 0; padding: 14px 18px; border-radius: 10px; display: grid; grid-template-columns: 270px minmax(0, 1fr); column-gap: 28px;
  background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
#vitre-root .vd-d-left, #vitre-root .vd-d-right { min-width: 0; display: flex; flex-direction: column; }
#vitre-root .vd-d-title { font-size: 13px; font-weight: 600; }
#vitre-root .vd-d-cap { margin-top: 2px; font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-d-cap.err { color: #ff99a4; }
#vitre-root .vd-segs { margin-top: 12px; height: 16px; display: flex; gap: 2px; }
#vitre-root .vd-segs > span { flex: 1; height: 16px; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,0.12); }
#vitre-root .vd-segs > span > i { display: block; width: 0; height: 16px; background: #4cc2ff; transition: width 250ms linear; }
#vitre-root .vd-segs.dim > span > i { background: rgba(255,255,255,0.45); }
#vitre-root .vd-d-note { margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.55); }
#vitre-root .vd-stats { margin-top: 12px; display: flex; gap: 22px; font-size: 12px; }
#vitre-root .vd-stats > div { display: flex; flex-direction: column; gap: 2px; }
#vitre-root .vd-stats .k { color: rgba(255,255,255,0.55); }
#vitre-root .vd-stats .v { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
#vitre-root .vd-facts { display: grid; grid-template-columns: 72px minmax(0, 1fr); row-gap: 8px; font-size: 13px; }
#vitre-root .vd-facts .k { font-size: 12px; color: rgba(255,255,255,0.55); line-height: 18px; }
#vitre-root .vd-facts .v { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text; -moz-user-select: text; }
#vitre-root .vd-d-acts { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
#vitre-root .vd-d-btn { height: 30px; padding: 0 12px; border-radius: 6px; background: rgba(255,255,255,0.1); font-size: 12.5px; white-space: nowrap; }
#vitre-root .vd-d-btn:hover { background: rgba(255,255,255,0.15); }
#vitre-root .vd-d-btn:active { background: rgba(255,255,255,0.07); }
#vitre-root .vd-d-btn.danger { background: transparent; color: #ff99a4; box-shadow: inset 0 0 0 1px rgba(255,153,164,0.35); }
#vitre-root .vd-d-btn.danger:hover { background: rgba(255,153,164,0.1); }

/* ---- Ring (44 px, right 72, bottom 20) ---- */
#vitre-root .module-layer > .vd-ring.glass { position: fixed; left: auto; top: auto; right: 72px; bottom: 20px; width: 44px; height: 44px; border-radius: 22px;
  transform: scale(0.6); visibility: hidden; pointer-events: none; transition: transform 320ms var(--spring), visibility 0s linear 200ms; }
#vitre-root .module-layer > .vd-ring.glass.shown { transform: none; visibility: visible; pointer-events: auto; transition: transform 320ms var(--spring), visibility 0s; }
#vitre-root .vd-ring button { position: relative; width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; color: var(--g-icon); }
#vitre-root .vd-ring button:hover { background: var(--g-hover); }
#vitre-root .vd-ring button:active { background: var(--g-press); }
#vitre-root .vd-ring .track { stroke: currentColor; opacity: 0.22; }
#vitre-root .vd-ring .arc { stroke: currentColor; transition: stroke-dasharray 250ms linear; }
#vitre-root .vd-ring.indeterminate .spin { transform-origin: 17px 17px; animation: vd-spin 1.2s linear infinite; }
@keyframes vd-spin { to { transform: rotate(360deg); } }
#vitre-root.element-fullscreen .vd-ring, #vitre-root.element-fullscreen .vd-pill { display: none; }
/* The address field dims the page (omni-scrim): the pill belongs to the page and must not float over
   the dim (its layer, made after boot at z 9, would paint above it). The ring is chrome: it stays. */
#vitre-root.omni-open .module-layer > .vd-pill.glass, #vitre-root.omni-open .module-layer > .vd-pill.glass.shown { visibility: hidden; pointer-events: none; }

/* ---- Flight to the ring ---- */
#vitre-root .module-layer > .vd-flight.glass { position: fixed; left: 0; top: 0; width: 32px; height: 32px; border-radius: 16px; pointer-events: none;
  box-shadow: 0 8px 20px rgba(0,0,0,0.28), 0 1px 2px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: #fff; }
#vitre-root .vd-flight.glass > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.06)), rgba(16,16,20,0.38); }
#vitre-root .vd-flight.glass > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.75), rgba(255,255,255,0.14) 30%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.4)); }
#vitre-root .vd-flight span { position: relative; font-size: 8.5px; font-weight: 700; letter-spacing: 0.03em; }

/* ---- Quick view above the ring (360 wide, board DownloadsPopover) ---- */
#vitre-root .module-layer > .vd-menu-catcher { position: fixed; inset: 0; }
#vitre-root .module-layer > .vd-pop.glass { position: fixed; left: auto; top: auto; right: 20px; bottom: 76px; width: 360px; border-radius: 20px; outline: none;
  box-shadow: 0 24px 60px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25); transform-origin: calc(100% - 74px) calc(100% + 34px); }
#vitre-root .vd-pop.glass > .tint { background: rgba(22,22,26,0.52); }
#vitre-root.theme-light .vd-pop.glass > .tint { background: rgba(22,22,26,0.7); }
#vitre-root .vd-pop.glass > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.22)); }
#vitre-root .vd-pop-body { position: relative; padding: 14px; display: flex; flex-direction: column; }
#vitre-root .vd-pop-head { height: 32px; padding: 0 4px; display: flex; align-items: center; justify-content: space-between; }
#vitre-root .vd-pop-head b { font-size: 14px; font-weight: 600; }
#vitre-root .vd-pop-head span { font-size: 12px; color: rgba(255,255,255,0.6); }
#vitre-root .vd-pop-list { margin-top: 6px; display: flex; flex-direction: column; }
#vitre-root .vd-pop-row { height: 68px; padding: 8px 4px; display: flex; align-items: center; gap: 12px; border-radius: 10px; outline: none; }
#vitre-root .vd-pop-row.done { height: 48px; padding: 0 4px; }
#vitre-root .vd-pop-row:hover { background: rgba(255,255,255,0.05); }
#vitre-root .vd-pop-row:focus-visible { box-shadow: inset 0 0 0 2px #fff; outline: none; }
#vitre-root .vd-pop-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
#vitre-root .vd-pop-row.done .vd-pop-info { gap: 2px; }
#vitre-root .vd-pop-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-pop-meta { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-pop-segs { height: 5px; display: flex; gap: 2px; }
#vitre-root .vd-pop-segs > span { flex: 1; height: 5px; border-radius: 2px; overflow: hidden; background: rgba(255,255,255,0.14); }
#vitre-root .vd-pop-segs > span > i { display: block; width: 0; height: 5px; background: #4cc2ff; transition: width 250ms linear; }
#vitre-root .vd-pop-segs.dim > span > i { background: rgba(255,255,255,0.45); }
#vitre-root .vd-round { flex-shrink: 0; width: 28px; height: 28px; border-radius: 14px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; }
#vitre-root .vd-round:hover { background: rgba(255,255,255,0.16); }
#vitre-root .vd-round:active { background: rgba(255,255,255,0.07); }
#vitre-root .vd-pop-sep { height: 1px; margin: 0 4px; background: rgba(255,255,255,0.08); }
#vitre-root .vd-pop-empty { padding: 20px 4px; font-size: 13px; color: rgba(255,255,255,0.6); }
#vitre-root .vd-pop-open { margin-top: 12px; height: 36px; border-radius: 10px; background: rgba(255,255,255,0.1); font-size: 13px; }
#vitre-root .vd-pop-open:hover { background: rgba(255,255,255,0.15); }
#vitre-root .vd-pop-open:active { background: rgba(255,255,255,0.07); }

/* ---- Download this video: the pill (36 tall) ---- */
#vitre-root .module-layer > .vd-pill.glass { position: fixed; left: 0; top: 0; height: 36px; border-radius: 18px; font-size: 13px; visibility: hidden; pointer-events: none;
  box-shadow: 0 8px 22px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.35); }
#vitre-root .module-layer > .vd-pill.glass.shown { visibility: visible; pointer-events: auto; }
#vitre-root .vd-pill.glass > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04)), rgba(16,16,20,0.3); }
#vitre-root .vd-pill.glass > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.35)); }
#vitre-root .vd-pill.glass.hot > .tint, #vitre-root .vd-pill.glass.open > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.26), rgba(255,255,255,0.12)), rgba(16,16,20,0.3); }
#vitre-root .vd-pill.glass.hot > .rim, #vitre-root .vd-pill.glass.open > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.8), rgba(255,255,255,0.18) 30%, rgba(255,255,255,0.08) 60%, rgba(255,255,255,0.4)); }
#vitre-root .vd-pill.glass.bright > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03)), rgba(16,16,20,0.58); }
#vitre-root .vd-pill.glass.bright.hot > .tint, #vitre-root .vd-pill.glass.bright.open > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.08)), rgba(16,16,20,0.5); }
#vitre-root .vd-pill.glass.quiet > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03)), rgba(16,16,20,0.38); }
#vitre-root .vd-pill.glass.quiet > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.55), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.25)); }
#vitre-root .vd-pill-face { position: relative; height: 36px; }
#vitre-root .vd-pill .div { width: 1px; height: 14px; flex-shrink: 0; background: rgba(255,255,255,0.3); }
#vitre-root .vd-pill-main { height: 36px; min-width: 168px; padding: 0 18px; border-radius: 18px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 600; white-space: nowrap; color: #fff; }
#vitre-root .vd-pill-main .q { font-weight: 500; color: rgba(255,255,255,0.78); }
#vitre-root .vd-pill-prog { height: 36px; min-width: 232px; padding: 0 6px 0 12px; display: flex; align-items: center; gap: 8px; white-space: nowrap; cursor: default; }
#vitre-root .vd-pill-prog svg { flex-shrink: 0; }
#vitre-root .vd-pill-prog .arc { transition: stroke-dasharray 250ms linear; }
#vitre-root .vd-pill-prog .pct { font-weight: 600; font-variant-numeric: tabular-nums; }
#vitre-root .vd-pill-prog .rest { color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; }
#vitre-root .vd-pill-prog .div { margin-left: auto; }
#vitre-root .vd-pill-small { width: 26px; height: 26px; flex-shrink: 0; border-radius: 13px; background: rgba(255,255,255,0.14); display: flex; align-items: center; justify-content: center; color: #fff; }
#vitre-root .vd-pill-small:hover { background: rgba(255,255,255,0.22); }
#vitre-root .vd-pill-note { height: 36px; min-width: 196px; padding: 0 18px; display: flex; align-items: center; justify-content: center; gap: 8px; color: rgba(255,255,255,0.82); white-space: nowrap; }
#vitre-root .vd-pill-note.saved { min-width: 168px; color: #fff; }
#vitre-root .vd-pill-note .b { font-weight: 600; }
#vitre-root .vd-pill-note .live { width: 8px; height: 8px; border-radius: 4px; background: #ff5a5f; }
#vitre-root .vd-pill-open { color: #9fe3ff; font-size: 13px; font-weight: 600; }
#vitre-root .vd-pill-open:hover { text-decoration: underline; }

/* ---- The note under the tab pill when the mark finds nothing to save ---- */
#vitre-root .module-layer > .vd-note.glass { position: fixed; border-radius: 14px; color: #fff; font-size: 13px; pointer-events: none;
  box-shadow: 0 16px 40px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3); }
#vitre-root .vd-note.glass > .tint { background: rgba(22,22,26,0.62); }
#vitre-root .vd-note-body { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 10px 16px; white-space: nowrap; }
#vitre-root .vd-note-body .b { font-weight: 600; }
#vitre-root .vd-note-body .d { color: rgba(255,255,255,0.72); }
#vitre-root .vd-note-act { pointer-events: auto; align-self: flex-start; margin-top: 8px; height: 28px; padding: 0 12px; border-radius: 6px; border: 0;
  background: #4cc2ff; color: #0b0b0d; font: 600 12.5px 'Segoe UI Variable Text', 'Segoe UI', sans-serif; cursor: default; }
#vitre-root .vd-note-act:hover { background: #7fd5ff; }

/* ---- Quality picker (340 wide, board VideoPicker) ---- */
#vitre-root .module-layer > .vd-picker.glass { position: fixed; width: 340px; border-radius: 18px; font-size: 13px; outline: none; max-height: calc(100vh - 16px);
  box-shadow: 0 24px 60px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3); transform-origin: right top; }
#vitre-root .vd-picker.glass > .tint { background: rgba(22,22,26,0.62); }
#vitre-root.theme-light .vd-picker.glass > .tint { background: rgba(22,22,26,0.7); }
#vitre-root .vd-picker.glass > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.22)); }
#vitre-root .vd-pick-body { position: relative; padding: 14px; display: flex; flex-direction: column; max-height: calc(100vh - 16px); }
#vitre-root .vd-pick-head { height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 12px; }
#vitre-root .vd-thumb { flex-shrink: 0; width: 64px; height: 36px; border-radius: 6px; }
#vitre-root .vd-pick-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
#vitre-root .vd-pick-title { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-pick-sub { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vd-opts { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
#vitre-root .vd-group { margin: 12px 4px 4px; font-size: 12px; line-height: 18px; color: rgba(255,255,255,0.55); }
#vitre-root .vd-group ~ .vd-group { margin-top: 10px; }
#vitre-root .vd-opt { flex-shrink: 0; width: 100%; height: 36px; padding: 0 10px; border-radius: 10px; display: flex; align-items: center; gap: 10px; font-size: 13px; text-align: left; }
#vitre-root .vd-opt:hover { background: rgba(255,255,255,0.06); }
#vitre-root .vd-opt[aria-checked="true"] { background: rgba(255,255,255,0.12); box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.3); }
#vitre-root .vd-radio { position: relative; flex-shrink: 0; width: 16px; height: 16px; border-radius: 8px; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.5); }
#vitre-root .vd-opt[aria-checked="true"] .vd-radio { background: #4cc2ff; box-shadow: none; }
#vitre-root .vd-opt[aria-checked="true"] .vd-radio::after { content: ''; position: absolute; left: 5px; top: 5px; width: 6px; height: 6px; border-radius: 3px; background: #0b1a24; }
#vitre-root .vd-opt[aria-checked="true"] .lbl { font-weight: 600; }
#vitre-root .vd-opt .det { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; }
#vitre-root .vd-opt .size { margin-left: auto; color: rgba(255,255,255,0.6); white-space: nowrap; font-variant-numeric: tabular-nums; }
#vitre-root .vd-opt[aria-checked="true"] .size { color: rgba(255,255,255,0.75); }
#vitre-root .vd-pick-sep { flex-shrink: 0; height: 1px; margin: 10px 4px; background: rgba(255,255,255,0.1); }
#vitre-root .vd-saveto { height: 32px; flex-shrink: 0; padding: 0 10px; display: flex; align-items: center; gap: 8px; }
#vitre-root .vd-saveto .k { color: rgba(255,255,255,0.6); }
#vitre-root .vd-saveto .v { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Two classes: "#vitre-root .vd-picker button { color: inherit }" above would otherwise win (board: #9fe3ff). */
#vitre-root .vd-picker .vd-change { margin-left: auto; color: #9fe3ff; font-size: 13px; border-radius: 4px; }
#vitre-root .vd-change:hover { text-decoration: underline; }
#vitre-root .vd-terms, #vitre-root .vd-mux { padding: 2px 10px 0; font-size: 12px; line-height: 16px; color: rgba(255,255,255,0.55); }
#vitre-root .vd-go { margin-top: 12px; flex-shrink: 0; height: 38px; border-radius: 10px; background: #4cc2ff; font-size: 13.5px; font-weight: 600; }
#vitre-root .vd-picker .vd-go { color: #04121a; }
#vitre-root .vd-go:hover { background: #62c9ff; }
#vitre-root .vd-go:active { background: #42a8de; }

/* ---- The download mark in the tab pill (board VideoStates, "In the tab bar") ---- */
#vitre-root #vitre-bar .item .dl-mark:not(.empty) { background: rgba(76,194,255,0.24); box-shadow: inset 0 0 0 1px rgba(76,194,255,0.45); color: #9fe3ff; }
#vitre-root #vitre-bar .item .dl-mark:not(.empty):hover { background: rgba(76,194,255,0.34); }
#vitre-root.theme-light #vitre-bar .item .dl-mark:not(.empty) { background: rgba(0,95,184,0.12); box-shadow: inset 0 0 0 1px rgba(0,95,184,0.35); color: #005fb8; }
#vitre-root.theme-light #vitre-bar .item .dl-mark:not(.empty):hover { background: rgba(0,95,184,0.18); }

/* ---- The quit prompt (400 wide) ---- */
#vitre-root .module-layer > .vd-quit.glass { position: fixed; left: calc(50% - 200px); top: calc(50% - 110px); width: 400px; border-radius: 20px;
  box-shadow: 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3); }
#vitre-root .vd-quit.glass > .tint { background: rgba(20,20,24,0.72); }
#vitre-root .vd-quit.glass > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2)); }
#vitre-root .vd-quit-body { position: relative; padding: 22px 22px 18px; }
#vitre-root .vd-quit h2 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
#vitre-root .vd-quit p { margin: 8px 0 0; font-size: 13px; line-height: 19px; color: rgba(255,255,255,0.72); }
#vitre-root .vd-quit-acts { margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px; }

/* ---- Fallback menu (when the menus module is not in the build): frost, Deer's appearance ---- */
#vitre-root .module-layer > .vd-menu { position: fixed; padding: 6px; border-radius: 12px; font-size: 14px; line-height: 20px; outline: none; user-select: none;
  backdrop-filter: blur(24px) saturate(1.6); }
#vitre-root .vd-menu::before { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }
#vitre-root .vd-menu.dark { background: rgba(32,32,38,0.8); color: #fff; box-shadow: 0 18px 44px rgba(0,0,0,0.32), 0 1px 3px rgba(0,0,0,0.3); }
#vitre-root .vd-menu.dark::before { background: linear-gradient(165deg, rgba(255,255,255,0.45), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.18)); }
#vitre-root .vd-menu.light { background: rgba(249,249,251,0.8); color: rgba(0,0,0,0.9); box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 16px 40px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.1); }
#vitre-root .vd-menu.light::before { background: linear-gradient(165deg, rgba(255,255,255,0.9), rgba(255,255,255,0.3)); }
#vitre-root .vd-mi { position: relative; height: 34px; padding-right: 10px; display: flex; align-items: center; border-radius: 6px; outline: none; white-space: nowrap; }
#vitre-root .vd-mi-icon { width: 38px; padding-left: 10px; flex-shrink: 0; display: flex; align-items: center; opacity: 0.85; }
#vitre-root .vd-mi-label { flex: 1; }
#vitre-root .vd-mi-accel { margin-left: 32px; font-size: 12px; }
#vitre-root .vd-menu.dark .vd-mi-accel { color: rgba(255,255,255,0.7); }
#vitre-root .vd-menu.light .vd-mi-accel { color: rgba(0,0,0,0.62); }
#vitre-root .vd-menu.dark .vd-mi.sel { background: rgba(255,255,255,0.12); box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.22); }
#vitre-root .vd-menu.light .vd-mi.sel { background: rgba(0,0,0,0.06); }
#vitre-root .vd-mi[aria-disabled="true"] { opacity: 0.36; }
#vitre-root .vd-sep { height: 1px; margin: 4px 6px; }
#vitre-root .vd-menu.dark .vd-sep { background: rgba(255,255,255,0.1); }
#vitre-root .vd-menu.light .vd-sep { background: rgba(0,0,0,0.08); }
#vitre-root .vd-menu.keys .vd-ak { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }

/* ---- Settings › Video downloads ---- */
#vitre-root .vd-ff-missing { color: #ff99a4; }

/* ---- Light mode: the panel and the quit prompt follow Settings › Appearance › Mode as the Settings
   panel does (Windows 11 light: Settings' LIGHT tokens, settings/styles.ts). The quick view and the
   picker are popovers over the page and stay dark glass, as Home's background popover does. ---- */
@media (prefers-color-scheme: light) {
  #vitre-root .vd-panel, #vitre-root .vd-quit { color: rgba(0,0,0,0.9); --vt-thumb: rgba(0,0,0,0.4); }
  #vitre-root .vd-panel :focus-visible, #vitre-root .vd-quit :focus-visible { outline-color: rgba(0,0,0,0.9); }
  #vitre-root .vd-panel.glass > .tint, #vitre-root .vd-quit.glass > .tint { background: rgba(243,243,246,0.8); }
  #vitre-root .vd-panel.glass > .rim, #vitre-root .vd-quit.glass > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.4) 30%, rgba(255,255,255,0.25) 60%, rgba(255,255,255,0.7)); }
  #vitre-root .module-layer > .vd-panel.glass, #vitre-root .module-layer > .vd-quit.glass { box-shadow: 0 40px 100px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.16); }
  #vitre-root .vd-head { border-bottom-color: rgba(0,0,0,0.08); }
  #vitre-root .vd-close { background: rgba(255,255,255,0.72); }
  #vitre-root .vd-close:hover { background: rgba(249,249,249,0.55); }
  #vitre-root .vd-close:active { background: rgba(249,249,249,0.32); }
  #vitre-root .vd-search, #vitre-root .vd-field { background: rgba(255,255,255,0.7); box-shadow: inset 0 -1px 0 rgba(0,0,0,0.45); color: rgba(0,0,0,0.5); }
  #vitre-root .vd-search:focus-within, #vitre-root .vd-field:focus-within { background: #fff; box-shadow: inset 0 -2px 0 #005fb8; }
  #vitre-root .vd-search input, #vitre-root .vd-field input { color: rgba(0,0,0,0.9); }
  #vitre-root .vd-search input::placeholder, #vitre-root .vd-field input::placeholder { color: rgba(0,0,0,0.5); }
  #vitre-root .vd-panel .vd-filter { color: rgba(0,0,0,0.86); }
  #vitre-root .vd-filter:hover { background: rgba(0,0,0,0.05); }
  #vitre-root .vd-filter:active { background: rgba(0,0,0,0.03); }
  #vitre-root .vd-filter[aria-current="page"] { background: rgba(0,0,0,0.06); color: rgba(0,0,0,0.9); }
  #vitre-root .vd-filter[aria-current="page"]::before, #vitre-root .vd-row[aria-selected="true"]::before { background: #005fb8; }
  #vitre-root .vd-filter .count, #vitre-root .vd-name .s, #vitre-root .vd-d-cap { color: rgba(0,0,0,0.6); }
  #vitre-root .vd-nav-head, #vitre-root .vd-cols, #vitre-root .vd-empty, #vitre-root .vd-d-note, #vitre-root .vd-stats .k, #vitre-root .vd-facts .k { color: rgba(0,0,0,0.55); }
  #vitre-root .vd-divider { background: rgba(0,0,0,0.08); }
  #vitre-root .vd-cols { border-bottom-color: rgba(0,0,0,0.08); }
  #vitre-root .vd-summary, #vitre-root .vd-pct, #vitre-root .vd-status, #vitre-root .vd-cell.soft, #vitre-root .vd-quit p { color: rgba(0,0,0,0.68); }
  #vitre-root .vd-status.dim, #vitre-root .vd-cell.dim { color: rgba(0,0,0,0.45); }
  #vitre-root .vd-add-note, #vitre-root .vd-name .s.err, #vitre-root .vd-status.err, #vitre-root .vd-d-cap.err { color: #c42b1c; }
  #vitre-root .vd-panel .vd-btn, #vitre-root .vd-quit .vd-btn, #vitre-root .vd-d-btn { background: rgba(255,255,255,0.72); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.09); }
  #vitre-root .vd-panel .vd-btn:hover, #vitre-root .vd-quit .vd-btn:hover, #vitre-root .vd-d-btn:hover { background: rgba(249,249,249,0.55); }
  #vitre-root .vd-panel .vd-btn:active, #vitre-root .vd-quit .vd-btn:active, #vitre-root .vd-d-btn:active { background: rgba(249,249,249,0.32); }
  #vitre-root .vd-panel .vd-btn.accent, #vitre-root .vd-quit .vd-btn.accent { background: #005fb8; color: #fff; box-shadow: none; }
  #vitre-root .vd-panel .vd-btn.accent:hover, #vitre-root .vd-quit .vd-btn.accent:hover { background: #1a6fc0; }
  #vitre-root .vd-panel .vd-btn.accent:active, #vitre-root .vd-quit .vd-btn.accent:active { background: #004a91; }
  #vitre-root .vd-d-btn.danger { background: transparent; color: #c42b1c; box-shadow: inset 0 0 0 1px rgba(196,43,28,0.35); }
  #vitre-root .vd-d-btn.danger:hover { background: rgba(196,43,28,0.08); }
  #vitre-root .vd-row:hover { background: rgba(0,0,0,0.04); }
  #vitre-root .vd-row[aria-selected="true"] { background: rgba(0,0,0,0.06); }
  #vitre-root .vd-panel .vd-row:focus-visible { box-shadow: inset 0 0 0 2px rgba(0,0,0,0.9); }
  #vitre-root .vd-tile { background: rgba(0,0,0,0.06); color: rgba(0,0,0,0.8); }
  #vitre-root .vd-bar { background: rgba(0,0,0,0.1); }
  #vitre-root .vd-segs > span { background: rgba(0,0,0,0.08); }
  #vitre-root .vd-bar > i, #vitre-root .vd-segs > span > i { background: #005fb8; }
  #vitre-root .vd-bar.dim > i, #vitre-root .vd-segs.dim > span > i { background: rgba(0,0,0,0.35); }
  #vitre-root .vd-icon-btn:hover { background: rgba(0,0,0,0.05); }
  #vitre-root .vd-icon-btn:active { background: rgba(0,0,0,0.03); }
  #vitre-root .vd-details { background: rgba(255,255,255,0.62); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06); }
}

@media (prefers-reduced-motion: reduce) {
  #vitre-root .module-layer > .vd-panel.glass, #vitre-root .module-layer > .vd-scrim, #vitre-root .module-layer > .vd-ring.glass { transition: opacity 150ms ease, visibility 0s !important; transform: none !important; }
  #vitre-root .vd-bar > i, #vitre-root .vd-segs > span > i, #vitre-root .vd-pop-segs > span > i, #vitre-root .vd-ring .arc, #vitre-root .vd-pill-prog .arc { transition: none; }
  #vitre-root .vd-ring.indeterminate .spin { animation: none; }
}
`;
