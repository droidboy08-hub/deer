// Menu material and anatomy (DESIGN-NOTES "Right-click menus", CtxMenu.dc.html).
export const MENU_CSS = `
#layer-menus > .vt-menus { position: fixed; inset: 0; pointer-events: none; }
.vt-menus > .vt-catcher { position: fixed; inset: 0; pointer-events: auto; -webkit-app-region: no-drag; }
.vt-menus > .vt-catcher[hidden] { display: none; }
.vt-wash {
  position: fixed;
  border-radius: 4px;
  background: rgba(76,194,255,0.14);
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.vt-wash.on { opacity: 1; }

.vt-menu {
  --m-tint: rgba(32,32,38,0.80);
  --m-rim: linear-gradient(165deg, rgba(255,255,255,0.45), rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.18));
  --m-shadow: 0 18px 44px rgba(0,0,0,0.32), 0 1px 3px rgba(0,0,0,0.30);
  --m-text: #ffffff;
  --m-sec: rgba(255,255,255,0.70);
  --m-sep: rgba(255,255,255,0.10);
  --m-plate: rgba(255,255,255,0.12);
  --m-plate-in: inset 0 0.5px 0 rgba(255,255,255,0.22);
  --m-press: rgba(255,255,255,0.08);
  --m-dis-plate: rgba(255,255,255,0.05);
  --m-row: 34px;
  position: fixed;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--m-tint);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: var(--m-shadow);
  color: var(--m-text);
  font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
  line-height: 20px;
  outline: none;
  pointer-events: auto;
  user-select: none;
  cursor: default;
  -webkit-app-region: no-drag;
  transition: background-color 90ms ease;
}
.vt-menu::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: var(--m-rim);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
.vt-menu.t-raised {
  --m-tint: rgba(48,48,56,0.86);
  --m-rim: linear-gradient(165deg, rgba(255,255,255,0.55), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.20));
  --m-shadow: 0 18px 44px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.40);
}
.vt-menu.t-light {
  --m-tint: rgba(249,249,251,0.80);
  --m-rim: linear-gradient(165deg, rgba(255,255,255,0.9), rgba(255,255,255,0.5) 40%, rgba(255,255,255,0.3));
  --m-shadow: 0 0 0 1px rgba(0,0,0,0.10), 0 16px 40px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.10);
  --m-text: rgba(0,0,0,0.90);
  --m-sec: rgba(0,0,0,0.62);
  --m-sep: rgba(0,0,0,0.08);
  --m-plate: rgba(0,0,0,0.06);
  --m-plate-in: none;
  --m-press: rgba(0,0,0,0.04);
  --m-dis-plate: rgba(0,0,0,0.03);
}
.vt-menu.touch { --m-row: 40px; }

.vt-menu-list {
  position: relative;
  padding: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.vt-menu-list::-webkit-scrollbar { width: 2px; }
.vt-menu-list::-webkit-scrollbar-track { background: transparent; margin: 12px 0; }
.vt-menu-list::-webkit-scrollbar-thumb { background: transparent; border-radius: 1px; }
.vt-menu-list.scrolling::-webkit-scrollbar-thumb { background: var(--m-sec); }

.vt-plate {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 6px;
  height: var(--m-row);
  border-radius: 6px;
  background: var(--m-plate);
  box-shadow: var(--m-plate-in);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.vt-plate.dis { background: var(--m-dis-plate); box-shadow: none; }
.vt-plate.press { background: var(--m-press); box-shadow: none; }

.vt-mi {
  position: relative;
  height: var(--m-row);
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
}
.vt-mi-icon { flex-shrink: 0; }
.vt-mi-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vt-mi.bold .vt-mi-label { font-weight: 600; }
.vt-mi-accel { flex-shrink: 0; margin-left: 20px; font-size: 12px; line-height: 16px; color: var(--m-sec); }
.vt-mi[aria-disabled="true"] { opacity: 0.36; }
.vt-mi.pressed { opacity: 0.8; }
.vt-ak { text-decoration: none; }
.vt-menu.keys .vt-ak { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }

.vt-sep { height: 9px; display: flex; align-items: center; }
.vt-sep::after { content: ''; flex: 1; height: 1px; margin: 0 6px; background: var(--m-sep); }
.vt-caption {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 28px;
  color: var(--m-sec);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The chrome element whose menu is open keeps its pressed look. */
.item.vt-menu-owner > .tint { background: linear-gradient(var(--g-hover), var(--g-hover)), var(--g-tint); }

@media (prefers-reduced-transparency: reduce) {
  .vt-menu { backdrop-filter: none; --m-tint: #2c2c2c; --m-rim: linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08)); --m-plate: rgba(255,255,255,0.10); --m-plate-in: none; --m-press: rgba(255,255,255,0.07); }
  .vt-menu.t-light { --m-tint: #f9f9f9; --m-rim: linear-gradient(rgba(0,0,0,0.06), rgba(0,0,0,0.06)); }
}
@media (forced-colors: active) {
  .vt-menu { backdrop-filter: none; background: Canvas; color: CanvasText; box-shadow: none; border: 1px solid CanvasText; }
  .vt-menu::after { display: none; }
  .vt-plate { forced-color-adjust: none; background: Highlight; box-shadow: none; }
  .vt-mi.active:not([aria-disabled="true"]) { forced-color-adjust: none; color: HighlightText; }
  .vt-mi.active:not([aria-disabled="true"]) .vt-mi-accel { color: HighlightText; }
  .vt-mi[aria-disabled="true"] { opacity: 1; color: GrayText; }
  .vt-sep::after { background: CanvasText; }
  .vt-wash { forced-color-adjust: none; background: transparent; outline: 2px solid Highlight; }
}
`;
