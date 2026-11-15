// Styles of the extensions module, injected once per window with b.css('extensions', CSS).
//
// Look (no extensions board exists; built from the bar's rules in DESIGN-NOTES and bar.css):
//   - the cluster sits in the active pill between the address and the download mark's slot:
//     [page actions][pinned buttons][extensions button], 28 px round icon buttons 2 px apart, the
//     pill's own hover / press tints (--g-hover / --g-press), icons 16 px in the glass's icon colour;
//   - badges are 14 px capsules in the extension's own colours with a 1.5 px ring of the glass
//     tint, so they read on light, dark and clear glass;
//   - the extensions button carries a 7 px accent dot when something waits for the user (a parked
//     permission review, or Firefox's own "needs access to this site" attention);
//   - on Home and in popup windows the cluster is not drawn (nothing there to act on);
//   - Firefox's native panels opened from it (the extensions panel, extension popups, page action
//     popups, the gear menu) cannot be glass (separate OS windows): they get the design's opaque
//     menu material ("Transparency effects off": #2C2C2C / #F9F9F9, flat 1 px rim, radius 12, the
//     menu shadows) and hang 8 px under the pill;
//   - Firefox-only entries (Report, toolbar customisation, the empty-panel illustration) are hidden.
export const CSS = `
/* ---- the cluster in the pill ---- */
#vitre-root .vx-cluster {
  --vx-ring: rgba(255,255,255,0.92);
  --vx-accent: #005fb8;
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  margin-right: 2px;
  flex-shrink: 0;
  -moz-window-dragging: no-drag;
}
#vitre-root:is(.theme-dark, .theme-clear) .vx-cluster { --vx-ring: rgba(26,26,30,0.92); --vx-accent: #4cc2ff; }
#vitre-root .vx-cluster.vx-parked,
#vitre-root .vx-cluster.vx-squeezed,
#vitre-bar .item.home .vx-cluster,
#vitre-root.popup .vx-cluster { display: none; }
#vitre-root .vx-pas { display: flex; align-items: center; gap: 2px; }
#vitre-root .vx-pas:empty { display: none; }

/* The CustomizableUI toolbar holding the pinned widgets. */
#vitre-root #vitre-ext-bar {
  appearance: none !important;
  display: flex !important;
  align-items: center;
  gap: 2px;
  height: 28px;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: none !important;
  box-shadow: none !important;
  color: var(--g-icon);
  -moz-window-dragging: no-drag;
}
#vitre-root .vx-cluster.vx-nopins #vitre-ext-bar { display: none !important; }
#vitre-ext-bar > toolbaritem {
  margin: 0 !important;
  padding: 0 !important;
  height: 28px;
  display: flex !important;
  align-items: center;
  flex: none;
}
#vitre-ext-bar > toolbaritem.vx-overflow { display: none !important; }
#vitre-ext-bar .unified-extensions-item-row-wrapper { flex: none !important; display: flex; }
#vitre-ext-bar :is(.unified-extensions-item-menu-button, .unified-extensions-item-contents, unified-extensions-item-messagebar-wrapper) { display: none !important; }

/* Round icon buttons: pinned widgets, page actions, the extensions button. */
:is(#vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-cluster #unified-extensions-button, #vitre-root .vx-cluster .vx-pa) {
  appearance: none !important;
  box-sizing: border-box !important;
  position: relative;
  width: 28px !important;
  height: 28px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 14px !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--g-icon) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex: none !important;
  overflow: visible !important;
  outline: none;
  -moz-context-properties: fill, fill-opacity, stroke;
  fill: currentColor;
  stroke: currentColor;
}
:is(#vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-cluster #unified-extensions-button, #vitre-root .vx-cluster .vx-pa):hover { background: var(--g-hover) !important; }
:is(#vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-cluster #unified-extensions-button, #vitre-root .vx-cluster .vx-pa):is(:hover:active, [open]) { background: var(--g-press) !important; }
/* Keyboard stops of the tab bar (data-bar-stop, src/window/barkeys.ts): the bar's focus ring. */
:is(#vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-cluster #unified-extensions-button, #vitre-root .vx-cluster .vx-pa):focus-visible { outline: 2px solid var(--g-text) !important; outline-offset: 1px; }
#vitre-ext-bar .unified-extensions-item-action-button[disabled] { opacity: 0.4; background: transparent !important; }
/* Two ids: the button rule above is :is(...) with an id inside, which outranks one id. */
#vitre-root #vitre-bar .vx-cluster .vx-pa:is([hidden], .vx-overflow) { display: none !important; }
#vitre-root .vx-cluster .vx-pa.vx-off { opacity: 0.4; }

/* 16 px icons; Firefox's padding, plates and focus backgrounds off. */
#vitre-ext-bar .unified-extensions-item-action-button > .toolbarbutton-badge-stack {
  display: grid !important;
  width: 16px !important;
  height: 16px !important;
  min-width: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border-radius: 0 !important;
  background: none !important;
  box-shadow: none !important;
  outline: none !important;
}
:is(#vitre-ext-bar .toolbarbutton-badge-stack > .toolbarbutton-icon, #vitre-root .vx-cluster #unified-extensions-button > .toolbarbutton-icon) {
  grid-area: 1 / 1;
  width: 16px !important;
  height: 16px !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: none !important;
  box-shadow: none !important;
}
#vitre-root .vx-cluster #unified-extensions-button { list-style-image: url("chrome://mozapps/skin/extensions/extension.svg"); }
#vitre-root .vx-cluster #unified-extensions-button > .toolbarbutton-text { display: none !important; }
#vitre-root .vx-cluster .vx-pa > img { width: 16px; height: 16px; pointer-events: none; }

/* Badges: the extension's colours (badgeStyle), a ring of the glass tint. */
#vitre-ext-bar .toolbarbutton-badge {
  grid-area: 1 / 1;
  place-self: start end !important;
  box-sizing: border-box !important;
  min-width: 14px !important;
  max-width: 28px !important;
  height: 14px !important;
  margin: -7px -8px 0 0 !important;
  padding: 0 3.5px !important;
  border-radius: 7px !important;
  font: 600 9.5px/14px "Segoe UI Variable Text", "Segoe UI", sans-serif !important;
  text-align: center;
  text-shadow: none !important;
  overflow: hidden;
  box-shadow: 0 0 0 1.5px var(--vx-ring) !important;
}
#vitre-ext-bar .toolbarbutton-badge:empty { display: none !important; }

/* Something waits for the user: Deer's dot (Firefox's own dot is replaced). */
#vitre-root .vx-cluster #unified-extensions-button > .toolbarbutton-icon { background-image: none !important; }
#vitre-root .vx-cluster #unified-extensions-button:is(.vx-attention, [attention])::after {
  content: "";
  position: absolute;
  top: 3px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: 4px;
  background: var(--vx-accent);
  box-shadow: 0 0 0 1.5px var(--vx-ring);
  pointer-events: none;
}
#vitre-ext-bar .unified-extensions-item[attention] .toolbarbutton-badge-stack { background-image: none !important; }

/* Hang points: native popups hang from these, spanning the pill's height (the core adds 8 px). */
#vitre-root .vx-cluster .vx-hang,
#vitre-root .vx-cluster .vx-door {
  display: block;
  position: absolute;
  top: -8px;
  left: 0;
  width: 28px;
  height: 44px;
  pointer-events: none;
  visibility: visible;
}
/* Doorhangers open at the door's bottom edge with no offset of their own: 8 px under the pill. The
 * door sits over the extensions button, the cluster's last button. */
#vitre-root .vx-cluster .vx-door { left: auto; right: 0; height: 52px; min-width: 0; min-height: 0; }

/* ---- Firefox's panels and menus opened from the cluster ---- */
:is(#unified-extensions-panel, #customizationui-widget-panel, #pageActionActivatedActionPanel, #unified-extensions-context-menu, #toolbar-context-menu) {
  --panel-background-color: light-dark(#f9f9f9, #2c2c2c);
  --panel-text-color: light-dark(rgba(0,0,0,0.9), #ffffff);
  --panel-border-color: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.1));
  --panel-border-radius: 12px;
  --panel-box-shadow: light-dark(0 16px 40px rgba(0,0,0,0.16), 0 18px 44px rgba(0,0,0,0.32)), light-dark(0 1px 3px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.3));
  --panel-separator-color: light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.1));
  --panel-item-hover-bgcolor: light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.12));
  --panel-item-active-bgcolor: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.08));
  --panel-menuitem-border-radius: 6px;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
#unified-extensions-panel { font-size: 13.5px; }
/* The panel's own header and footer copy stay; the empty-panel illustration does not. */
#unified-extensions-empty-state > img { display: none !important; }
/* Report is not offered anywhere (the pref turns most of it off; these are the leftovers). */
:is(.unified-extensions-context-menu-report-extension, .customize-context-reportExtension) { display: none !important; }

/* Fallback only (no 'menus' service): Firefox's toolbar menu on a pinned button, without the
 * entries about toolbars Deer does not have (verifier corrections 4). */
#toolbar-context-menu > :is(#toggle_toolbar-menubar, #toggle_PersonalToolbar, #viewToolbarsMenuSeparator, .viewCustomizeToolbar,
  #toolbar-context-autohide-downloads-button, #toolbar-context-always-show-extensions-button, #toolbar-context-move-to-panel,
  #toolbar-context-remove-from-toolbar, #customizationMenuSeparator, #toolbarDownloadsAnchorMenuSeparator, #toolbarNavigatorItemsMenuSeparator,
  #tabbarItemsMenuSeparator, #sidebarRevampSeparator, #toolbar-context-openANewTab, #toolbar-context-customize-sidebar,
  #toolbar-context-toggle-vertical-tabs, #toolbar-context-always-open-downloads-panel, [id^="toolbar-context-"][id*="tab"],
  [id^="toolbar-context-"][id*="Tab"]) { display: none !important; }

/* ---- Settings › Extensions (inside the Settings panel, which draws the title and the vs-* controls) ---- */
/* Scoped under #vitre-root like the panel's own rules (#vitre-root .vs-desc...), or they lose to them. */
#vitre-root .vx-page { display: flex; flex-direction: column; }
#vitre-root .vx-page > .vs-intro + .vx-actions-card { margin-top: 16px; }
#vitre-root .vx-page > .vx-more { margin-top: 16px; }
#vitre-root .vx-page .vx-ext-ico { width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
#vitre-root .vx-page .vx-ext-ico img { width: 20px; height: 20px; object-fit: contain; }
#vitre-root .vx-page .vx-ext-ico.vx-off img { opacity: 0.45; filter: grayscale(1); }
#vitre-root .vx-page .vx-meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vitre-root .vx-page .vx-warn { color: var(--vs-error, #ff99a4); }
#vitre-root .vx-page .vx-row-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
#vitre-root .vx-page .vx-sub { min-height: 44px; }
#vitre-root .vx-page .vx-sub .vx-subtitle { font-size: 13px; line-height: 18px; }
#vitre-root .vx-page .vx-empty { padding: 18px 16px; font-size: 13px; color: var(--vs-text2, rgba(255,255,255,0.6)); }
#vitre-root .vx-page .vx-path { font-size: 12px; color: var(--vs-text2, rgba(255,255,255,0.6)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
#vitre-root .vx-page .vx-confirm { display: flex; align-items: center; gap: 8px; }
#vitre-root .vx-page .vx-confirm-text { font-size: 12.5px; color: var(--vs-text2, rgba(255,255,255,0.6)); }
#vitre-root .vx-page button.vs-link.vx-danger:hover { color: var(--vs-error, #ff99a4) !important; }

/* ---- macOS, One row (window/onerow.ts; Mac canvas boards RowSpec, RowExtensions, RowDark,
   DirOneRowBehaviour): the cluster in its own 36 px capsule at the row's right end, after Downloads and
   joined to it by the liquid bridge; 30 px buttons 6 px apart, 3 px from the ends. The capsule's glass
   is the tab capsules' (skin/bar.css, One row; downloads/css.ts does the same): the row's tokens on
   #vitre-row-end give its fill (--g-tint), ink (--g-text), inset rim (--row-rim) and full shadow
   (--g-shadow), and bar.css gives it the capsules' blur, over the page. They follow the theme of the
   page under the row (theme-light: ink #1d1d1f on white 42 %; theme-dark and theme-clear: white ink),
   not the system's appearance; dark glass in a private window. The buttons' hover and press, the
   badge ring and the accent key on the same classes here (bar.ts sets brighttext to match). In split
   view a capsule over the other side's page carries that page's theme (window/bar.ts paintRowSplit:
   class over-light, over-dark or over-clear, never in a private window): its tokens come from
   skin/bar.css, its hover, press, ring and accent from the over-* rules here. ---- */
@media (-moz-platform: macos) {
  #vitre-root #vitre-row-end > .vx-rowcap {
    --vx-fill: var(--g-tint);
    --vx-hover: rgba(29,29,31,0.08);
    --vx-press: rgba(29,29,31,0.14);
    position: relative;
    flex: none;
    box-sizing: border-box;
    height: 36px;
    padding: 0 3px;
    border-radius: 18px;
    display: flex;
    align-items: center;
    color: var(--g-text);
    background: var(--vx-fill);
    box-shadow: var(--row-rim), var(--g-shadow);
    pointer-events: auto;
    -moz-window-dragging: no-drag;
  }
  /* Downloads joined to Extensions: a 12 px neck across the 8 px gap, 2 px into each capsule's box.
     Its ends are the two capsules' own circles (radius 18, centres 16 px left of the neck's box and
     28 px right of its left edge), so it never paints over a capsule: the fill is translucent, and
     the strip of it doubled inside each circle showed as a dark band at both ends over the page.
     Part of the capsule: it takes the pointer as the capsule does, where it is painted (the
     clip-path limits the hit area too), so a press on it lands on the Extensions capsule, which does
     nothing with a bare click, never on a link of the page under the row; above and below it the gap
     is the page's (#vitre-row-end is click-through: skin/bar.css). */
  #vitre-root #vitre-row-end > .vd-ring + .vx-rowcap::before {
    content: "";
    position: absolute;
    left: -10px;
    top: 0;
    width: 12px;
    height: 36px;
    clip-path: path('M0.12 10 Q6 15 11.88 10 A18 18 0 0 0 11.88 26 Q6 21 0.12 26 A18 18 0 0 0 0.12 10 Z');
    background: var(--vx-fill);
    pointer-events: auto;
  }
  #vitre-root.popup #vitre-row-end > .vx-rowcap { display: none; }
  #vitre-root .vx-rowcap > .vx-cluster { --vx-ring: rgba(255,255,255,0.92); --vx-accent: #005fb8; height: 30px; gap: 6px; margin-right: 0; }
  #vitre-root .vx-rowcap :is(.vx-pas, #vitre-ext-bar) { gap: 6px; }
  #vitre-root .vx-rowcap #vitre-ext-bar { height: 30px; color: inherit; }
  #vitre-root .vx-rowcap #vitre-ext-bar > toolbaritem { height: 30px; }
  :is(#vitre-root .vx-rowcap #vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-rowcap #unified-extensions-button, #vitre-root .vx-rowcap .vx-pa) {
    width: 30px !important;
    height: 30px !important;
    border-radius: 15px !important;
    color: inherit !important;
  }
  :is(#vitre-root .vx-rowcap #vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-rowcap #unified-extensions-button, #vitre-root .vx-rowcap .vx-pa):hover { background: var(--vx-hover) !important; }
  :is(#vitre-root .vx-rowcap #vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-rowcap #unified-extensions-button, #vitre-root .vx-rowcap .vx-pa):is(:hover:active, [open]) { background: var(--vx-press) !important; }
  :is(#vitre-root .vx-rowcap #vitre-ext-bar .unified-extensions-item-action-button, #vitre-root .vx-rowcap #unified-extensions-button, #vitre-root .vx-rowcap .vx-pa):focus-visible { outline-color: currentColor !important; }
  #vitre-root .vx-rowcap #vitre-ext-bar .unified-extensions-item-action-button[disabled] { background: transparent !important; }
  /* The pill's rule for these is under #vitre-bar, which the row's right end is not in. */
  #vitre-root #vitre-row-end .vx-rowcap .vx-pa:is([hidden], .vx-overflow) { display: none !important; }
  #vitre-root .vx-rowcap #vitre-ext-bar .toolbarbutton-badge { font-family: -apple-system, system-ui, sans-serif !important; }
  /* Hang points span the capsule (the cluster is 3 px inside it): routed popups open 8 px under the
     capsule, doorhangers at the door's bottom edge, which is that line. */
  #vitre-root .vx-rowcap .vx-cluster .vx-hang { top: -3px; height: 36px; }
  #vitre-root .vx-rowcap .vx-cluster .vx-door { top: -3px; width: 30px; height: 44px; }
}
@media (-moz-platform: macos) {
  /* theme-dark, theme-clear and a private window: light ink (the fill and ink come from the tokens). */
  #vitre-root.one-row:is(.theme-dark, .theme-clear, .private) #vitre-row-end > .vx-rowcap { --vx-hover: rgba(255,255,255,0.12); --vx-press: rgba(255,255,255,0.2); }
  #vitre-root.one-row:is(.theme-dark, .theme-clear, .private) .vx-rowcap > .vx-cluster { --vx-ring: rgba(26,26,30,0.92); --vx-accent: #4cc2ff; }
  /* Split view: over the other side's page the capsule takes that page's (bar.ts paintRowSplit). */
  #vitre-root.one-row:not(.private) #vitre-row-end > .vx-rowcap.over-light { --vx-hover: rgba(29,29,31,0.08); --vx-press: rgba(29,29,31,0.14); }
  #vitre-root.one-row:not(.private) #vitre-row-end > .vx-rowcap.over-light > .vx-cluster { --vx-ring: rgba(255,255,255,0.92); --vx-accent: #005fb8; }
  #vitre-root.one-row:not(.private) #vitre-row-end > .vx-rowcap:is(.over-dark, .over-clear) { --vx-hover: rgba(255,255,255,0.12); --vx-press: rgba(255,255,255,0.2); }
  #vitre-root.one-row:not(.private) #vitre-row-end > .vx-rowcap:is(.over-dark, .over-clear) > .vx-cluster { --vx-ring: rgba(26,26,30,0.92); --vx-accent: #4cc2ff; }

  /* Firefox's panels and menus opened from the cluster: on macOS not the Windows design's opaque
     material above but the system's own. Menus get Firefox's Mac values back (toolkit/themes/shared/
     popup.css: no background, border or CSS shadow of their own over the native menu material), and
     the panels take the menu appearance too: layout/xul/nsMenuPopupFrame.cpp GetShadowStyle() gives
     a -moz-default-appearance: menupopup popup WindowShadow::Menu, which widget/cocoa/nsCocoaWindow.mm
     (newEffectViewWrapperForStyle:) puts on an NSGlassEffectView from macOS 26 (Liquid Glass, corner
     radius 12: GetMenuCornerRadius()), and nsNativeThemeCocoa draws nothing over it (Menupopup is
     eTransparent). */
  :is(#unified-extensions-panel, #customizationui-widget-panel, #pageActionActivatedActionPanel, #unified-extensions-context-menu, #toolbar-context-menu) {
    --panel-background-color: none;
    --panel-border-color: transparent;
    --panel-box-shadow: none;
    --panel-border-radius: 12px;
    font-family: -apple-system, system-ui, sans-serif;
  }
  :is(#unified-extensions-panel, #customizationui-widget-panel, #pageActionActivatedActionPanel) {
    appearance: auto;
    -moz-default-appearance: menupopup;
  }
}
`;
