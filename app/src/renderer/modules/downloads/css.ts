// Styles for the downloads surfaces. Values come from the Downloads, DownloadsPopover,
// VideoDownload, VideoPicker, VideoStates and Home boards and the menu spec in DESIGN-NOTES.
export const CSS = `
.vd-glass > .lens, .vd-glass > .tint, .vd-glass > .rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.vd-glass > .rim { padding: 1px; -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.vd-panel :focus-visible, .vd-pop :focus-visible, .vd-picker :focus-visible, .vd-pill :focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.vd-panel, .vd-pop, .vd-picker, .vd-pill { color: #fff; }

/* ---- Panel (960×688 over the page dimmed 0.3) ---- */
.module-layer > .vd-scrim { position: fixed; inset: 0; background: rgba(8,8,12,0.3); opacity: 0; transition: opacity 240ms ease; }
.vd-scrim.in { opacity: 1; }
.module-layer > .vd-panel { position: fixed; border-radius: 22px; font-size: 13.5px; box-shadow: 0 40px 100px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
  opacity: 0; transform: scale(0.98); transition: opacity 160ms ease, transform 300ms var(--spring); }
.vd-panel.in { opacity: 1; transform: none; }
.vd-panel > .tint { background: rgba(20,20,24,0.62); }
.vd-panel > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2)); }
.vd-body { position: relative; height: 100%; display: flex; flex-direction: column; }
.vd-head { height: 48px; flex-shrink: 0; padding: 0 10px 0 18px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.vd-head h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
.vd-close { width: 30px; height: 30px; border-radius: 15px; background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; }
.vd-close:hover { background: rgba(255,255,255,0.14); }
.vd-close:active { background: rgba(255,255,255,0.06); }
.vd-main { flex: 1; min-height: 0; display: flex; }
.vd-nav { width: 216px; flex-shrink: 0; padding: 16px 12px; display: flex; flex-direction: column; overflow-y: auto; }
.vd-filters { display: flex; flex-direction: column; gap: 2px; }
.vd-search { height: 34px; margin-bottom: 12px; flex-shrink: 0; padding: 0 10px; border-radius: 8px; display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.07); box-shadow: inset 0 -1px 0 rgba(255,255,255,0.3); color: rgba(255,255,255,0.55); font-size: 13px; }
.vd-search:focus-within, .vd-field:focus-within { background: rgba(255,255,255,0.1); box-shadow: inset 0 -2px 0 #4cc2ff; }
.vd-search input, .vd-field input { flex: 1; min-width: 0; border: 0; padding: 0; outline: none; background: transparent; color: #fff; font: inherit; user-select: text; }
.vd-search input::placeholder, .vd-field input::placeholder { color: rgba(255,255,255,0.55); }
.vd-search input::-webkit-search-cancel-button { filter: invert(1); opacity: 0.6; }
.vd-filter { position: relative; width: 100%; height: 34px; flex-shrink: 0; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px; color: rgba(255,255,255,0.88); text-align: left; }
.vd-filter:hover { background: rgba(255,255,255,0.06); }
.vd-filter:active { background: rgba(255,255,255,0.04); }
.vd-filter[aria-current="page"] { background: rgba(255,255,255,0.1); color: #fff; }
.vd-filter[aria-current="page"]::before { content: ''; position: absolute; left: 0; top: 9px; width: 3px; height: 16px; border-radius: 2px; background: #4cc2ff; }
.vd-filter svg { flex-shrink: 0; }
.vd-filter .label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-filter .count { font-size: 12px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; }
.vd-nav-head { margin: 16px 10px 6px; font-size: 12px; color: rgba(255,255,255,0.55); }
.vd-divider { width: 1px; flex-shrink: 0; margin: 16px 0; background: rgba(255,255,255,0.08); }
.vd-content { flex: 1; min-width: 0; padding: 18px 20px 20px; display: flex; flex-direction: column; }
.vd-toolbar { height: 32px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.vd-summary { flex: 1; min-width: 0; font-size: 13px; color: rgba(255,255,255,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-btn { height: 32px; padding: 0 12px; border-radius: 6px; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
  font-size: 13px; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; flex-shrink: 0; }
.vd-btn:hover { background: rgba(255,255,255,0.12); }
.vd-btn:active { background: rgba(255,255,255,0.06); }
.vd-btn:disabled { opacity: 0.4; background: rgba(255,255,255,0.08); }
.vd-btn.accent { padding: 0 14px 0 10px; gap: 6px; background: #4cc2ff; color: #04121a; font-weight: 600; box-shadow: none; }
.vd-btn.accent:hover { background: #62c9ff; }
.vd-btn.accent:active { background: #42a8de; }
.vd-limit { padding: 0 10px 0 12px; }
.vd-add { margin-top: 12px; flex-shrink: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vd-add[hidden] { display: none; }
.vd-field { flex: 1; min-width: 240px; height: 32px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.07); box-shadow: inset 0 -1px 0 rgba(255,255,255,0.3); color: rgba(255,255,255,0.55); font-size: 13px; }
.vd-add-note { width: 100%; font-size: 12px; color: #ff99a4; }
.vd-add-note:empty { display: none; }
.vd-cols, .vd-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) 150px 76px 60px 64px; column-gap: 12px; align-items: center; }
.vd-panel.narrow .vd-cols, .vd-panel.narrow .vd-row { grid-template-columns: 32px minmax(0, 1fr) 110px 0 60px 64px; column-gap: 10px; }
.vd-panel.narrow .vd-row .speed, .vd-panel.narrow .vd-cols span:nth-child(4) { visibility: hidden; }
.vd-panel.narrow .vd-nav { width: 168px; }
.vd-cols { margin-top: 14px; height: 28px; flex-shrink: 0; padding: 0 12px; font-size: 12px; color: rgba(255,255,255,0.55); border-bottom: 1px solid rgba(255,255,255,0.08); }
.vd-list { flex: 1; min-height: 0; overflow-y: auto; padding-top: 4px; outline: none; }
.vd-row { position: relative; height: 50px; padding: 0 12px; border-radius: 8px; outline: none; }
.vd-row:hover { background: rgba(255,255,255,0.05); }
.vd-row[aria-selected="true"] { background: rgba(255,255,255,0.1); }
.vd-row[aria-selected="true"]::before { content: ''; position: absolute; left: 0; top: 17px; width: 3px; height: 16px; border-radius: 2px; background: #4cc2ff; }
.vd-panel .vd-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px #fff; }
.vd-tile { width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.03em; background: rgba(255,255,255,0.12); color: #fff; }
.vd-name { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vd-name .n { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-name .s { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-name .s.err { color: #ff99a4; }
.vd-progcell { min-width: 0; }
.vd-prog { display: flex; align-items: center; gap: 8px; }
.vd-prog[hidden], .vd-status[hidden] { display: none; }
.vd-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.14); overflow: hidden; }
.vd-bar > i { display: block; width: 0; height: 6px; border-radius: 3px; background: #4cc2ff; transition: width 250ms linear; }
.vd-bar.dim > i { background: rgba(255,255,255,0.45); }
.vd-pct { width: 30px; font-size: 12px; color: rgba(255,255,255,0.75); font-variant-numeric: tabular-nums; }
.vd-status { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: rgba(255,255,255,0.75); white-space: nowrap; overflow: hidden; }
.vd-status.err { color: #ff99a4; }
.vd-status.dim { color: rgba(255,255,255,0.45); }
.vd-cell { font-size: 13px; white-space: nowrap; overflow: hidden; font-variant-numeric: tabular-nums; }
.vd-cell.dim { color: rgba(255,255,255,0.45); }
.vd-cell.soft { font-size: 12.5px; color: rgba(255,255,255,0.75); }
.vd-cell.time.soft { font-size: 13px; }
.vd-acts { display: flex; justify-content: flex-end; gap: 4px; }
.vd-icon-btn { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.vd-icon-btn:hover { background: rgba(255,255,255,0.08); }
.vd-icon-btn:active { background: rgba(255,255,255,0.05); }
.vd-empty { padding: 56px 0; text-align: center; font-size: 13px; color: rgba(255,255,255,0.55); }
.vd-details { margin-top: 12px; flex-shrink: 0; padding: 14px 18px; border-radius: 10px; display: grid; grid-template-columns: 270px minmax(0, 1fr); column-gap: 28px;
  background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
.vd-details[hidden] { display: none; }
/* Narrow: the actions take their own row under the two columns, so the list keeps its height. */
.vd-panel.narrow .vd-details { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 16px; }
.vd-panel.narrow .vd-d-right { display: contents; }
.vd-panel.narrow .vd-facts { grid-column: 2; grid-row: 1; align-self: start; }
.vd-panel.narrow .vd-d-acts { grid-column: 1 / -1; grid-row: 2; }
.vd-panel.narrow .vd-d-note { display: none; }
.vd-d-left, .vd-d-right { min-width: 0; display: flex; flex-direction: column; }
.vd-d-title { font-size: 13px; font-weight: 600; }
.vd-d-cap { margin-top: 2px; font-size: 12px; color: rgba(255,255,255,0.6); }
.vd-d-cap.err { color: #ff99a4; }
.vd-segs { margin-top: 12px; height: 16px; display: flex; gap: 2px; }
.vd-segs[hidden] { display: none; }
.vd-segs > span { flex: 1; height: 16px; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,0.12); }
.vd-segs > span > i { display: block; width: 0; height: 16px; background: #4cc2ff; transition: width 250ms linear; }
.vd-segs.dim > span > i { background: rgba(255,255,255,0.45); }
.vd-d-note { margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.55); }
.vd-d-note[hidden] { display: none; }
.vd-stats { margin-top: 12px; display: flex; gap: 22px; font-size: 12px; }
.vd-stats > div { display: flex; flex-direction: column; gap: 2px; }
.vd-stats .k { color: rgba(255,255,255,0.55); }
.vd-stats .v { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.vd-panel.narrow .vd-stats { gap: 14px; }
.vd-facts { display: grid; grid-template-columns: 72px minmax(0, 1fr); row-gap: 8px; font-size: 13px; }
.vd-facts .k { font-size: 12px; color: rgba(255,255,255,0.55); line-height: 18px; }
.vd-facts .v { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text; }
.vd-d-acts { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.vd-d-btn { height: 30px; padding: 0 12px; border-radius: 6px; background: rgba(255,255,255,0.1); font-size: 12.5px; white-space: nowrap; }
.vd-d-btn:hover { background: rgba(255,255,255,0.15); }
.vd-d-btn:active { background: rgba(255,255,255,0.07); }
.vd-d-btn.danger { background: transparent; color: #ff99a4; box-shadow: inset 0 0 0 1px rgba(255,153,164,0.35); }
.vd-d-btn.danger:hover { background: rgba(255,153,164,0.1); }

/* ---- Ring (44 px, right 72, bottom 20) ---- */
.module-layer > .vd-ring { position: fixed; right: 72px; bottom: 20px; width: 44px; height: 44px; border-radius: 22px; box-shadow: var(--g-shadow);
  opacity: 0; transform: scale(0.6); pointer-events: none; transition: opacity 200ms ease, transform 320ms var(--spring); }
.module-layer > .vd-ring.shown { opacity: 1; transform: none; pointer-events: auto; }
.vd-ring > .tint { background: var(--g-tint); }
.vd-ring > .rim { background: var(--g-rim); }
.vd-ring button { position: relative; width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; color: var(--g-icon); }
.vd-ring button:hover { background: var(--g-hover); }
.vd-ring button:active { background: var(--g-press); }
.vd-ring button:focus-visible { outline: 2px solid var(--g-text); outline-offset: 2px; }
.vd-ring .track { stroke: currentColor; opacity: 0.22; }
.vd-ring .arc { stroke: currentColor; transition: stroke-dasharray 250ms linear; }
.vd-ring.indeterminate .spin { transform-origin: 17px 17px; animation: vd-spin 1.2s linear infinite; }
@keyframes vd-spin { to { transform: rotate(360deg); } }
body.element-fullscreen .vd-ring, body.element-fullscreen .vd-pill { display: none; }

/* ---- Flight to the ring ---- */
.module-layer > .vd-flight { position: fixed; left: 0; top: 0; width: 32px; height: 32px; border-radius: 16px; pointer-events: none; opacity: 0;
  box-shadow: 0 8px 20px rgba(0,0,0,0.28), 0 1px 2px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: #fff; }
.vd-flight > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.06)), rgba(16,16,20,0.38); }
.vd-flight > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.75), rgba(255,255,255,0.14) 30%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.4)); }
.vd-flight span { position: relative; font-size: 8.5px; font-weight: 700; letter-spacing: 0.03em; }

/* ---- Quick view above the ring (360 wide) ---- */
.module-layer > .vd-menu-catcher { position: fixed; inset: 0; }
.module-layer > .vd-pop { position: fixed; right: 20px; bottom: 76px; width: 360px; border-radius: 20px; outline: none;
  box-shadow: 0 24px 60px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25); transform-origin: calc(100% - 74px) calc(100% + 34px); }
.vd-pop > .tint { background: rgba(22,22,26,0.52); }
body.theme-light .vd-pop > .tint { background: rgba(22,22,26,0.7); }
.vd-pop > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.22)); }
.vd-pop-body { position: relative; padding: 14px; display: flex; flex-direction: column; }
.vd-pop-head { height: 32px; padding: 0 4px; display: flex; align-items: center; justify-content: space-between; }
.vd-pop-head b { font-size: 14px; font-weight: 600; }
.vd-pop-head span { font-size: 12px; color: rgba(255,255,255,0.6); }
.vd-pop-list { margin-top: 6px; display: flex; flex-direction: column; }
.vd-pop-row { height: 68px; padding: 8px 4px; display: flex; align-items: center; gap: 12px; border-radius: 10px; outline: none; }
.vd-pop-row.done { height: 48px; padding: 0 4px; }
.vd-pop-row:hover { background: rgba(255,255,255,0.05); }
.vd-pop-row:focus-visible { box-shadow: inset 0 0 0 2px #fff; outline: none; }
.vd-pop-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.vd-pop-row.done .vd-pop-info { gap: 2px; }
.vd-pop-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-pop-meta { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-pop-segs { height: 5px; display: flex; gap: 2px; }
.vd-pop-segs[hidden] { display: none; }
.vd-pop-segs > span { flex: 1; height: 5px; border-radius: 2px; overflow: hidden; background: rgba(255,255,255,0.14); }
.vd-pop-segs > span > i { display: block; width: 0; height: 5px; background: #4cc2ff; transition: width 250ms linear; }
.vd-pop-segs.dim > span > i { background: rgba(255,255,255,0.45); }
.vd-round { flex-shrink: 0; width: 28px; height: 28px; border-radius: 14px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; }
.vd-round:hover { background: rgba(255,255,255,0.16); }
.vd-round:active { background: rgba(255,255,255,0.07); }
.vd-pop-sep { height: 1px; margin: 0 4px; background: rgba(255,255,255,0.08); }
.vd-pop-empty { padding: 20px 4px; font-size: 13px; color: rgba(255,255,255,0.6); }
.vd-pop-open { margin-top: 12px; height: 36px; border-radius: 10px; background: rgba(255,255,255,0.1); font-size: 13px; }
.vd-pop-open:hover { background: rgba(255,255,255,0.15); }
.vd-pop-open:active { background: rgba(255,255,255,0.07); }

/* ---- Download this video: the pill (36 tall) ---- */
.module-layer > .vd-pill { position: fixed; left: 0; top: 0; height: 36px; border-radius: 18px; font-size: 13px; opacity: 0; pointer-events: none;
  box-shadow: 0 8px 22px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.35); transition: opacity 160ms ease; }
.module-layer > .vd-pill.shown { opacity: 1; pointer-events: auto; }
.vd-pill > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04)), rgba(16,16,20,0.3); }
.vd-pill > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.35)); }
.vd-pill.hot > .tint, .vd-pill.open > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.26), rgba(255,255,255,0.12)), rgba(16,16,20,0.3); }
.vd-pill.hot > .rim, .vd-pill.open > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.8), rgba(255,255,255,0.18) 30%, rgba(255,255,255,0.08) 60%, rgba(255,255,255,0.4)); }
.vd-pill.bright > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03)), rgba(16,16,20,0.58); }
.vd-pill.bright.hot > .tint, .vd-pill.bright.open > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.08)), rgba(16,16,20,0.5); }
.vd-pill.quiet > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03)), rgba(16,16,20,0.38); }
.vd-pill.quiet > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.55), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.25)); }
.vd-pill-face { position: relative; height: 36px; }
.vd-pill .div { width: 1px; height: 14px; flex-shrink: 0; background: rgba(255,255,255,0.3); }
.vd-pill-main { height: 36px; min-width: 168px; padding: 0 18px; border-radius: 18px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 600; white-space: nowrap; }
.vd-pill-main .q { font-weight: 500; color: rgba(255,255,255,0.78); }
.vd-pill-prog { height: 36px; min-width: 232px; padding: 0 6px 0 12px; display: flex; align-items: center; gap: 8px; white-space: nowrap; cursor: default; }
.vd-pill-prog svg { flex-shrink: 0; }
.vd-pill-prog .arc { transition: stroke-dasharray 250ms linear; }
.vd-pill-prog .pct { font-weight: 600; font-variant-numeric: tabular-nums; }
.vd-pill-prog .rest { color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; }
.vd-pill-prog .div { margin-left: auto; }
.vd-pill-small { width: 26px; height: 26px; flex-shrink: 0; border-radius: 13px; background: rgba(255,255,255,0.14); display: flex; align-items: center; justify-content: center; }
.vd-pill-small:hover { background: rgba(255,255,255,0.22); }
.vd-pill-note { height: 36px; min-width: 196px; padding: 0 18px; display: flex; align-items: center; justify-content: center; gap: 8px; color: rgba(255,255,255,0.82); white-space: nowrap; }
.vd-pill-note.saved { min-width: 168px; color: #fff; }
.vd-pill-note .b { font-weight: 600; }
.vd-pill-note .live { width: 8px; height: 8px; border-radius: 4px; background: #ff5a5f; }
.vd-pill-open { color: #9fe3ff; font-size: 13px; font-weight: 600; }
.vd-pill-open:hover { text-decoration: underline; }

/* ---- Quality picker (340 wide) ---- */
.module-layer > .vd-picker { position: fixed; width: 340px; border-radius: 18px; font-size: 13px; outline: none; max-height: calc(100vh - 16px);
  box-shadow: 0 24px 60px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3); transform-origin: right top; }
.vd-picker > .tint { background: rgba(22,22,26,0.62); }
body.theme-light .vd-picker > .tint { background: rgba(22,22,26,0.7); }
.vd-picker > .rim { background: linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.22)); }
.vd-pick-body { position: relative; padding: 14px; display: flex; flex-direction: column; max-height: calc(100vh - 16px); }
.vd-pick-head { height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 12px; }
.vd-thumb { flex-shrink: 0; width: 64px; height: 36px; border-radius: 6px; object-fit: cover; }
.vd-thumb[hidden] { display: none; }
.vd-pick-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vd-pick-title { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-pick-sub { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-opts { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.vd-group { margin: 12px 4px 4px; font-size: 12px; line-height: 18px; color: rgba(255,255,255,0.55); }
.vd-group ~ .vd-group { margin-top: 10px; }
.vd-opt { flex-shrink: 0; width: 100%; height: 36px; padding: 0 10px; border-radius: 10px; display: flex; align-items: center; gap: 10px; font-size: 13px; text-align: left; }
.vd-opt:hover { background: rgba(255,255,255,0.06); }
.vd-opt[aria-checked="true"] { background: rgba(255,255,255,0.12); box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.3); }
.vd-radio { position: relative; flex-shrink: 0; width: 16px; height: 16px; border-radius: 8px; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.5); }
.vd-opt[aria-checked="true"] .vd-radio { background: #4cc2ff; box-shadow: none; }
.vd-opt[aria-checked="true"] .vd-radio::after { content: ''; position: absolute; left: 5px; top: 5px; width: 6px; height: 6px; border-radius: 3px; background: #0b1a24; }
.vd-opt[aria-checked="true"] .lbl { font-weight: 600; }
.vd-opt .det { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; }
.vd-opt .size { margin-left: auto; color: rgba(255,255,255,0.6); white-space: nowrap; font-variant-numeric: tabular-nums; }
.vd-opt[aria-checked="true"] .size { color: rgba(255,255,255,0.75); }
.vd-pick-sep { flex-shrink: 0; height: 1px; margin: 10px 4px; background: rgba(255,255,255,0.1); }
.vd-saveto { height: 32px; flex-shrink: 0; padding: 0 10px; display: flex; align-items: center; gap: 8px; }
.vd-saveto .k { color: rgba(255,255,255,0.6); }
.vd-saveto .v { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vd-change { margin-left: auto; color: #9fe3ff; font-size: 13px; border-radius: 4px; }
.vd-change:hover { text-decoration: underline; }
.vd-terms { padding: 2px 10px 0; font-size: 12px; color: rgba(255,255,255,0.55); }
.vd-go { margin-top: 12px; flex-shrink: 0; height: 38px; border-radius: 10px; background: #4cc2ff; color: #04121a; font-size: 13.5px; font-weight: 600; }
.vd-go:hover { background: #62c9ff; }
.vd-go:active { background: #42a8de; }

/* ---- The download mark in the tab pill ---- */
#bar .item .dl-mark { margin-right: 4px; background: rgba(76,194,255,0.24); box-shadow: inset 0 0 0 1px rgba(76,194,255,0.45); color: #9fe3ff; }
#bar .item .dl-mark:hover { background: rgba(76,194,255,0.34); }
#bar[data-theme="light"] .item .dl-mark { background: rgba(0,95,184,0.12); box-shadow: inset 0 0 0 1px rgba(0,95,184,0.35); color: #005fb8; }
#bar[data-theme="light"] .item .dl-mark:hover { background: rgba(0,95,184,0.18); }
#bar .item .dl-mark[hidden], body.vt-find-face #bar .item.active .dl-mark { display: none; }

/* ---- Menus (frost; follow Vitre's appearance) ---- */
.module-layer > .vd-menu { position: fixed; padding: 6px; border-radius: 12px; font-size: 14px; line-height: 20px; outline: none; user-select: none;
  backdrop-filter: blur(24px) saturate(1.6); }
.vd-menu::before { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.vd-menu.dark { background: rgba(32,32,38,0.8); color: #fff; box-shadow: 0 18px 44px rgba(0,0,0,0.32), 0 1px 3px rgba(0,0,0,0.3); }
.vd-menu.dark::before { background: linear-gradient(165deg, rgba(255,255,255,0.45), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.18)); }
.vd-menu.light { background: rgba(249,249,251,0.8); color: rgba(0,0,0,0.9); box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 16px 40px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.1); }
.vd-menu.light::before { background: linear-gradient(165deg, rgba(255,255,255,0.9), rgba(255,255,255,0.3)); }
.vd-mi { position: relative; height: 34px; padding-right: 10px; display: flex; align-items: center; border-radius: 6px; outline: none; white-space: nowrap; }
.vd-mi-icon { width: 38px; padding-left: 10px; flex-shrink: 0; display: flex; align-items: center; opacity: 0.85; }
.vd-mi-label { flex: 1; }
.vd-mi-accel { margin-left: 32px; font-size: 12px; }
.vd-menu.dark .vd-mi-accel { color: rgba(255,255,255,0.7); }
.vd-menu.light .vd-mi-accel { color: rgba(0,0,0,0.62); }
.vd-menu.dark .vd-mi.sel { background: rgba(255,255,255,0.12); box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.22); }
.vd-menu.light .vd-mi.sel { background: rgba(0,0,0,0.06); }
.vd-menu.dark .vd-mi.sel:active { background: rgba(255,255,255,0.08); }
.vd-mi.sel:active .vd-mi-label { opacity: 0.8; }
.vd-mi[aria-disabled="true"] { opacity: 0.36; }
.vd-menu.dark .vd-mi[aria-disabled="true"].sel { background: rgba(255,255,255,0.05); box-shadow: none; }
.vd-menu.light .vd-mi[aria-disabled="true"].sel { background: rgba(0,0,0,0.03); }
.vd-sep { height: 1px; margin: 4px 6px; }
.vd-menu.dark .vd-sep { background: rgba(255,255,255,0.1); }
.vd-menu.light .vd-sep { background: rgba(0,0,0,0.08); }
.vd-menu.keys .vd-ak { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .module-layer > .vd-panel, .module-layer > .vd-scrim, .module-layer > .vd-ring, .module-layer > .vd-pill { transition: opacity 150ms ease !important; transform: none !important; }
  .vd-bar > i, .vd-segs > span > i, .vd-pop-segs > span > i, .vd-ring .arc, .vd-pill-prog .arc { transition: none; }
  .vd-ring.indeterminate .spin { animation: none; }
}
@media (forced-colors: active) {
  .vd-panel, .vd-pop, .vd-picker, .vd-pill, .vd-menu, .vd-ring { forced-color-adjust: auto; border: 1px solid CanvasText; background: Canvas; }
  .vd-glass > .lens, .vd-glass > .tint, .vd-glass > .rim { display: none; }
}
`;
