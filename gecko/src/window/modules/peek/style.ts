// Peek styles. Values from the PeekMotion and PeekOpen boards (1440×900 reference), ported from
// app/src/renderer/modules/peek/style.ts. Injected once per window with b.css('peek', ...), so every
// selector is scoped: #tabbrowser-tabpanels for what lives among the tab panels (dim, frame, the
// peek's panel), #vitre-root layers for the chrome.
//
// Tab panels hide every panel but the selected one with `-moz-subtree-hidden-only-visually: 1`
// (gre/chrome/toolkit/content/global/xul.css "tabpanels > *") and place each one absolutely over the
// whole area (browser/.../tabbrowser/content-area.css .browserSidebarContainer). The peek's panel
// and the source panel kept on screen while Open as tab runs undo the hiding the way split view
// does for its active panel (xul.css "tabpanels > .split-view-panel-active").
export const PEEK_CSS = `
#tabbrowser-tabpanels > .vitre-peek-dim {
  -moz-subtree-hidden-only-visually: 0;
  position: absolute;
  inset: 0;
  z-index: 3;
  background: rgba(8,8,12,0.22);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
#tabbrowser-tabpanels > .vitre-peek-dim.on { opacity: 1; visibility: visible; pointer-events: auto; }

#tabbrowser-tabpanels > .vitre-peek-frame {
  -moz-subtree-hidden-only-visually: 0;
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  z-index: 4;
  border-radius: 22px;
  background: #f6f7f9;
  box-shadow: 0 40px 100px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.25);
  visibility: hidden;
  pointer-events: none;
}
#tabbrowser-tabpanels > .vitre-peek-frame.on { visibility: visible; }

#tabbrowser-tabpanels > .vitre-peek-panel {
  -moz-subtree-hidden-only-visually: 0 !important;
  visibility: inherit !important;
  /* left / top / width / height are set inline (sheet.ts poseView); the panel rule's inset: 0 must not stretch it. */
  right: auto !important;
  bottom: auto !important;
  z-index: 5;
  will-change: transform, opacity;
}
#tabbrowser-tabpanels > .vitre-peek-panel.vitre-peek-leaving { pointer-events: none; }
#tabbrowser-tabpanels > .vitre-peek-panel > .browserContainer,
#tabbrowser-tabpanels > .vitre-peek-panel .browserStack { background: #f6f7f9; }
/* The source page stays on screen under a sheet that is becoming its tab's successor (Open as tab). */
#tabbrowser-tabpanels > .vitre-peek-under {
  -moz-subtree-hidden-only-visually: 0 !important;
  visibility: inherit !important;
}

#vitre-root #layer-peek > .vp-sheet {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  border-radius: 22px;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
  color: #16181d;
  font-size: 13px;
}
#vitre-root #layer-peek > .vp-sheet.on { visibility: visible; }
#vitre-root #layer-peek > .vp-sheet.leaving,
#vitre-root #layer-peek > .vp-sheet.leaving * { pointer-events: none !important; }

#layer-peek .vp-head {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 44px;
  border-bottom: 1px solid rgba(16,18,24,0.08);
  background: rgba(250,251,253,0.78);
  backdrop-filter: blur(20px) saturate(1.6);
  pointer-events: auto;
  transition: opacity 140ms ease;
  -moz-window-dragging: no-drag;
}
#layer-peek .vp-back {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  display: none;
  align-items: center;
  justify-content: center;
  color: rgba(22,24,29,0.78);
  transition: background 120ms ease;
}
#layer-peek .vp-head.can-back .vp-back { display: flex; }
#layer-peek .vp-site {
  position: absolute;
  left: 14px;
  right: 92px;
  top: 0;
  height: 43px;
}
#layer-peek .vp-head.can-back .vp-site { left: 42px; }
#layer-peek .vp-id {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: opacity 200ms ease;
}
#layer-peek .vp-id.out { opacity: 0; }
#layer-peek .vp-id .fav {
  width: 16px;
  height: 16px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(22,24,29,0.55);
}
#layer-peek .vp-id .fav img { width: 16px; height: 16px; border-radius: 3px; }
#layer-peek .vp-id .dom { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
#layer-peek .vp-id .path { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: rgba(22,24,29,0.55); }
/* Find's capsule sits over the domain and path (FindSpec "Peek"): they give way, the favicon stays. */
#layer-peek .vp-head.find .vp-id .dom,
#layer-peek .vp-head.find .vp-id .path { visibility: hidden; }
#layer-peek .vp-actions {
  position: absolute;
  right: 8px;
  top: 6px;
  display: flex;
  gap: 6px;
}
#layer-peek .vp-actions button {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #16181d;
  transition: background 120ms ease;
}
#layer-peek .vp-actions button:hover, #layer-peek .vp-back:hover { background: rgba(16,18,24,0.06); }
#layer-peek .vp-actions button:active, #layer-peek .vp-back:active { background: rgba(16,18,24,0.12); }
#vitre-root #layer-peek .vp-head button:focus-visible { outline: 2px solid #16181d; outline-offset: -2px; }
#layer-peek .vp-load {
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 0;
  height: 2px;
  background: #4cc2ff;
  opacity: 0;
}
#layer-peek .vp-load.loading { width: 70%; opacity: 1; transition: width 450ms ease; }
#layer-peek .vp-load.done { width: 100%; opacity: 0; transition: width 450ms ease, opacity 250ms ease 300ms; }

#layer-peek .vp-cover {
  position: absolute;
  left: 0;
  right: 0;
  top: 44px;
  bottom: 0;
  background: #e9ecf1;
  transition-property: opacity;
  transition-timing-function: ease;
}
#layer-peek .vp-cover.gone { opacity: 0; }
#layer-peek .vp-snap {
  position: absolute;
  left: 0;
  top: 44px;
  opacity: 0;
  transition-property: opacity;
  transition-timing-function: ease;
}
#layer-peek .vp-snap.on { opacity: 1; }

#layer-peek .vp-rim {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 30%, rgba(255,255,255,0.2) 60%, rgba(255,255,255,0.8));
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

/* Open as tab: the header and rim give way while the sheet fills the window. */
#layer-peek .vp-sheet.full .vp-head { opacity: 0; pointer-events: none; }
#layer-peek .vp-sheet.full .vp-rim { opacity: 0; transition: opacity 140ms ease 240ms; }

/* After closing, the link's row glows once so the eye finds its place again. It sits on the page,
 * under the dim (z 3) and the sheet's frame and page (z 4, 5) that are still folding into it. */
#tabbrowser-tabpanels > .vitre-peek-wash {
  -moz-subtree-hidden-only-visually: 0;
  position: absolute;
  z-index: 2;
  background: rgba(76,194,255,0.22);
  opacity: 0;
  pointer-events: none;
  animation: vp-wash 1120ms ease-out 260ms both;
}
@keyframes vp-wash { 0% { opacity: 0; } 20% { opacity: 1; } 100% { opacity: 0; } }

/* Discovery (board PeekDiscover): the link status bubble, once, with "Shift+click to peek". While it
 * shows, Firefox's own status bubble (browser.xhtml #statuspanel), which would sit in the same corner,
 * is hidden. */
#vitre-root #layer-peek > .vp-hint {
  position: absolute;
  height: 30px;
  box-sizing: border-box;
  padding: 0 12px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 24px);
  white-space: nowrap;
  font-size: 12.5px;
  background: rgba(28,28,34,0.82);
  backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 6px 18px rgba(0,0,0,0.25);
  pointer-events: none;
}
#layer-peek > .vp-hint .u { color: rgba(255,255,255,0.9); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
#layer-peek > .vp-hint .d { width: 3px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.4); flex: none; }
#layer-peek > .vp-hint .h { color: #9fe3ff; flex: none; }
:root[vitre-peek-hint] #statuspanel { visibility: hidden !important; }

/* Open as tab: the header's site rises into the tab bar as the new pill. */
#vitre-root #layer-peek-rise > .vp-rise {
  position: absolute;
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 500;
  color: #16181d;
  background: rgba(255,255,255,0.86);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.9), 0 14px 30px rgba(40,30,15,0.2);
  pointer-events: none;
  animation: vp-rise 600ms ease both;
}
#vitre-root #layer-peek-rise > .vp-rise img,
#vitre-root #layer-peek-rise > .vp-rise svg { width: 16px; height: 16px; border-radius: 3px; flex: none; }
@keyframes vp-rise { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  #layer-peek .vp-head, #layer-peek .vp-rim, #layer-peek .vp-cover, #layer-peek .vp-id, #layer-peek .vp-sheet.full .vp-rim { transition: opacity 150ms ease !important; }
  #layer-peek .vp-load.loading, #layer-peek .vp-load.done { transition: opacity 150ms ease; }
  #vitre-root #layer-peek-rise > .vp-rise { display: none; }
}
`;
