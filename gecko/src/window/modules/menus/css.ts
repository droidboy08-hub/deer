// Menu material and anatomy (DESIGN-NOTES "Right-click menus", CtxMenu.dc.html, MenuSpec.dc.html),
// ported from app/src/renderer/modules/menus/css.ts. Scoped under #layer-menus (the sheet applies to
// the whole of browser.xhtml) plus the bar's pressed look for the element whose menu is open.
//
// Frost: the menu element itself carries backdrop-filter. It sits in #vitre-root, inside the tab box
// whose neutral filter is the backdrop root (skin/shell.css 3), so the blur samples the live page.
// No ancestor between #vitre-root and the menu may have opacity, a filter, a mask or a clip-path (it
// would become the backdrop root and the frost would see nothing): the open / close fades animate the
// menu element's own opacity, which does not affect its own backdrop.
export const MENU_CSS = `
#vitre-root > #layer-menus > .vt-menus { position: absolute; inset: 0; pointer-events: none; }
#layer-menus .vt-catcher { position: absolute; inset: 0; pointer-events: auto; -moz-window-dragging: no-drag; }
#layer-menus .vt-catcher[data-off] { display: none; }
#layer-menus .vt-wash {
  position: absolute;
  border-radius: 4px;
  background: rgba(76,194,255,0.14);
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
#layer-menus .vt-wash.on { opacity: 1; }

#layer-menus .vt-menu, #vitre-menus-top .vt-menu {
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
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border-radius: 12px;
  background: var(--m-tint);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: var(--m-shadow);
  color: var(--m-text);
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  text-align: start;
  outline: none;
  pointer-events: auto;
  user-select: none;
  cursor: default;
  -moz-window-dragging: no-drag;
  transition: background-color 90ms ease;
}
#layer-menus .vt-menu::after, #vitre-menus-top .vt-menu::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: var(--m-rim);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}
#layer-menus .vt-menu.t-raised, #vitre-menus-top .vt-menu.t-raised {
  --m-tint: rgba(48,48,56,0.86);
  --m-rim: linear-gradient(165deg, rgba(255,255,255,0.55), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.20));
  --m-shadow: 0 18px 44px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.40);
}
#layer-menus .vt-menu.t-light, #vitre-menus-top .vt-menu.t-light {
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
/* Transparency effects off (and the element full screen host, which has no page to frost). */
#layer-menus .vt-menu.solid, #vitre-menus-top .vt-menu.solid {
  backdrop-filter: none;
  --m-tint: #2c2c2c;
  --m-rim: linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08));
  --m-plate: rgba(255,255,255,0.10);
  --m-plate-in: none;
  --m-press: rgba(255,255,255,0.07);
}
#layer-menus .vt-menu.solid.t-light, #vitre-menus-top .vt-menu.solid.t-light {
  --m-tint: #f9f9f9;
  --m-rim: linear-gradient(rgba(0,0,0,0.06), rgba(0,0,0,0.06));
  --m-plate: rgba(0,0,0,0.06);
  --m-press: rgba(0,0,0,0.04);
}
#layer-menus .vt-menu.touch, #vitre-menus-top .vt-menu.touch { --m-row: 40px; }

.vt-menu > .vt-menu-list {
  position: relative;
  padding: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.vt-menu > .vt-menu-list.scrolling { scrollbar-width: thin; scrollbar-color: var(--m-sec) transparent; }

.vt-menu .vt-plate {
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
.vt-menu .vt-plate.dis { background: var(--m-dis-plate); box-shadow: none; }
.vt-menu .vt-plate.press { background: var(--m-press); box-shadow: none; }

.vt-menu .vt-mi {
  position: relative;
  height: var(--m-row);
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
  color: var(--m-text);
}
.vt-menu .vt-mi-icon { flex-shrink: 0; width: 16px; height: 16px; }
.vt-menu img.vt-mi-icon { object-fit: contain; }
.vt-menu .vt-mi-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vt-menu .vt-mi.bold .vt-mi-label { font-weight: 600; }
.vt-menu .vt-mi-accel { flex-shrink: 0; margin-left: 20px; font-size: 12px; line-height: 16px; color: var(--m-sec); }
.vt-menu .vt-mi-sub { flex-shrink: 0; margin-left: 20px; margin-right: -4px; width: 16px; height: 16px; color: var(--m-sec); }
.vt-menu .vt-mi[aria-disabled="true"] { opacity: 0.36; }
.vt-menu .vt-mi.pressed { opacity: 0.8; }
.vt-menu .vt-ak { text-decoration: none; }
.vt-menu.keys .vt-ak { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }

.vt-menu .vt-sep { height: 9px; display: flex; align-items: center; }
.vt-menu .vt-sep::after { content: ''; flex: 1; height: 1px; margin: 0 6px; background: var(--m-sep); }
.vt-menu .vt-caption {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 28px;
  color: var(--m-sec);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The chrome element whose menu is open keeps its pressed look (MenuChrome: the pill under its menu). */
#vitre-bar .item.vt-menu-owner > .tint { background: linear-gradient(var(--g-hover), var(--g-hover)), var(--g-tint); }

/* Windows' Transparency effects off. The raised variant is listed too: its own rule is more specific
 * than a plain .vt-menu one and would bring back an 86 % tint with no frost behind it. */
@media (prefers-reduced-transparency: reduce) {
  #layer-menus .vt-menu, #layer-menus .vt-menu.t-raised { backdrop-filter: none; --m-tint: #2c2c2c; --m-rim: linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08)); --m-plate: rgba(255,255,255,0.10); --m-plate-in: none; --m-press: rgba(255,255,255,0.07); }
  #layer-menus .vt-menu.t-light { --m-tint: #f9f9f9; --m-rim: linear-gradient(rgba(0,0,0,0.06), rgba(0,0,0,0.06)); --m-plate: rgba(0,0,0,0.06); }
}
@media (forced-colors: active) {
  #layer-menus .vt-menu, #vitre-menus-top .vt-menu { backdrop-filter: none; background: Canvas; color: CanvasText; box-shadow: none; border: 1px solid CanvasText; }
  #layer-menus .vt-menu::after, #vitre-menus-top .vt-menu::after { display: none; }
  .vt-menu .vt-mi { color: CanvasText; }
  .vt-menu .vt-plate { forced-color-adjust: none; background: Highlight; box-shadow: none; }
  .vt-menu .vt-mi.active:not([aria-disabled="true"]) { forced-color-adjust: none; color: HighlightText; }
  .vt-menu .vt-mi.active:not([aria-disabled="true"]) .vt-mi-accel { color: HighlightText; }
  .vt-menu .vt-mi[aria-disabled="true"] { opacity: 1; color: GrayText; }
  .vt-menu .vt-sep::after { background: CanvasText; }
  #layer-menus .vt-wash { forced-color-adjust: none; background: transparent; outline: 2px solid Highlight; }
}

/* Element full screen hides #vitre-root: menus are drawn in a top-layer host instead (view.ts). */
#vitre-menus-top { position: fixed; inset: 0; margin: 0; padding: 0; border: 0; width: auto; height: auto; max-width: none; max-height: none; background: transparent; overflow: visible; pointer-events: none; color-scheme: normal; }
#vitre-menus-top > .vt-menus { position: absolute; inset: 0; pointer-events: none; }
#vitre-menus-top .vt-catcher { position: absolute; inset: 0; pointer-events: auto; }
#vitre-menus-top .vt-catcher[data-off] { display: none; }
#vitre-menus-top .vt-wash { display: none; }
`;
