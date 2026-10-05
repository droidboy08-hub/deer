// Peek styles. Values from the PeekMotion and PeekOpen boards (1440×900 reference).
// Stacking inside #views: tab pages, dim (1), sheet frame (2), peek pages (3), sheet chrome (4).
// The tab bar (z 10 on the body) stays above all of it. The wash after closing is on the 'peek'
// layer (z 8), above every page, so it is removed whenever a page could come up over it.
export const PEEK_CSS = `
.vt-peek-dim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(8,8,12,0.22);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.vt-peek-dim.on { opacity: 1; visibility: visible; pointer-events: auto; }

.vt-peek-frame, .vt-peek-sheet {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  border-radius: 22px;
  visibility: hidden;
}
.vt-peek-frame.on, .vt-peek-sheet.on { visibility: visible; }
.vt-peek-frame {
  z-index: 2;
  background: #f6f7f9;
  box-shadow: 0 40px 100px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.25);
}
.vt-peek-sheet {
  z-index: 4;
  overflow: hidden;
  pointer-events: none;
  color: #16181d;
  font-size: 13px;
}

webview.vt-peek-view {
  visibility: visible;
  z-index: 3;
  right: auto;
  bottom: auto;
  will-change: transform, opacity;
}
webview.vt-peek-view.vt-peek-warm { visibility: hidden; pointer-events: none; }
webview.vt-peek-view.vt-peek-incoming { pointer-events: none; }
webview.vt-peek-view.vt-peek-full { z-index: 5; }
webview.vt-peek-under, #home.vt-peek-under { visibility: visible; }
/* Closing: the shrinking sheet and its page let clicks through to the page underneath. */
.vt-peek-frame.leaving, .vt-peek-sheet.leaving, .vt-peek-sheet.leaving *, webview.vt-peek-view.vt-peek-leaving { pointer-events: none; }

.vt-peek-head {
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
}
.vt-peek-back {
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
.vt-peek-head.can-back .vt-peek-back { display: flex; }
.vt-peek-site {
  position: absolute;
  left: 14px;
  right: 92px;
  top: 0;
  height: 43px;
}
.vt-peek-head.can-back .vt-peek-site { left: 42px; }
.vt-peek-id {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: opacity 200ms ease;
}
.vt-peek-id.out { opacity: 0; }
.vt-peek-id .fav {
  width: 16px;
  height: 16px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(22,24,29,0.55);
}
.vt-peek-id .fav img { width: 16px; height: 16px; border-radius: 3px; }
.vt-peek-id .dom { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.vt-peek-id .path { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: rgba(22,24,29,0.55); }
.vt-peek-actions {
  position: absolute;
  right: 8px;
  top: 6px;
  display: flex;
  gap: 6px;
}
.vt-peek-actions button {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #16181d;
  transition: background 120ms ease;
}
.vt-peek-actions button:hover, .vt-peek-back:hover { background: rgba(16,18,24,0.06); }
.vt-peek-actions button:active, .vt-peek-back:active { background: rgba(16,18,24,0.12); }
.vt-peek-head button:focus-visible { outline: 2px solid #16181d; outline-offset: -2px; }
.vt-peek-load {
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 0;
  height: 2px;
  background: #4cc2ff;
  opacity: 0;
}
.vt-peek-load.loading { width: 70%; opacity: 1; transition: width 450ms ease; }
.vt-peek-load.done { width: 100%; opacity: 0; transition: width 450ms ease, opacity 250ms ease 300ms; }

.vt-peek-cover {
  position: absolute;
  left: 0;
  right: 0;
  top: 44px;
  bottom: 0;
  background: #e9ecf1;
  transition: opacity 200ms ease, top 380ms cubic-bezier(0.2, 0, 0, 1);
}
.vt-peek-cover.gone { opacity: 0; }

.vt-peek-error {
  position: absolute;
  left: 0;
  right: 0;
  top: 44px;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f6f7f9;
  color: #1b1d21;
  pointer-events: auto;
}
.vt-peek-error[hidden] { display: none; }
.vt-peek-error > div { width: min(440px, 80%); }
.vt-peek-error h2 { margin: 0 0 8px; font: 600 20px/28px 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; }
.vt-peek-error p { margin: 0 0 18px; font-size: 13.5px; line-height: 20px; color: #5b6170; user-select: text; overflow-wrap: anywhere; }
.vt-peek-error button { height: 32px; padding: 0 16px; border-radius: 6px; background: #005fb8; color: #fff; font-weight: 600; }
.vt-peek-error button:focus-visible { outline: 2px solid #16181d; outline-offset: 2px; }

.vt-peek-rim {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(165deg, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 30%, rgba(255,255,255,0.2) 60%, rgba(255,255,255,0.8));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

/* Open as tab: the header and rim give way while the sheet fills the window. */
.vt-peek-sheet.full .vt-peek-head { opacity: 0; pointer-events: none; }
.vt-peek-sheet.full .vt-peek-rim { opacity: 0; transition: opacity 140ms ease 240ms; }
.vt-peek-sheet.full .vt-peek-cover { top: 0; }

/* After closing, the link's row glows once so the eye finds its place again. */
#layer-peek > .vt-peek-wash {
  position: absolute;
  background: rgba(76,194,255,0.22);
  opacity: 0;
  pointer-events: none;
  animation: vt-peek-wash 1120ms ease-out 260ms both;
}
@keyframes vt-peek-wash { 0% { opacity: 0; } 20% { opacity: 1; } 100% { opacity: 0; } }

/* Open as tab: the header's site rises into the tab bar as the new pill. */
#layer-peek-rise > .vt-peek-rise {
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
  animation: vt-peek-rise 600ms ease both;
}
#layer-peek-rise > .vt-peek-rise img { width: 16px; height: 16px; border-radius: 3px; }
@keyframes vt-peek-rise { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .vt-peek-head, .vt-peek-rim, .vt-peek-cover, .vt-peek-id, .vt-peek-sheet.full .vt-peek-rim { transition: opacity 150ms ease !important; }
  .vt-peek-load.loading, .vt-peek-load.done { transition: opacity 150ms ease; }
  #layer-peek-rise > .vt-peek-rise { display: none; }
}
`;
