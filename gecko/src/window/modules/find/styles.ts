// Find in page: styles (b.css('find', CSS)). Ported from app/src/renderer/modules/find.ts; sizes,
// colours and motion are the design's (DESIGN-NOTES "Find in page", boards FindPill, FindStates,
// FindMotion, FindSpec). Gecko differences: classes live on #vitre-root (not body), the bar is
// #vitre-bar, and nothing that is an ancestor of a lens ever gets opacity < 1 or a filter
// (src/window/glass.ts): the face fades its parts, never itself, while it carries its own glass.
//
// Classes on #vitre-root while the face is up:
//   find-face      the active pill's own face hides (the find face is drawn over it)
//   find-focused   the field has focus: the pill's tint gives way to the focused tint
//   find-own       the bar is hidden: the face brings its own glass and the real pill stays away
//   find-cooldown  400 ms after close: the reload slot ignores clicks
// Pill-local positions (FindPill board, 480 px): favicon x 16, field from x 42, counter right edge
// x 324, previous 334, next 364, divider 401, Aa 410, × 442; anchored right so narrower pills keep
// the right-hand group in place.
export const PILL_H = 44;
export const OPEN_MS = 240;
export const CLOSE_MS = 200;
export const DROP_MS = 300;

export const CSS = `
#vitre-root.find-face #vitre-bar .item.tab.active .pill-face,
#vitre-root.find-face #vitre-bar .item.tab.active .pill-face *,
#vitre-root.find-face #vitre-bar .item.tab.active .load-line { visibility: hidden !important; }
#vitre-root.find-face #vitre-bar .item.tab.active > .tint { transition: opacity 160ms ease; }
#vitre-root.find-face.find-focused #vitre-bar .item.tab.active > .tint { opacity: 0; transition: opacity 200ms ease; }
#vitre-root.find-own #vitre-bar .item.tab.active { visibility: hidden; }
#vitre-root.find-cooldown #vitre-bar .item.active .reload { pointer-events: none; }

#vitre-root.theme-light #layer-find {
  --vf-focus: linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.40));
  --vf-text: #16181d; --vf-icon: rgba(22,24,29,0.78); --vf-icon-dis: rgba(22,24,29,0.28);
  --vf-placeholder: rgba(22,24,29,0.45); --vf-caret: #005fb8; --vf-divider: rgba(22,24,29,0.12);
  --vf-count: rgba(22,24,29,0.55); --vf-none: #c42b1c; --vf-text-shadow: none;
  --vf-hover: rgba(22,24,29,0.06); --vf-press: rgba(22,24,29,0.10);
  --vf-case-bg: rgba(0,95,184,0.12); --vf-case-ring: inset 0 0 0 1px rgba(0,95,184,0.35); --vf-case-on: #005fb8;
}
#vitre-root.theme-dark #layer-find {
  --vf-focus: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)), rgba(16,16,20,0.46);
  --vf-text: #ffffff; --vf-icon: rgba(255,255,255,0.85); --vf-icon-dis: rgba(255,255,255,0.3);
  --vf-placeholder: rgba(255,255,255,0.45); --vf-caret: #4cc2ff; --vf-divider: rgba(255,255,255,0.12);
  --vf-count: rgba(255,255,255,0.6); --vf-none: #ff99a4; --vf-text-shadow: none;
  --vf-hover: rgba(255,255,255,0.10); --vf-press: rgba(255,255,255,0.16);
  --vf-case-bg: rgba(76,194,255,0.24); --vf-case-ring: inset 0 0 0 1px rgba(76,194,255,0.45); --vf-case-on: #9fe3ff;
}
#vitre-root.theme-clear #layer-find {
  --vf-focus: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)), rgba(16,16,20,0.30);
  --vf-text: #ffffff; --vf-icon: rgba(255,255,255,0.9); --vf-icon-dis: rgba(255,255,255,0.32);
  --vf-placeholder: rgba(255,255,255,0.5); --vf-caret: #4cc2ff; --vf-divider: rgba(255,255,255,0.12);
  --vf-count: rgba(255,255,255,0.7); --vf-none: #ff99a4; --vf-text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  --vf-hover: rgba(255,255,255,0.10); --vf-press: rgba(255,255,255,0.16);
  --vf-case-bg: rgba(76,194,255,0.24); --vf-case-ring: inset 0 0 0 1px rgba(76,194,255,0.45); --vf-case-on: #9fe3ff;
}

/* ---- the pill's find face ---- */
#vitre-root #layer-find .vf-face {
  left: 0; top: 12px; width: 480px; height: ${PILL_H}px;
  color: var(--vf-text); text-shadow: var(--vf-text-shadow);
  font: 13.5px var(--font);
  -moz-window-dragging: no-drag;
  transition: left 420ms var(--spring), width 420ms var(--spring), transform ${DROP_MS}ms var(--spring);
}
#vitre-root #layer-find .vf-face[hidden] { display: none; }
#vitre-root #layer-find .vf-face:not(.vf-own) { box-shadow: none; }
#vitre-root #layer-find .vf-face:not(.vf-own) > .lens,
#vitre-root #layer-find .vf-face:not(.vf-own) > .rim,
#vitre-root #layer-find .vf-face:not(.vf-own) > .vf-base { display: none; }
#vitre-root #layer-find .vf-face.vf-raised { transform: translateY(-56px); }
/* A face that fades (tab switch, Ctrl+L, reduced motion) fades its parts (views.ts fadeParts): opacity
   on the glass element itself would cut its lens off from the page. */
#vitre-root #layer-find .vf-snap, #vitre-root #layer-find .vf-snap * { transition: none !important; }

.vf-face .vf-tint { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.vf-face .vf-base { background: var(--g-tint); opacity: 1; transition: opacity 160ms ease; }
.vf-face .vf-hi { background: var(--vf-focus); opacity: 0; transition: opacity 160ms ease; }
.vf-face.vf-find.vf-focused:not(.vf-under) .vf-base { opacity: 0; transition: opacity 200ms ease; }
.vf-face.vf-find.vf-focused:not(.vf-under) .vf-hi { opacity: 1; transition: opacity 200ms ease; }

/* The address face, drawn only so the pill can morph. */
.vf-face .vf-navs { position: absolute; inset: 0; pointer-events: none; transition: opacity 120ms ease 80ms, transform 120ms var(--spring) 80ms; }
.vf-face.vf-find .vf-navs { opacity: 0; transform: translateX(-6px); transition: opacity 100ms ease, transform 100ms ease; }
.vf-face .vf-nav, .vf-face .vf-reload { position: absolute; top: 8px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: var(--vf-icon); pointer-events: none; }
.vf-face .vf-nav.dis { color: var(--vf-icon-dis); }
.vf-face .vf-reload { transition: opacity 120ms ease 80ms, transform 120ms var(--spring) 80ms; }
.vf-face.vf-find .vf-reload { opacity: 0; transform: rotate(-90deg); transition: opacity 120ms ease, transform 120ms ease; }
.vf-face .vf-domain {
  position: absolute; left: 42px; top: 0; height: ${PILL_H}px; line-height: ${PILL_H}px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; font-weight: 500; pointer-events: none;
  transform: translateX(var(--vf-dom-dx, 0px)); transition: transform 200ms var(--spring), opacity 120ms ease 60ms;
}
.vf-face.vf-find .vf-domain { opacity: 0; transform: none; transition: transform ${OPEN_MS}ms var(--spring), opacity 120ms ease 60ms; }

.vf-face .vf-fav {
  position: absolute; left: 16px; top: 14px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;
  color: var(--vf-text); transform: translateX(var(--vf-fav-dx, 0px)); transition: transform 200ms var(--spring);
}
.vf-face.vf-find .vf-fav { transform: none; transition: transform ${OPEN_MS}ms var(--spring); }
.vf-face .vf-fav img, .vf-face .vf-fav svg { width: 16px; height: 16px; border-radius: 3px; display: block; }
/* Firefox's own page icons (context-fill SVG images) take the glass's text colour, as in the bar. */
.vf-face .vf-fav img { -moz-context-properties: fill, stroke; fill: currentColor; stroke: currentColor; }

#vitre-root #layer-find .vf-input {
  position: absolute; left: 42px; top: 0; width: 160px; height: ${PILL_H}px; margin: 0; padding: 0; border: 0; outline: none;
  appearance: none; background: transparent; color: var(--vf-text); font: 13.5px var(--font); text-shadow: inherit;
  caret-color: var(--vf-caret); user-select: text; -moz-user-select: text; opacity: 0; transition: opacity 80ms ease;
}
#vitre-root #layer-find .vf-find .vf-input { opacity: 1; transition: opacity 120ms ease 60ms; }
#vitre-root #layer-find .vf-find:not(.vf-focused) .vf-input { opacity: 0.85; caret-color: transparent; }
#vitre-root #layer-find .vf-input:focus-visible { outline: none; }
#vitre-root #layer-find .vf-input::placeholder { color: var(--vf-placeholder); opacity: 1; }
#vitre-root #layer-find .vf-input::selection { background: rgba(76,194,255,0.42); }
#vitre-root #layer-find .vf-overflow .vf-input { mask-image: linear-gradient(90deg, #000 calc(100% - 12px), transparent); }

/* Counter, chevrons, divider and Aa slide in as one group. */
.vf-face .vf-grp { position: absolute; inset: 0; pointer-events: none; opacity: 0; transform: translateX(8px); transition: opacity 90ms ease, transform 90ms ease; }
.vf-face.vf-find .vf-grp { opacity: 1; transform: none; transition: opacity 180ms ease 60ms, transform 180ms var(--spring) 60ms; }
#vitre-root #layer-find .vf-face .vf-grp > * { pointer-events: none; }
#vitre-root #layer-find .vf-face.vf-find .vf-grp > button { pointer-events: auto; }
.vf-face .vf-count, .vf-cap .vf-count {
  position: absolute; right: 156px; top: 0; height: ${PILL_H}px; max-width: 112px; overflow: hidden;
  display: flex; align-items: center; white-space: nowrap; font-size: 12.5px; line-height: 16px;
  font-variant-numeric: tabular-nums; color: var(--vf-count);
}
.vf-count.none { color: var(--vf-none) !important; }
.vf-ime .vf-count { opacity: 0.5; }
.vf-count .vf-ordbox { position: relative; display: inline-block; height: 16px; overflow: hidden; }
.vf-count .vf-ord { display: inline-block; }
.vf-count .vf-ord-old { position: absolute; right: 0; top: 0; opacity: 0; }
#vitre-root #layer-find .vf-btn {
  position: absolute; top: 8px; width: 28px; height: 28px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center; color: var(--vf-icon);
  transition: background-color 100ms ease, transform 80ms ease, opacity 100ms ease;
}
#vitre-root #layer-find .vf-btn:hover { background: var(--vf-hover); }
#vitre-root #layer-find .vf-btn:active, #vitre-root #layer-find .vf-btn.vf-echo { background: var(--vf-press); transform: scale(0.94); }
#vitre-root #layer-find .vf-btn[aria-disabled="true"] { opacity: 0.28; background: transparent; transform: none; }
.vf-face .vf-prev { right: 118px; }
.vf-face .vf-next { right: 88px; }
.vf-face .vf-div { position: absolute; right: 78px; top: 14px; width: 1px; height: 16px; background: var(--vf-divider); }
#vitre-root #layer-find .vf-face .vf-case { right: 42px; font: 600 13px/28px var(--font); color: var(--vf-text); opacity: 0.7; }
#vitre-root #layer-find .vf-case[aria-pressed="true"] { opacity: 1; background: var(--vf-case-bg); box-shadow: var(--vf-case-ring); color: var(--vf-case-on); }
#vitre-root #layer-find .vf-face.vf-narrow .vf-case, #vitre-root #layer-find .vf-face.vf-narrow .vf-div { display: none; }
.vf-face.vf-narrow .vf-prev { right: 72px; }
.vf-face.vf-narrow .vf-next { right: 42px; }
.vf-face.vf-narrow .vf-count { right: 110px; }
#vitre-root #layer-find .vf-face.vf-tight .vf-fav { display: none; }
#vitre-root #layer-find .vf-face.vf-tight .vf-input { left: 12px; }

#vitre-root #layer-find .vf-face .vf-close { right: 10px; opacity: 0; pointer-events: none; transition: background-color 100ms ease, transform 80ms ease, opacity 100ms ease; }
#vitre-root #layer-find .vf-face.vf-find .vf-close { opacity: 1; pointer-events: auto; transition: background-color 100ms ease, transform 80ms ease, opacity 160ms ease 60ms; }
.vf-face .vf-close svg { transform: rotate(45deg); transition: transform 100ms ease; }
.vf-face.vf-find .vf-close svg { transform: none; transition: transform 160ms var(--spring) 60ms; }

.vf-face .vf-load { position: absolute; left: 22px; right: 22px; bottom: 0; height: 2px; border-radius: 1px; background: var(--accent); transform-origin: left; transform: scaleX(0); opacity: 0; pointer-events: none; }
.vf-face.vf-loading .vf-load { animation: vt-load 1.6s var(--expand) infinite; opacity: 1; }
.vf-face .vf-sr, .vf-cap .vf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; pointer-events: none; }

/* ---- the capsule in a peek's header (FindPill board, variant capsule; 440x32) ---- */
#vitre-root #layer-find .vf-cap {
  position: absolute; width: 440px; height: 32px; border-radius: 16px;
  background: rgba(255,255,255,0.55); backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: inset 0 0 0 1px rgba(16,18,24,0.10); color: #16181d; font: 13px var(--font);
  --vf-text: #16181d; --vf-icon: #16181d; --vf-placeholder: rgba(22,24,29,0.45); --vf-caret: #005fb8;
  --vf-count: rgba(22,24,29,0.55); --vf-none: #c42b1c; --vf-hover: rgba(22,24,29,0.06); --vf-press: rgba(22,24,29,0.10);
  --vf-case-bg: rgba(0,95,184,0.12); --vf-case-ring: inset 0 0 0 1px rgba(0,95,184,0.35); --vf-case-on: #005fb8;
  -moz-window-dragging: no-drag;
}
#vitre-root #layer-find .vf-cap[hidden] { display: none; }
#vitre-root #layer-find .vf-cap .vf-input { left: 12px; height: 32px; font: 13px var(--font); opacity: 1; }
#vitre-root #layer-find .vf-cap:not(.vf-focused) .vf-input { opacity: 0.85; caret-color: transparent; }
.vf-cap .vf-count { right: 140px; height: 32px; font-size: 12px; max-width: 100px; }
#vitre-root #layer-find .vf-cap .vf-btn { top: 4px; width: 24px; height: 24px; border-radius: 12px; color: #16181d; }
.vf-cap .vf-prev { right: 108px; }
.vf-cap .vf-next { right: 82px; }
.vf-cap .vf-div { position: absolute; right: 74px; top: 9px; width: 1px; height: 14px; background: rgba(22,24,29,0.12); }
#vitre-root #layer-find .vf-cap .vf-case { right: 44px; font: 600 12px/24px var(--font); opacity: 0.7; }
#vitre-root #layer-find .vf-cap .vf-close { right: 12px; }
#vitre-root #layer-find .vf-cap.vf-growing { animation: vf-grow ${OPEN_MS}ms var(--spring) both; }
@keyframes vf-grow { from { clip-path: inset(0 68% 0 0 round 16px); } to { clip-path: inset(0 0 0 0 round 16px); } }

/* ---- the landing ring: 2 px, 3 px outside the match, radius 6 (click-through, under the bar) ---- */
#vitre-root #layer-find-ring .vf-ring { position: absolute; pointer-events: none; }
#vitre-root #layer-find-ring .vf-ring-edge { position: absolute; inset: -5px; border: 2px solid #4cc2ff; border-radius: 8px; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); opacity: 0; pointer-events: none; }
#vitre-root.theme-light #layer-find-ring .vf-ring-edge { border-color: #005fb8; box-shadow: none; }
#vitre-root #layer-find-ring .vf-ring.light .vf-ring-edge { border-color: #005fb8; box-shadow: none; }

@media (prefers-reduced-motion: reduce) {
  #vitre-root #layer-find .vf-face, #vitre-root #layer-find .vf-face *, #vitre-root #layer-find .vf-cap {
    transition-property: opacity !important; transition-duration: 150ms !important; transition-delay: 0ms !important;
  }
  #vitre-root #layer-find .vf-face.vf-loading .vf-load { animation: none; transform: scaleX(0.6); }
  #vitre-root #layer-find .vf-cap.vf-growing { animation: none; }
}
@media (forced-colors: active) {
  #vitre-root #layer-find .vf-face, #vitre-root #layer-find .vf-cap { background: Canvas; color: CanvasText; box-shadow: none; text-shadow: none; outline: 1px solid CanvasText; outline-offset: -1px; backdrop-filter: none; }
  #vitre-root #layer-find .vf-face > .lens, #vitre-root #layer-find .vf-face > .rim, #vitre-root #layer-find .vf-face > .vf-tint { display: none; }
  #vitre-root #layer-find .vf-btn { color: CanvasText; }
  #vitre-root #layer-find .vf-btn[aria-disabled="true"] { color: GrayText; opacity: 1; }
  #vitre-root #layer-find .vf-case[aria-pressed="true"] { forced-color-adjust: none; background: Highlight; color: HighlightText; box-shadow: none; }
  #vitre-root #layer-find .vf-div { background: CanvasText; }
  #vitre-root #layer-find .vf-count, #vitre-root #layer-find .vf-count.none { color: CanvasText !important; }
  #vitre-root #layer-find-ring .vf-ring-edge { border-color: Highlight; box-shadow: none; }
}
`;
