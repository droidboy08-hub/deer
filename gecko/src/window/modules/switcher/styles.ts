// Switcher CSS. Sizes, colours and timings come from the TabSwitcher, TabMotion, TabOverview,
// TabSearch, TabSwitcherStrip and SwitcherKeys boards; ported from
// app/src/renderer/modules/switcher/styles.ts. Every selector starts with
// "#vitre-root #layer-switcher" so it outranks the shell's module-layer and .glass rules
// (skin/shell.css, skin/glass.css), which are author sheets that come later in the cascade.
const CLEAR_RIM = 'linear-gradient(165deg, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.35))';
const FROST_RIM = 'linear-gradient(165deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.2))';
const S = '#vitre-root #layer-switcher';

export const CSS = `
${S} > .sw {
  position: absolute; inset: 0; pointer-events: none;
  color: #fff; font-family: var(--font); font-size: 13.5px;
}
${S} > .sw > .sw-view { position: absolute; inset: 0; pointer-events: none; }
${S} .sw-view > * { pointer-events: auto; -moz-window-dragging: no-drag; }
${S} > .sw.sw-out { opacity: 0; transition: opacity 120ms ease; }
${S} > .sw-holder { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
${S} .sw-bg { position: absolute; inset: 0; overflow: hidden; }
/* First layout of a view: everything starts in place, nothing slides there. */
${S} .sw-still, ${S} .sw-still * { transition: none !important; }

${S} .sw-glass > .lens, ${S} .sw-glass > .tint, ${S} .sw-glass > .rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
${S} .sw-glass > .rim { padding: 1px; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; }

/* The search row: in the deck's dock, the grid's field and above the strip. */
${S} .sw-fieldrow { position: absolute; inset: 0; display: flex; align-items: center; gap: 10px; padding: 0 18px; }
${S} .sw-fieldrow > .ico { display: flex; color: rgba(255,255,255,0.7); flex-shrink: 0; }
${S} .sw-input {
  flex: 1; min-width: 0; height: 100%; padding: 0; margin: 0; border: 0; outline: none; background: transparent;
  color: #fff; font: 14px var(--font); caret-color: #4cc2ff; user-select: text; appearance: none;
}
${S} .sw-input:focus-visible { outline: none; }
/* Held (not latched) the field shows its placeholder only: the caret comes with the first character (SwitcherKeys). */
${S} > .sw:not(.latched) .sw-input { caret-color: transparent; }
${S} .sw-input::placeholder { color: rgba(255,255,255,0.6); opacity: 1; }
${S} .sw-input::selection { background: rgba(76,194,255,0.42); }
${S} .sw-count { flex-shrink: 0; font-size: 12.5px; color: rgba(255,255,255,0.55); white-space: nowrap; font-variant-numeric: tabular-nums; }
${S} .sw-count:empty { display: none; }

${S} mark { background: rgba(76,194,255,0.35); color: #fff; border-radius: 3px; padding: 0 1px; }
${S} .fav { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
${S} .fav img { display: block; width: 100%; height: 100%; border-radius: 4px; object-fit: contain; }
${S} .fav svg { display: block; }
${S} .sw-media { position: absolute; inset: 0; background: #000; overflow: hidden; }
${S} .sw-media > canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
${S} .sw-media.none > canvas { visibility: hidden; }
${S} .sw-ph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #1c1d22; }
${S} .sw-ph > .ring { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 28px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }
${S} .sw-rim { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
${S} .sw-flight {
  position: absolute !important; left: 0 !important; top: 0 !important; margin: 0 !important; z-index: 30;
  overflow: hidden; pointer-events: none; box-shadow: 0 30px 80px rgba(0,0,0,0.45) !important;
}

/* ---- Deck ---- */
${S} .sw-deck .sw-bg { background: #0b0c10; }
${S} .sw-wall {
  position: absolute; left: -48px; top: -48px; width: calc(100% + 96px); height: calc(100% + 96px);
  object-fit: cover; filter: blur(44px) brightness(0.5) saturate(1.25);
}
${S} div.sw-wall { background: #0b0c10; }
${S} .sw-stage { position: absolute; inset: 0; pointer-events: auto; }
${S} .sw-dcard { position: absolute; left: 0; top: 0; transition: transform 560ms var(--spring), opacity 320ms ease; }
${S} .sw-dcard.sw-gone { pointer-events: none; }
${S} .sw-dcard-in { position: absolute; inset: 0; }
${S} .sw-dlabel {
  position: absolute; left: 0; right: 0; top: -48px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 10px;
  white-space: nowrap; transition: opacity 260ms ease;
}
/* Neighbours' labels sit off-screen in the board; long titles would otherwise peek in at the edge. */
${S} .sw-dcard:not(.sel) .sw-dlabel { opacity: 0; }
${S} .sw-dlabel .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 15px; font-weight: 600; }
${S} .sw-dlabel .h { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: rgba(255,255,255,0.55); }
${S} .sw-dlabel .h:empty { display: none; }
${S} .sw-dface {
  position: absolute; inset: 0; border-radius: 22px; overflow: hidden; background: #000;
  box-shadow: 0 30px 80px rgba(0,0,0,0.5); transition: border-radius 360ms var(--expand);
}
${S} .sw-dface .sw-ph > .ring { width: 72px; height: 72px; border-radius: 36px; }
${S} .sw-sheen {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 32%); transition: opacity 200ms ease;
}
${S} .sw-dim { position: absolute; inset: 0; background: #0b0c10; opacity: 0; pointer-events: none; transition: opacity 420ms ease; }
${S} .sw-dcard:not(.sel) .sw-dim { opacity: 0.5; }
${S} .sw-dface > .sw-rim { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18); transition: opacity 200ms ease; }
${S} .sw-expanding .sw-dcard { transition: transform 560ms var(--spring), opacity 220ms ease; }
${S} .sw-expanding .sw-dcard.sel .sw-dface { border-radius: 0; }
${S} .sw-expanding .sw-dcard.sel .sw-sheen, ${S} .sw-expanding .sw-dcard.sel .sw-rim, ${S} .sw-expanding .sw-dlabel { opacity: 0 !important; }

${S} .sw-dock {
  position: absolute; left: 0; top: 0; height: 52px; border-radius: 26px; z-index: 20;
  box-shadow: 0 14px 34px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.3);
  transition: left 420ms var(--spring), width 420ms var(--spring), transform 320ms var(--spring), opacity 220ms ease;
}
${S} .sw-dock > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)); }
${S} .sw-dock > .rim { background: ${CLEAR_RIM}; }
${S} .sw-dock-in { position: absolute; inset: 0; border-radius: inherit; }
${S} .sw-dots { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; transition: opacity 200ms ease; }
${S} .sw-dots-row { position: absolute; left: 0; top: 0; height: 52px; padding: 0 10px; display: flex; align-items: center; gap: 8px; transition: transform 420ms var(--spring); }
${S} .sw-dot {
  flex-shrink: 0; width: 40px; height: 40px; padding: 0 14px 0 12px; border-radius: 20px; overflow: hidden;
  display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: #fff; background-color: transparent;
  transition: width 420ms var(--spring), background-color 300ms ease, opacity 220ms ease, margin 220ms ease, padding 220ms ease;
}
${S} .sw-dot.sel { width: 216px; background-color: rgba(255,255,255,0.2); }
${S} .sw-dot:not(.sel):hover { background-color: rgba(255,255,255,0.1); }
${S} .sw-dot .t { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: 0; transition: opacity 240ms ease; }
${S} .sw-dot.sel .t { opacity: 1; }
${S} .sw-dot.sw-gone { width: 0; padding: 0; margin-left: -8px; opacity: 0; transition-duration: 220ms; transition-timing-function: ease; }
${S} .sw-dockfield { position: absolute; inset: 0; opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
${S} .sw-dock.latched .sw-dots { opacity: 0; pointer-events: none; }
${S} .sw-dock.latched .sw-dockfield { opacity: 1; pointer-events: auto; transition-delay: 80ms; }
${S} .sw-expanding .sw-dock { opacity: 0; transform: translateY(18px); }

/* ---- Grid ---- */
${S} .sw-grid .sw-bg { background: rgba(10,10,14,0.5); backdrop-filter: blur(36px) saturate(1.2); }
${S} .sw-gfield {
  position: absolute; top: 12px; height: 44px; border-radius: 22px; z-index: 3;
  box-shadow: 0 10px 28px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.3); transition: opacity 220ms ease;
}
${S} .sw-gfield > .tint { background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05)); }
${S} .sw-gfield > .rim { background: ${CLEAR_RIM}; }
${S} .sw-gscroll {
  position: absolute; left: 0; right: 0; top: 68px; bottom: 0; overflow-x: hidden; overflow-y: auto; z-index: 2;
  transition: opacity 220ms ease; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent;
}
${S} .sw-gcontent { position: relative; pointer-events: none; }
${S} .sw-gcard { position: absolute; left: 0; top: 0; width: 291px; transition: transform 420ms var(--spring); pointer-events: auto; }
${S} .sw-gin { position: relative; }
${S} .sw-gface {
  position: relative; width: 291px; height: 182px; border-radius: 12px; overflow: hidden; background: #000;
  box-shadow: 0 16px 40px rgba(0,0,0,0.45); transition: box-shadow 160ms ease;
}
${S} .sw-gcard.sel .sw-gface { box-shadow: 0 0 0 3px #4cc2ff, 0 0 0 7px rgba(76,194,255,0.22), 0 16px 40px rgba(0,0,0,0.45); }
${S} .sw-gface > .sw-rim, ${S} .sw-sface > .sw-rim { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16); }
${S} .sw-gface .sw-ph > .ring { width: 48px; height: 48px; border-radius: 24px; }
${S} .sw-x {
  position: absolute; right: 8px; top: 8px; width: 24px; height: 24px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; background: rgba(24,24,28,0.86); color: #fff;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 2px 6px rgba(0,0,0,0.3); opacity: 0; transition: opacity 120ms ease;
}
${S} .sw-gcard:hover .sw-x { opacity: 1; }
${S} .sw-x:hover { background: rgba(48,48,54,0.92); }
${S} .sw-glabel { margin-top: 12px; display: flex; align-items: flex-start; gap: 9px; }
${S} .sw-glabel .fav { margin-top: 1px; }
${S} .sw-glabel .txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
${S} .sw-glabel .t { font-size: 13px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .sw-glabel .h { font-size: 12px; line-height: 16px; color: rgba(255,255,255,0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .sw-gnew-wrap { position: absolute; left: 0; top: 0; width: 291px; transition: transform 420ms var(--spring), opacity 220ms ease; pointer-events: auto; }
${S} .sw-gnew-wrap.gone { display: none; }
${S} .sw-gnew {
  width: 291px; height: 182px; border: 1.5px dashed rgba(255,255,255,0.3); border-radius: 12px; background: rgba(255,255,255,0.04);
  display: flex; align-items: center; justify-content: center; color: #fff; transition: background-color 120ms ease;
}
${S} .sw-gnew:hover { background: rgba(255,255,255,0.08); }
${S} .sw-gnew > span { width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.12); }
${S} .sw-gnew > span svg { width: 20px; height: 20px; }
${S} .sw-gnew-label { margin-top: 12px; font-size: 13px; color: rgba(255,255,255,0.75); }
${S} .sw-grid.sw-expanding .sw-gscroll, ${S} .sw-grid.sw-expanding .sw-gfield { opacity: 0; }

/* ---- Strip ---- */
${S} .sw-strip .sw-bg { background: rgba(8,8,12,0.22); }
${S} .sw-panel {
  position: absolute; left: 0; top: 0; height: 212px; border-radius: 24px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3);
  transition: left 420ms var(--spring), width 420ms var(--spring), opacity 220ms ease;
}
${S} .sw-panel > .tint, ${S} .sw-sfield > .tint { background: rgba(20,20,24,0.58); }
${S} .sw-panel > .rim, ${S} .sw-sfield > .rim { background: ${FROST_RIM}; }
${S} .sw-sclip { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
${S} .sw-srow { position: absolute; left: 0; top: 0; height: 100%; transition: transform 420ms var(--spring); }
${S} .sw-scard { position: absolute; left: 0; top: 0; width: 192px; transition: transform 420ms var(--spring); }
${S} .sw-sin { position: relative; }
${S} .sw-sface { position: relative; width: 192px; height: 120px; border-radius: 10px; overflow: hidden; background: #000; transition: box-shadow 160ms ease; }
${S} .sw-scard.sel .sw-sface { box-shadow: 0 0 0 3px #4cc2ff, 0 0 0 7px rgba(76,194,255,0.22); }
${S} .sw-sface .sw-ph > .ring { width: 40px; height: 40px; border-radius: 20px; }
${S} .sw-slabel { margin-top: 10px; display: flex; align-items: center; gap: 8px; font-size: 12.5px; line-height: 17px; color: rgba(255,255,255,0.75); white-space: nowrap; }
${S} .sw-slabel .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
${S} .sw-scard.sel .sw-slabel { color: #fff; }
${S} .sw-sfield {
  position: absolute; left: 0; top: 0; height: 44px; border-radius: 22px; box-shadow: 0 6px 14px rgba(0,0,0,0.35);
  opacity: 0; transform: translateY(6px); pointer-events: none !important;
  transition: opacity 200ms ease, transform 320ms var(--spring), left 420ms var(--spring), width 420ms var(--spring);
}
${S} .sw-strip.latched .sw-sfield { opacity: 1; transform: none; pointer-events: auto !important; }
${S} .sw-strip.sw-expanding .sw-panel, ${S} .sw-strip.sw-expanding .sw-sfield { opacity: 0; }

/* Deck and Grid cover the page (class vitre-switcher-cover on #vitre-root). The bar's layer is lifted
 * just above the switcher's, so the window controls (and a private window's label) sit on the
 * switcher's own surface, as on the TabOverview board, read as clear glass (b.holdTheme), and stay
 * visible where Windows hit-tests them as caption buttons. Everything else in that layer (the tab bar,
 * a parked extensions cluster) is hidden and lets clicks through: the deck hides it at once (its
 * surface is opaque from the first frame), the grid cross-fades it with its search field, which takes
 * the bar's place. */
#vitre-root.vitre-switcher-cover > #layer-bar { z-index: 41 !important; }
#vitre-root.vitre-switcher-cover > #layer-bar > :not(#vitre-winctl, #vitre-private) { opacity: 0 !important; transition: none !important; }
#vitre-root.vitre-switcher-cover.vitre-switcher-grid > #layer-bar > :not(#vitre-winctl, #vitre-private) { transition: opacity 120ms ease !important; }
#vitre-root.vitre-switcher-cover > #layer-bar > :not(#vitre-winctl, #vitre-private),
#vitre-root.vitre-switcher-cover > #layer-bar > :not(#vitre-winctl, #vitre-private) * { pointer-events: none !important; }

@media (prefers-reduced-motion: reduce) {
  ${S} *, ${S} > .sw {
    transition-property: opacity !important; transition-duration: 150ms !important; transition-delay: 0ms !important;
    transition-timing-function: ease !important;
  }
  /* Cross-fades only: nothing that would jump without its slide. */
  ${S} .sw-expanding .sw-dock, ${S} .sw-sfield { transform: none; }
  ${S} .sw-expanding .sw-dcard.sel .sw-dface { border-radius: 22px; }
}
`;
