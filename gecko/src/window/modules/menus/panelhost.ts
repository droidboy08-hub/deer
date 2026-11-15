// macOS only: Deer's menus (each menu, and each submenu level) are hosted in XUL <panel>s, so the
// system draws their material: real Liquid Glass that blurs whatever is under the menu, the page
// included. view.ts keeps the rows, the plate, the keys and the placement exactly as in the layer;
// only the host changes. Windows never creates a PanelHost (view.ts), so it draws in #layer-menus.
//
// Why a panel is glass (Firefox 157):
//   - every <panel> and <menupopup> is a popup window of its own (widget/cocoa/nsCocoaWindow.mm,
//     PopupWindow), transparent;
//   - toolkit/themes/shared/popup.css gives it `appearance: auto; -moz-default-appearance:
//     menupopup` on macOS, which nsMenuPopupFrame::GetShadowStyle (layout/xul/nsMenuPopupFrame.cpp)
//     turns into WindowShadow::Menu;
//   - for that style nsCocoaWindow.mm newEffectViewWrapperForStyle puts the window's content inside
//     an NSGlassEffectView on macOS 26 (cornerRadius GetMenuCornerRadius(): 12 on Tahoe), or an
//     NSVisualEffectView of the Menu material before it (radius 6).
// Everything Deer paints in the panel is transparent (css.ts MENU_CSS_MAC): the window is the
// material. The panel's color-scheme is set to the menu's theme, and nsMenuPopupFrame::
// PropagateStyleToWidget hands it to nsCocoaWindow::SetColorScheme (the window's NSAppearance), so
// the glass is light or dark with Deer's text.
//
// One reusable panel per level, made on first use in #mainPopupSet, sized to the menu and opened at
// the screen point of Deer's window position for it (Window.mozInnerScreenX/Y, gecko.ts innerScreen).
// Behaviour comes from attributes the popup manager reads (layout/xul/nsXULPopupManager.cpp,
// nsMenuPopupFrame.cpp; PANEL_ATTRS below says what each one does). Outside input then behaves as
// Deer's catcher makes it behave on Windows, by Gecko's own rollup (nsCocoaWindow.mm maybeRollup):
//   - a left or middle press outside closes the menu and is swallowed (the link under it is not
//     followed): mouseDown / otherMouseDown return when the rollup consumes;
//   - a right press outside closes the menu and still reaches the page: rightMouseDown and
//     menuForEvent ignore the rollup's answer, so the contextmenu that follows opens a fresh menu
//     where it lands;
//   - the wheel outside closes the menu (rolluponmousewheel).
// A popup window never becomes the key window (PopupWindow does not override canBecomeKeyWindow;
// it is borderless), so Deer's window keeps the keyboard and the page or Deer's field keeps focus.
//
// When the system closes a panel (a press outside, the wheel, b.closePanels()), its popuphidden is
// reported to the view as lost(level). A hide the view asks for (hide()) is not reported.
import { innerScreen } from './gecko';

/** A menu panel's place and size, window CSS px (the view's Panel.box). */
export interface PanelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type PanelScheme = 'light' | 'dark';

interface Slot {
  panel: any;
  /** Deer opened this panel and has not hidden it: a popuphidden now is the system's. */
  owned: boolean;
}

/**
 * The attributes of a menu panel (all read by layout/xul/nsXULPopupManager.cpp or
 * nsMenuPopupFrame.cpp, except norestorefocus: toolkit/content/widgets/panel.js).
 */
const PANEL_ATTRS: [string, string][] = [
  // An ordinary auto-hiding popup: Gecko's rollup closes it on a press outside (nsMenuChainItem
  // IsNoAutoHide; nsXULPopupManager::RollupInternal).
  ['noautohide', 'false'],
  // The press that closes it is swallowed (nsMenuPopupFrame::ConsumeOutsideClicks): what Firefox's
  // context menu in #mainPopupSet gets on macOS by default, said explicitly.
  ['consumeoutsideclicks', 'true'],
  // The wheel outside closes it, as Deer's catcher does on Windows, instead of being eaten while the
  // menu stays (nsXULPopupManager::ShouldRollupOnMouseWheelEvent).
  ['rolluponmousewheel', 'true'],
  // A child window of Deer's window: above it, moving with it, never over other applications
  // (nsMenuPopupFrame::GetPopupLevel; nsCocoaWindow::Show addChildWindow:ordered:).
  ['level', 'parent'],
  // Required. Without it nsXULPopupManager::BeginShowingPopup clears the window's focus whenever a
  // panel shows (ClearFocus, whatever the panel holds): the page's caret, selection and edit commands
  // would go.
  ['noautofocus', 'true'],
  // panel.js on_popuphidden leaves focus alone; Deer puts it back itself (view.ts restoreFocus).
  ['norestorefocus', 'true'],
  // No key listener of the popup manager (nsXULPopupManager::UpdateKeyboardListeners): every key,
  // Esc included, goes through Deer's router to the menu (index.ts hook).
  ['ignorekeys', 'true'],
  // No accessible of its own (nsAccessibilityService::CreateAccessible: a noautofocus panel would be
  // an alert, XULMap.inc); the role="menu" inside is what assistive technology meets.
  ['role', 'presentation'],
];

/** browser.xhtml's <popupset id="mainPopupSet"> (browser/base/content/main-popupset.inc.xhtml), home of Firefox's own panels. */
const popupSet = (): Element => document.getElementById('mainPopupSet') ?? document.documentElement;

/**
 * A new XUL <panel> (Document.createXULElement, dom/webidl/Document.webidl). Connected, it upgrades
 * to MozPanel (toolkit/content/widgets/panel.js): its children are slotted into <html:slot
 * part="content">, shown from popupshowing.
 */
const createPanel = (): any => (document as any).createXULElement('panel');

/**
 * XULPopupElement.openPopupAtScreen(x, y, isContextMenu) (dom/chrome-webidl/XULPopupElement.webidl):
 * CSS px from the primary screen's top-left. nsXULPopupManager::ShowPopupAtScreen fires popupshowing
 * synchronously (the content is laid out when it returns); not a context menu, so no offset.
 */
const openAtScreen = (panel: any, x: number, y: number): void => panel.openPopupAtScreen(x, y, false);

/** XULPopupElement.moveTo(left, top) (same file): an open popup to a screen point, CSS px. */
const moveTo = (panel: any, x: number, y: number): void => panel.moveTo(x, y);

/** XULPopupElement.sizeTo(width, height) (dom/xul/XULPopupElement.cpp): style width and height; an open popup is placed again. */
const sizeTo = (panel: any, w: number, h: number): void => panel.sizeTo(w, h);

/**
 * XULPopupElement.hidePopup() (dom/xul/XULPopupElement.cpp -> nsXULPopupManager::HidePopup):
 * synchronous for a panel without an `animate` attribute (nsXULPopupManager::FirePopupHidingEvent),
 * so popuphidden has fired and the state is "closed" when it returns.
 */
const hidePanel = (panel: any): void => panel.hidePopup(false);

/** XULPopupElement.state: "closed", "showing", "open" or "hiding". */
const stateOf = (panel: any): string => String(panel?.state ?? 'closed');

/** The screen point (CSS px) of a window point, rounded as openPopupAtScreen takes it. */
function screenPoint(box: PanelBox): { x: number; y: number } {
  const o = innerScreen();
  return { x: Math.round(o.x + box.left), y: Math.round(o.y + box.top) };
}

export class PanelHost {
  private readonly slots: (Slot | undefined)[] = [];

  constructor(private readonly lost: (level: number) => void) {}

  /**
   * Show `content` as menu level `level` (0 the menu, 1 its submenu...): `box` in window CSS px, the
   * glass in `scheme`. False when the panel did not open (refused or cancelled): the content is
   * taken out again and the caller draws the menu in its layer.
   */
  show(level: number, content: HTMLElement, box: PanelBox, scheme: PanelScheme): boolean {
    let s: Slot | null = null;
    try {
      s = this.slot(level);
      s.panel.replaceChildren(content);
      s.panel.style.colorScheme = scheme;
      sizeTo(s.panel, box.width, box.height);
      s.owned = true;
      const at = screenPoint(box);
      openAtScreen(s.panel, at.x, at.y);
      if (stateOf(s.panel) !== 'closed') return true;
    } catch (err) {
      console.error('Deer: menu panel failed to open', err);
    }
    if (s) s.owned = false;
    content.remove();
    return false;
  }

  /** Move and size the open panel of `level` (a better anchor arrived, or the rows changed). */
  place(level: number, box: PanelBox): void {
    const s = this.slots[level];
    if (!s?.owned) return;
    try {
      sizeTo(s.panel, box.width, box.height);
      const at = screenPoint(box);
      moveTo(s.panel, at.x, at.y);
    } catch (err) {
      console.error('Deer: menu panel failed to move', err);
    }
  }

  /** Hide `level` and every level above it (the deepest first) and drop their content. Not reported as lost. */
  hide(level: number): void {
    for (let i = this.slots.length - 1; i >= level; i--) {
      const s = this.slots[i];
      if (!s) continue;
      s.owned = false;
      try {
        const st = stateOf(s.panel);
        if (st === 'open' || st === 'showing') hidePanel(s.panel);
      } catch (err) {
        console.error('Deer: menu panel failed to hide', err);
      }
      s.panel.replaceChildren();
    }
  }

  /** The panel of `level`, closed and ready to show: made on first use, made again if it will not close. */
  private slot(level: number): Slot {
    let s = this.slots[level];
    if (s && stateOf(s.panel) !== 'closed') {
      // Never expected: the view hides a level before it shows it again.
      s.owned = false;
      hidePanel(s.panel);
      if (stateOf(s.panel) !== 'closed') {
        s.panel.remove();
        s = undefined;
      }
    }
    if (!s) {
      s = this.make(level);
      this.slots[level] = s;
    }
    return s;
  }

  private make(level: number): Slot {
    const panel = createPanel();
    panel.id = `vitre-menu-panel-${level}`;
    // .vt-menus: code that asks whether a press was on a glass menu (closest('.vt-menus')) finds it.
    panel.className = 'vt-menus vt-menu-host';
    for (const [name, value] of PANEL_ATTRS) panel.setAttribute(name, value);
    const slot: Slot = { panel, owned: false };
    // popuphidden is dispatched on the panel by nsXULPopupManager::HidePopupCallback.
    panel.addEventListener('popuphidden', (e: Event) => {
      if (e.target !== panel || !slot.owned) return;
      slot.owned = false;
      try {
        this.lost(level);
      } catch (err) {
        console.error('Deer: menu close after its panel hid failed', err);
      }
    });
    popupSet().append(panel);
    return slot;
  }
}
