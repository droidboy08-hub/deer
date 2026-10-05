// Switcher CSS. Sizes, colours and timings come from the TabSwitcher, TabMotion, TabOverview,
// TabSwitcherStrip and SwitcherKeys boards.
const CLEAR_RIM = 'linear-gradient(165deg, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.35))';
const FROST_RIM = 'linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2))';

export const CSS = `
#layer-switcher > .sw {
  position: fixed; inset: 0; pointer-events: none; -webkit-app-region: no-drag;
  color: #fff; font-family: var(--font); font-size: 13.5px;
}
#layer-switcher > .sw > .sw-view { position: absolute; inset: 0; pointer-events: none; }
.sw-view > * { pointer-events: auto; }
.sw.sw-out { opacity: 0; transition: opacity 120ms ease; }
#layer-switcher > .sw-holder { position: fixed; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
.sw-bg { position: absolute; inset: 0; overflow: hidden; }
/* First layout of a view: everything starts in place, nothing slides there. */
.sw-still, .sw-still * { transition: none !important; }

.sw-glass > .lens, .sw-glass > .tint, .sw-glass > .rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.sw-glass > .rim {
  padding: 1px;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
.sw-glass.morphing > .lens { backdrop-filter: blur(10px) saturate(1.6) !important; }

/* The search row: in the deck's dock, the grid's field and above the strip. */
.sw-fieldrow { position: absolute; inset: 0; display: flex; align-items: center; gap: 10px; padding: 0 18px; }
.sw-fieldrow > .ico { display: flex; color: rgba(255,255,255,0.7); flex-shrink: 0; }
.sw-input {
  flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: none; background: transparent;
  color: #fff; font: 14px var(--font); caret-color: #4cc2ff; user-select: text;
}
.sw-input:focus-visible { outline: none; }
.sw-input::placeholder { color: rgba(255,255,255,0.6); }
.sw-input::selection { background: rgba(76,194,255,0.42); }
.sw-count { flex-shrink: 0; font-size: 12.5px; color: rgba(255,255,255,0.55); white-space: nowrap; font-variant-numeric: tabular-nums; }
.sw-count:empty { display: none; }

.sw mark { background: rgba(76,194,255,0.35); color: #fff; border-radius: 3px; padding: 0 1px; }
.sw .fav { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sw .fav img { border-radius: 4px; object-fit: contain; }
.sw-media { position: absolute; inset: 0; background: #000; }
.sw-media > img { display: block; width: 100%; height: 100%; object-fit: cover; }
.sw-media.home { background: radial-gradient(120% 90% at 30% 20%, #3c4d6b, #1d2230 60%, #141720); }
.sw-ph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #1c1d22; }
.sw-ph > .ring { width: 56px; height: 56px; border-radius: 28px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }
.sw-rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.sw-flight {
  position: fixed !important; left: 0 !important; top: 0 !important; margin: 0 !important; z-index: 30;
  overflow: hidden; pointer-events: none; box-shadow: 0 30px 80px rgba(0,0,0,0.45) !important;
}

/* ---- Deck ---- */
.sw-deck .sw-bg { background: #0b0c10; }
.sw-wall {
  position: absolute; left: -48px; top: -48px; width: calc(100% + 96px); height: calc(100% + 96px);
  object-fit: cover; filter: blur(44px) brightness(0.5) saturate(1.25);
}
div.sw-wall { background: radial-gradient(120% 90% at 30% 20%, #3c4d6b, #1d2230 60%, #141720); }
.sw-stage { position: absolute; inset: 0; }
.sw-dcard { position: absolute; left: 0; top: 0; transition: transform 560ms var(--spring), opacity 320ms ease; }
.sw-dcard.sw-gone { pointer-events: none; }
.sw-dcard-in { position: absolute; inset: 0; }
.sw-dlabel {
  position: absolute; left: 0; right: 0; top: -48px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 10px;
  white-space: nowrap; transition: opacity 260ms ease;
}
/* Neighbours' labels sit off-screen in the board; long titles would otherwise peek in at the edge. */
.sw-dcard:not(.sel) .sw-dlabel { opacity: 0; }
.sw-dlabel .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 15px; font-weight: 600; }
.sw-dlabel .h { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: rgba(255,255,255,0.55); }
.sw-dface {
  position: absolute; inset: 0; border-radius: 22px; overflow: hidden; background: #000;
  box-shadow: 0 30px 80px rgba(0,0,0,0.5); transition: border-radius 360ms var(--expand);
}
.sw-dface .sw-ph > .ring { width: 72px; height: 72px; border-radius: 36px; }
.sw-sheen {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 32%); transition: opacity 200ms ease;
}
.sw-dim { position: absolute; inset: 0; background: #0b0c10; opacity: 0; pointer-events: none; transition: opacity 420ms ease; }
.sw-dcard:not(.sel) .sw-dim { opacity: 0.5; }
.sw-dface > .sw-rim { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18); transition: opacity 200ms ease; }
.sw-expanding .sw-dcard { transition: transform 560ms var(--spring), opacity 220ms ease; }
.sw-expanding .sw-dcard.sel .sw-dface { border-radius: 0; }
.sw-expanding .sw-dcard.sel .sw-sheen, .sw-expanding .sw-dcard.sel .sw-rim, .sw-expanding .sw-dlabel { opacity: 0 !important; }

.sw-dock {
  position: absolute; left: 0; top: 0; height: 52px; border-radius: 26px; z-index: 20;
  box-shadow: 0 14px 34px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.3);
  transition: left 420ms var(--spring), width 420ms var(--spring), transform 320ms var(--spring), opacity 220ms ease;
}
.sw-dock > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)); }
.sw-dock > .rim { background: ${CLEAR_RIM}; }
.sw-dots { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; transition: opacity 200ms ease; }
.sw-dots-row { position: absolute; left: 0; top: 0; height: 52px; padding: 0 10px; display: flex; align-items: center; gap: 8px; transition: transform 420ms var(--spring); }
.sw-dot {
  flex-shrink: 0; width: 40px; height: 40px; padding: 0 14px 0 12px; border-radius: 20px; overflow: hidden;
  display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: #fff;
  transition: width 420ms var(--spring), background-color 300ms ease, opacity 220ms ease, margin 220ms ease, padding 220ms ease;
}
.sw-dot.sel { width: 216px; background-color: rgba(255,255,255,0.2); }
.sw-dot:not(.sel):hover { background-color: rgba(255,255,255,0.1); }
.sw-dot .t { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: 0; transition: opacity 240ms ease; }
.sw-dot.sel .t { opacity: 1; }
.sw-dot.sw-gone { width: 0; padding: 0; margin-left: -8px; opacity: 0; transition-duration: 220ms; transition-timing-function: ease; }
.sw-dockfield { position: absolute; inset: 0; opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
.sw-dock.latched .sw-dots { opacity: 0; pointer-events: none; }
.sw-dock.latched .sw-dockfield { opacity: 1; pointer-events: auto; transition-delay: 80ms; }
.sw-expanding .sw-dock { opacity: 0; transform: translateY(18px); }

/* ---- Grid ---- */
.sw-grid .sw-bg { background: rgba(10,10,14,0.5); backdrop-filter: blur(36px) saturate(1.2); }
.sw-gfield {
  position: absolute; top: 12px; height: 44px; border-radius: 22px; z-index: 3;
  box-shadow: 0 10px 28px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.3); transition: opacity 220ms ease;
}
.sw-gfield > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05)); }
.sw-gfield > .rim { background: ${CLEAR_RIM}; }
.sw-gscroll { position: absolute; left: 0; right: 0; top: 68px; bottom: 0; overflow-x: hidden; overflow-y: auto; z-index: 2; transition: opacity 220ms ease; }
.sw-gscroll::-webkit-scrollbar { width: 12px; }
.sw-gscroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 6px; border: 4px solid transparent; background-clip: padding-box; }
.sw-gcontent { position: relative; }
.sw-gcard { position: absolute; left: 0; top: 0; width: 291px; transition: transform 420ms var(--spring); }
.sw-gin { position: relative; }
.sw-gface {
  position: relative; width: 291px; height: 182px; border-radius: 12px; overflow: hidden; background: #000;
  box-shadow: 0 16px 40px rgba(0,0,0,0.45); transition: box-shadow 160ms ease;
}
.sw-gcard.sel .sw-gface { box-shadow: 0 0 0 3px #4cc2ff, 0 0 0 7px rgba(76,194,255,0.22), 0 16px 40px rgba(0,0,0,0.45); }
.sw-gface > .sw-rim, .sw-sface > .sw-rim { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16); }
.sw-gface .sw-ph > .ring { width: 48px; height: 48px; border-radius: 24px; }
.sw-x {
  position: absolute; right: 8px; top: 8px; width: 24px; height: 24px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; background: rgba(24,24,28,0.86); color: #fff;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 2px 6px rgba(0,0,0,0.3); opacity: 0; transition: opacity 120ms ease;
}
.sw-gcard:hover .sw-x { opacity: 1; }
.sw-x:hover { background: rgba(48,48,54,0.92); }
.sw-glabel { margin-top: 12px; display: flex; align-items: flex-start; gap: 9px; }
.sw-glabel .fav { margin-top: 1px; }
.sw-glabel .txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.sw-glabel .t { font-size: 13px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-glabel .h { font-size: 12px; line-height: 16px; color: rgba(255,255,255,0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-gnew-wrap { position: absolute; left: 0; top: 0; width: 291px; transition: transform 420ms var(--spring), opacity 220ms ease; }
.sw-gnew-wrap[hidden] { display: none; }
.sw-gnew {
  width: 291px; height: 182px; border: 1.5px dashed rgba(255,255,255,0.3); border-radius: 12px; background: rgba(255,255,255,0.04);
  display: flex; align-items: center; justify-content: center; color: #fff; transition: background-color 120ms ease;
}
.sw-gnew:hover { background: rgba(255,255,255,0.08); }
.sw-gnew > span { width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.12); }
.sw-gnew > span svg { width: 20px; height: 20px; }
.sw-gnew-label { margin-top: 12px; font-size: 13px; color: rgba(255,255,255,0.75); }
.sw-grid.sw-expanding .sw-gscroll, .sw-grid.sw-expanding .sw-gfield { opacity: 0; }

/* ---- Strip ---- */
.sw-strip .sw-bg { background: rgba(8,8,12,0.22); }
.sw-panel {
  position: absolute; left: 0; top: 0; height: 212px; border-radius: 24px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3);
  transition: left 420ms var(--spring), width 420ms var(--spring), opacity 220ms ease;
}
.sw-panel > .tint, .sw-sfield > .tint { background: rgba(20,20,24,0.58); }
.sw-panel > .rim, .sw-sfield > .rim { background: ${FROST_RIM}; }
.sw-sclip { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
.sw-srow { position: absolute; left: 0; top: 0; height: 100%; transition: transform 420ms var(--spring); }
.sw-scard { position: absolute; left: 0; top: 0; width: 192px; transition: transform 420ms var(--spring); }
.sw-sin { position: relative; }
.sw-sface { position: relative; width: 192px; height: 120px; border-radius: 10px; overflow: hidden; background: #000; transition: box-shadow 160ms ease; }
.sw-scard.sel .sw-sface { box-shadow: 0 0 0 3px #4cc2ff, 0 0 0 7px rgba(76,194,255,0.22); }
.sw-sface .sw-ph > .ring { width: 40px; height: 40px; border-radius: 20px; }
.sw-slabel { margin-top: 10px; display: flex; align-items: center; gap: 8px; font-size: 12.5px; line-height: 17px; color: rgba(255,255,255,0.75); white-space: nowrap; }
.sw-slabel .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sw-scard.sel .sw-slabel { color: #fff; }
.sw-sfield {
  position: absolute; left: 0; top: 0; height: 44px; border-radius: 22px; box-shadow: 0 6px 14px rgba(0,0,0,0.35);
  opacity: 0; transform: translateY(6px); pointer-events: none !important;
  transition: opacity 200ms ease, transform 320ms var(--spring), left 420ms var(--spring), width 420ms var(--spring);
}
.sw-strip.latched .sw-sfield { opacity: 1; transform: none; pointer-events: auto !important; }
.sw-strip.sw-expanding .sw-panel, .sw-strip.sw-expanding .sw-sfield { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  #layer-switcher *, #layer-switcher .sw {
    transition-property: opacity !important; transition-duration: 150ms !important; transition-delay: 0ms !important;
    transition-timing-function: ease !important;
  }
  /* Cross-fades only: nothing that would jump without its slide. */
  .sw-expanding .sw-dock, .sw-sfield { transform: none; }
  .sw-expanding .sw-dcard.sel .sw-dface { border-radius: 22px; }
}
`;
