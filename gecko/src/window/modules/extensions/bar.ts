// The extensions cluster in the active pill: page action buttons, the pinned extension buttons (the
// CustomizableUI toolbar AREA holding Firefox's real browserAction widgets) and Firefox's own
// extensions button, moved out of the hidden nav bar. One cluster per window; it moves into the
// active pill's accessories slot (b.bar.accessories()) after every render.
//
//   <span class="vx-cluster">
//     <span class="vx-pas">          Deer-drawn page action buttons (correction 7)
//     <toolbar id="vitre-ext-bar">   pinned widgets (CustomizableUI area, recipe steps 1-5)
//     #unified-extensions-button      opens Firefox's extensions panel for the rest
//     <span class="vx-hang">          hang point for routed popups (extension and page action
//                                     popups, "was added"), moved over the button they belong to
//     <span class="vx-door">          hang point for add-on doorhangers (over the extensions button)
//
// Room: the pill keeps at least MIN_ADDRESS px for the address. Pinned buttons that do not fit are
// hidden from the pill (class vx-overflow) and lent to Firefox's panel while it is open, as
// Firefox does for buttons of a collapsed toolbar (#overflowed-extensions-list, cui-anchorid).
// A pill too narrow even for the extensions button alone (MIN_ADDRESS_SQUEEZED) drops the cluster.
//
// The extensions button (mousedown / Enter / Space):
//   - something waits for a review (a permission-adding update, an add-on another program
//     installed): a menu of those reviews first (the 'menus' service), else the first review opens;
//   - no extension runs in this window: Firefox's panel when it has something to say (disabled
//     extensions, a private window without access), otherwise the empty-state menu (Get add-ons,
//     Load temporary add-on, Settings › Extensions);
//   - every running extension is pinned and visible: Settings › Extensions (Firefox would open
//     about:addons);
//   - otherwise Firefox's panel, with the pinned buttons that did not fit listed in it.
//
// Anchors: b.setAnchor routes Firefox's popups to the hang points ('bottomright topright', 8 px
// under the pill): extension popups (customizationui-widget-panel), page action popups (one route
// per page action: <widget id>-panel) and the app-menu doorhanger when it says "<name> was added"
// (other app-menu notices go to the + circle, as the core routes the app menu). Add-on
// doorhangers (install, permissions, failures) ask gUnifiedExtensions.getPopupAnchorID, which
// points at the door element; the core's doorhanger hook accepts it because it is visible inside
// #vitre-root, and falls back to the pill when the cluster is not drawn (Home, popups).
// The extensions panel stays anchored to the button itself (its open state is Firefox's toggle);
// hangUnderPill puts it 8 px under the pill, its right edge on the button's (the button's
// delegatesanchor is removed, so the panel does not hang from the 16 px icon).
//
// Keyboard (keymap.json "Menus and focus"): every drawn button of the cluster is a tab bar stop
// (data-bar-stop, src/window/barkeys.ts): Tab from the address field, Left / Right, Enter / Space
// presses, Shift+F10 / the Menu key opens its menu with the first row focused.
// F11: the toolbar carries fullscreentoolbar, or Firefox collapses it in full screen.
// Firefox's own items about extensions say what Deer says (fx.VITRE_LABELS: "Pin to tab bar"...),
// and the panel's gear menu "Remove extension…" asks in Settings › Extensions like Deer's menu.
import type { Browser } from '../../browser';
import { el } from '../../dom';
import { CSS } from './css';
import * as fx from './fx';
import type { ExtMenus } from './menu';
import { PageActions } from './pageactions';

/** The CustomizableUI area (src/modules/VitreExtensions.sys.ts AREA). */
export const AREA = 'vitre-ext-bar';

/** Room the address keeps in the pill whatever the pinned buttons take (CSS px). */
const MIN_ADDRESS = 140;
/** Below this much room for the address next to the extensions button alone, the cluster is not drawn. */
const MIN_ADDRESS_SQUEEZED = 100;
/**
 * The pill's fixed parts around the address (bar.css / board HomeBrowse): Back 8+28, Forward 2+28,
 * address margins 10+6, download mark 28+4, Reload 28+10, the cluster's own 2 px margin.
 */
const PILL_FIXED = 154;
const BUTTON = 28;
const GAP = 2;

/**
 * A keyboard stop of the tab bar (src/window/barkeys.ts: Tab from the address field, then Left /
 * Right; keymap.json "Menus and focus"). XUL toolbarbuttons take focus only with a tabindex; -1
 * keeps them out of the document's Tab order, as the bar's other stops are reached by arrows.
 * Buttons hidden for room have no box and are skipped by barkeys.ts.
 */
function barStop(node: Element): void {
  if (!node.hasAttribute('data-bar-stop')) node.setAttribute('data-bar-stop', '');
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
}

/** Deer's tooltip on any element, XUL ones included (tips.ts reads data-tip / data-key). */
function tip(node: Element, label: string): void {
  // While a popup hangs from the cluster the tip waits in data-vx-tip (ExtBar.muteTips).
  const attr = node.hasAttribute('data-vx-tip') ? 'data-vx-tip' : 'data-tip';
  if (node.getAttribute(attr) !== label) node.setAttribute(attr, label);
  node.removeAttribute('data-key');
}

export class ExtBar {
  readonly cluster: HTMLElement;
  readonly toolbar: Element;
  readonly hang: HTMLElement;
  readonly door: HTMLElement;
  readonly pageActions: PageActions;
  menus: ExtMenus | null = null;
  /** Pinned widget ids hidden from the pill for lack of room. */
  readonly overflowed = new Set<string>();
  /** Widget ids lent to the open panel. */
  private lent = new Set<string>();
  private cleanups: (() => void)[] = [];
  private fitQueued = false;
  private attention = false;
  /**
   * Widgets coming and going (children of the toolbar), and Firefox putting its tooltiptext back
   * (l10n, action updates). Changes deeper in a widget are not structure: a badge's text is a
   * childList change inside the button, and an ad blocker updates it for every blocked request
   * (a refit and a tooltip pass per badge update before; verifier, stress.js).
   */
  private watch = new MutationObserver((records) => {
    let structure = false;
    for (const r of records) {
      if (r.type === 'childList') structure ||= r.target === this.toolbar;
      else if (r.type === 'attributes') this.tipFor(r.target as Element);
    }
    if (structure) {
      this.tips();
      this.fitSoon();
    }
  });

  constructor(private b: Browser) {
    b.css('extensions', CSS);
    this.pageActions = new PageActions(
      b,
      () => this.fitSoon(),
      (panelId, button) =>
        b.setAnchor(`extension-page-action:${panelId}`, () => (button ? this.hangOver(button) : null), {
          popups: button ? [panelId] : [],
          position: 'bottomright topright',
        })
    );
    this.toolbar = (document as any).createXULElement('toolbar');
    this.toolbar.id = AREA;
    this.toolbar.setAttribute('customizable', 'true');
    this.toolbar.setAttribute('mode', 'icons');
    // Firefox's toolbar menu stays the fallback when no 'menus' service is installed.
    this.toolbar.setAttribute('context', fx.TOOLBAR_CONTEXT_MENU_ID);
    this.toolbar.setAttribute('aria-label', 'Pinned extensions');
    // F11: Firefox collapses every toolbar without this attribute (fullscreen-and-pointerlock.css
    // ":root[inFullscreen] toolbar:not([fullscreentoolbar=true]) { visibility: collapse }"), which
    // emptied the pill in full screen.
    this.toolbar.setAttribute('fullscreentoolbar', 'true');
    this.hang = el('span', { class: 'vx-hang', 'aria-hidden': 'true' });
    // A XUL element: PopupNotifications takes nothing else as a doorhanger anchor (fx.overridePopupAnchor).
    this.door = (document as any).createXULElement('box') as HTMLElement;
    this.door.className = 'vx-door';
    this.door.id = 'vitre-ext-door';
    this.door.setAttribute('aria-hidden', 'true');
    this.cluster = el('span', { class: 'vx-cluster vx-parked vx-nopins', role: 'group', 'aria-label': 'Extensions' }, this.pageActions.host);
    this.cluster.append(this.toolbar, this.hang, this.door);
  }

  /**
   * At install (DOMContentLoaded): the toolbar must be in the document before Firefox's
   * CustomizableUI initialises this window (it registers every toolbar area it finds by id).
   * The cluster waits in the bar layer until the first render puts it in the pill.
   */
  mount(): void {
    this.b.layer('bar', 10).append(this.cluster);
    this.watch.observe(this.toolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ['tooltiptext', 'label'] });
    this.cleanups.push(() => this.watch.disconnect());
    this.adoptButton();
    this.place();
    this.cleanups.push(this.b.on('render', () => this.place()));
    this.cluster.addEventListener('contextmenu', (e) => this.onContextMenu(e), true);
    this.anchors();
  }

  /** Delayed startup: Firefox's lazy objects (gUnifiedExtensions, CustomizableUI's window state) exist. */
  ready(): void {
    try {
      // A no-op when CustomizableUI already registered it while initialising the window.
      fx.registerToolbarNode(this.toolbar);
    } catch (e) {
      console.error('Deer extensions: could not register the pill toolbar', e);
    }
    this.adoptButton();
    // "Pin to Toolbar" everywhere means the pill (recipe step 4).
    fx.overridePinToToolbar((widgetId, pin) => fx.moveWidget(widgetId, pin ? AREA : fx.AREA_ADDONS(), pin ? undefined : 0));
    // When the cluster is not drawn (Home) the door is not visible: the core's doorhanger hook
    // hangs the doorhanger from the pill instead.
    fx.overridePopupAnchor(() => this.door);
    this.watchPanel();
    this.vitreWords();
    this.pageActions.start();
    this.cleanups.push(() => this.pageActions.stop());
    this.tips();
    this.place();
  }

  destroy(): void {
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* the window is closing */
      }
    }
  }

  // ---- placement ----

  /** The cluster is in the active pill and drawn there (not Home, not a popup window). */
  drawn(): boolean {
    return !this.cluster.classList.contains('vx-parked') && this.cluster.getClientRects().length > 0;
  }

  /** After every render: follow the active pill, match the glass, refit. */
  place(): void {
    const host = this.b.bar.accessories();
    if (host && this.cluster.parentElement !== host) host.append(this.cluster);
    this.cluster.classList.toggle('vx-parked', !host);
    // Dark and clear glass want an extension's light icon (theme_icons): Firefox's brighttext rule.
    this.toolbar.toggleAttribute('brighttext', this.b.theme() !== 'light');
    this.pageActions.paint();
    this.fit();
  }

  private fitSoon(): void {
    if (this.fitQueued) return;
    this.fitQueued = true;
    queueMicrotask(() => {
      this.fitQueued = false;
      this.fit();
    });
  }

  /** How many pinned buttons fit next to the page actions, and which are hidden. */
  fit(): void {
    if (this.lent.size) return; // the panel is open with some of them: refit when it closes
    const nodes = [...this.toolbar.children].filter((n) => n.localName === 'toolbaritem' || n.id);
    const pill = this.b.bar.layout.pillRect?.width ?? 480;
    // A very narrow pill (small window, many tabs) keeps its address: the cluster steps out and
    // its popups hang from the pill (hangOver's fallback).
    this.cluster.classList.toggle('vx-squeezed', pill - PILL_FIXED - BUTTON < MIN_ADDRESS_SQUEEZED);
    // Page actions come first (they cannot go into the panel), as long as the address keeps
    // MIN_ADDRESS_SQUEEZED; pinned buttons share what is left above MIN_ADDRESS.
    const paSlots = Math.max(0, Math.floor((pill - PILL_FIXED - BUTTON - MIN_ADDRESS_SQUEEZED) / (BUTTON + GAP)));
    const shownPa = this.pageActions.fitTo(paSlots);
    const room = pill - PILL_FIXED - MIN_ADDRESS - BUTTON;
    const slots = Math.max(0, Math.floor(room / (BUTTON + GAP)));
    const forPins = Math.max(0, slots - shownPa);
    this.overflowed.clear();
    nodes.forEach((node, i) => {
      const over = i >= forPins;
      node.classList.toggle('vx-overflow', over);
      if (over && node.id) this.overflowed.add(node.id);
    });
    this.cluster.classList.toggle('vx-nopins', nodes.length - this.overflowed.size === 0);
    this.cluster.dataset.pinned = String(nodes.length);
    this.cluster.dataset.shown = String(nodes.length - this.overflowed.size);
  }

  // ---- Firefox's extensions button ----

  /** Move #unified-extensions-button out of the hidden nav bar, after the pinned buttons. */
  private adoptButton(): void {
    const button = fx.extensionsButton();
    if (!button || button.parentElement === this.cluster) return;
    this.toolbar.after(button);
    // browser.xhtml gives it delegatesanchor: popups anchored to it would hang from its 16 px icon,
    // so the panel's right edge sat 6 px inside the button's. The pill's rule is the button's edge,
    // as for every other popup and menu of the cluster.
    button.removeAttribute('delegatesanchor');
    this.watch.observe(button, { attributes: true, attributeFilter: ['tooltiptext'] });
    // Its own mousedown handler is delegated on #navigator-toolbox, which it left.
    button.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      void this.activate(button);
    });
    button.addEventListener('keypress', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      void this.activate(button, true);
    });
    this.tipFor(button);
    barStop(button);
  }

  get button(): Element | null {
    const button = fx.extensionsButton();
    return button && this.cluster.contains(button) ? button : null;
  }

  /** The button was pressed (`keyboard`: with Enter / Space). See the header for what it opens. */
  async activate(button: Element | null = this.button, keyboard = false): Promise<void> {
    const reviews = this.b.sys('VitreExtensions').pending();
    if (reviews.length) {
      if (button && this.menus?.reviews(reviews, button, keyboard)) return;
      this.b.sys('VitreExtensions').review(reviews[0], window.gBrowser);
      return;
    }
    await this.openPanel(button, keyboard);
  }

  /** Firefox's panel, or what stands for it when it would be empty (the 'extensions' service's openPanel). */
  async openPanel(button: Element | null = this.button, keyboard = false): Promise<void> {
    if (fx.panelOpen()) {
      await fx.togglePanel();
      return;
    }
    const policies = fx.activePolicies();
    const privateMissing = fx.privateWindowMissingExtensions();
    if (!policies.length) {
      const info = await fx.disabledExtensionsInfo();
      if (info.isAnyDisabled || privateMissing) await this.showPanel();
      else if (!button || !this.menus?.empty(button, keyboard)) this.menus?.openSettings();
      return;
    }
    if (!fx.hasExtensionsInPanel(policies) && !this.overflowed.size && !privateMissing && !(await fx.disabledExtensionsInfo()).isAnyDisabled) {
      // Every extension is pinned and in view: the list lives in Settings › Extensions.
      this.menus?.openSettings();
      return;
    }
    await this.showPanel();
  }

  private async showPanel(): Promise<void> {
    if (!this.drawn()) {
      // No button on screen (Home, a popup window): Firefox's panel needs its anchor.
      this.menus?.openSettings();
      return;
    }
    this.lend();
    await fx.togglePanel();
    // togglePanel bails out in customize mode and the like: give the buttons back at once.
    window.setTimeout(() => {
      if (!fx.panelOpen()) this.giveBack();
    }, 1500);
  }

  /** Pinned buttons that did not fit go into the panel while it is open (#overflowed-extensions-list). */
  private lend(): void {
    const list = fx.overflowList();
    if (!list) return;
    for (const id of this.overflowed) {
      const node = fx.widgetNode(id);
      if (!node || node.parentElement !== this.toolbar) continue;
      node.classList.remove('vx-overflow');
      fx.markOverflowed(node, true);
      fx.setWidgetLook(id, node, true);
      list.append(node);
      this.lent.add(id);
    }
  }

  /** The panel closed: lent buttons go back to their place in the pill (by their CUI position). */
  private giveBack(): void {
    if (!this.lent.size) return;
    const order = fx.widgetIdsIn(AREA);
    for (const id of [...this.lent]) {
      const node = fx.widgetNode(id);
      this.lent.delete(id);
      if (!node) continue;
      fx.markOverflowed(node, false);
      if (fx.areaOf(id) !== AREA) continue; // unpinned from the panel meanwhile: Firefox placed it
      fx.setWidgetLook(id, node, false);
      const after = order.slice(order.indexOf(id) + 1).map((x) => fx.widgetNode(x)).find((n) => n?.parentElement === this.toolbar);
      if (after) this.toolbar.insertBefore(node, after);
      else this.toolbar.append(node);
    }
    this.fit();
  }

  private watchPanel(): void {
    const hidden = (e: Event): void => {
      const t = e.target as Element;
      if (t.id === fx.EXTENSIONS_PANEL_ID) this.giveBack();
    };
    // The panel is built lazily; popuphidden bubbles to the document.
    document.addEventListener('popuphidden', hidden);
    this.cleanups.push(() => document.removeEventListener('popuphidden', hidden));
    // Its footer "Manage extensions" opens Settings › Extensions instead of about:addons, and
    // "Remove extension…" of its gear menu (or of the fallback toolbar menu) asks in Settings ›
    // Extensions, as Deer's own button menu does, instead of Firefox's window-modal dialog.
    const command = (e: Event): void => {
      const t = e.target as Element | null;
      if (!t || !this.menus?.hasSettings()) return;
      if (t.id === fx.MANAGE_BUTTON_ID) {
        e.stopImmediatePropagation();
        e.preventDefault();
        fx.panel()?.hidePopup?.();
        this.menus.openSettings();
        return;
      }
      if (!fx.REMOVE_ITEM_IDS.includes(t.id)) return;
      const menu = t.parentElement as any;
      const id = fx.menuExtensionId(menu);
      if (!id) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      menu?.hidePopup?.();
      fx.panel()?.hidePopup?.();
      this.menus.remove(id);
    };
    document.addEventListener('command', command, true);
    this.cleanups.push(() => document.removeEventListener('command', command, true));
  }

  /**
   * Firefox's own items about extensions in Deer's words (fx.VITRE_LABELS): now for the menus that
   * exist from the start, and again as a popup that holds one shows (the "was added" notice is
   * built from a template the first time it opens; Firefox turns its lazy Fluent ids into real
   * ones just before showing).
   */
  private vitreWords(): void {
    const relabel = (): void => {
      for (const [id, label, accesskey] of fx.VITRE_LABELS) fx.relabel(id, label, accesskey);
    };
    relabel();
    const showing = (e: Event): void => {
      const id = (e.target as Element | null)?.id;
      if (id === fx.APPMENU_NOTIFICATION_ID || id === fx.PANEL_CONTEXT_MENU_ID || id === fx.TOOLBAR_CONTEXT_MENU_ID) relabel();
    };
    document.addEventListener('popupshowing', showing, true);
    this.cleanups.push(() => document.removeEventListener('popupshowing', showing, true));
  }

  // ---- indicator ----

  /** Something waits for the user's review (VitreExtensions.pending()). */
  setAttention(on: boolean, label: string): void {
    this.attention = on;
    const button = this.button;
    if (!button) return;
    button.classList.toggle('vx-attention', on);
    tip(button, label);
  }

  // ---- tooltips: Deer's own (title / tooltiptext show Firefox's native tooltip) ----

  private tips(): void {
    for (const b of this.toolbar.querySelectorAll('.unified-extensions-item-action-button')) {
      this.tipFor(b);
      barStop(b);
    }
    const button = this.button;
    if (button) {
      this.tipFor(button);
      barStop(button);
    }
  }

  private tipFor(node: Element): void {
    if (!node || node.nodeType !== 1) return;
    const isButton = node.id === 'unified-extensions-button';
    if (!isButton && !node.classList?.contains('unified-extensions-item-action-button')) return;
    const text = node.getAttribute('tooltiptext');
    if (text) node.removeAttribute('tooltiptext');
    if (isButton) {
      if (!this.attention) tip(node, 'Extensions');
      return;
    }
    const label = node.getAttribute('label') || text || '';
    if (label) tip(node, label);
  }

  // ---- anchors ----

  /** Put the hang point over `target` (inside the cluster) and return it; the pill when nothing is drawn. */
  hangOver(target: Element | null): Element | null {
    if (this.drawn()) {
      const t = target && target.getClientRects().length ? target : this.button;
      if (t && t.getClientRects().length) {
        // From the cluster's right edge: buttons added on its left (a new extension, a page action
        // appearing) push the cluster's left edge, never its right one, so the hang point stays put.
        const c = this.cluster.getBoundingClientRect();
        const r = t.getBoundingClientRect();
        this.hang.style.left = 'auto';
        this.hang.style.right = `${Math.round(c.right - r.right)}px`;
        this.hang.style.width = `${Math.round(r.width)}px`;
        return this.hang;
      }
    }
    return this.b.anchor('site');
  }

  private anchors(): void {
    const b = this.b;
    b.setAnchor('extension-popup', () => this.hangOver(this.toolbar.querySelector('.unified-extensions-item-action-button[open]')), {
      popups: [fx.WIDGET_PANEL_ID],
      position: 'bottomright topright',
    });
    b.setAnchor('extension-notice', () => (fx.activeAppMenuNotification() === fx.ADDON_INSTALLED_NOTIFICATION ? this.hangOver(this.button) : b.anchor('menu')), {
      popups: [fx.APPMENU_NOTIFICATION_ID],
      position: 'bottomright topright',
    });
    // The extensions panel hangs from the button itself (Firefox toggles it by the button's open
    // state): moved down to 8 px under the pill. Every popup hanging from the cluster (the panel,
    // the add-on doorhangers on the door, which the core's router leaves alone because their anchor
    // is already Deer's) keeps the bar on screen while it is open, in place at once so the popup
    // measures the bar's real position (auto-hide and F11: a doorhanger opened at the slid-away
    // door, above the window's top edge; verifier). While any popup hangs from the cluster, its
    // buttons show no tooltip (it would sit under the popup).
    const holds = new Map<Element, () => void>();
    const open = new Set<Element>();
    const showing = (e: Event): void => {
      const popup = e.target as any;
      const anchor = popup?.anchorNode as Element | null;
      if (!anchor || !this.cluster.contains(anchor)) return;
      open.add(popup);
      this.muteTips(true);
      if (!holds.has(popup)) holds.set(popup, b.bar.hold('extension-popup', true));
      if (popup.id === fx.EXTENSIONS_PANEL_ID) this.hangUnderPill(popup, anchor);
      // A popup whose showing was cancelled fires no popuphidden (as anchors.ts guards it).
      window.setTimeout(() => {
        if (popup.state === 'closed' && open.has(popup)) hidden({ target: popup } as unknown as Event);
      }, 1000);
    };
    const hidden = (e: Event): void => {
      const popup = e.target as Element;
      if (!open.delete(popup)) return;
      if (!open.size) this.muteTips(false);
      holds.get(popup)?.();
      holds.delete(popup);
    };
    document.addEventListener('popupshowing', showing);
    document.addEventListener('popuphidden', hidden);
    this.cleanups.push(() => {
      document.removeEventListener('popupshowing', showing);
      document.removeEventListener('popuphidden', hidden);
      for (const release of holds.values()) release();
      holds.clear();
    });
  }

  /**
   * A panel anchored to an element inside the pill opens at that element's bottom edge: push it
   * down so its visible top is 8 px under the pill (the panel's own shadow margin accounted for).
   */
  private hangUnderPill(popup: HTMLElement, anchor: Element): void {
    const pill = this.cluster.closest('.item');
    if (!pill) return;
    const shadow = parseFloat(getComputedStyle(popup).getPropertyValue('--panel-box-shadow-margin')) || 0;
    // An anchor with delegatesanchor hangs its popup from its first child (adoptButton removes it
    // from the extensions button; kept for any other anchor in the cluster).
    const box = (anchor.hasAttribute('delegatesanchor') && anchor.firstElementChild) || anchor;
    const offset = Math.round(pill.getBoundingClientRect().bottom + 8 - box.getBoundingClientRect().bottom);
    popup.style.marginTop = `${offset - shadow}px`;
  }

  private muted = false;

  /** While a popup hangs from the cluster its buttons keep their tips in data-vx-tip. */
  private muteTips(on: boolean): void {
    if (this.muted === on) return;
    this.muted = on;
    if (on) this.b.bar.tips.hide();
    for (const n of this.cluster.querySelectorAll(on ? '[data-tip]' : '[data-vx-tip]')) {
      if (on) {
        n.setAttribute('data-vx-tip', n.getAttribute('data-tip') ?? '');
        n.removeAttribute('data-tip');
      } else {
        n.setAttribute('data-tip', n.getAttribute('data-vx-tip') ?? '');
        n.removeAttribute('data-vx-tip');
      }
    }
  }

  // ---- right-click ----

  private onContextMenu(e: MouseEvent): void {
    const target = e.target as Element;
    if (!this.menus?.available()) return; // Firefox's own toolbar menu (fallback)
    const item = target.closest?.('toolbaritem.unified-extensions-item');
    const at = (target.closest?.('.unified-extensions-item-action-button, #unified-extensions-button, .vx-pa') as Element | null) ?? target;
    // Shift+F10 / the Menu key arrive with button 0 (src/window/modules/menus/index.ts). The menus
    // service recognises them only while the event is dispatched, and the rows below are built
    // asynchronously: say it explicitly, so the menu opens with its first row focused.
    const keyboard = e.button === 0;
    let shown = false;
    if (item && this.toolbar.contains(item)) shown = this.menus.forWidget(item, at, keyboard);
    else if (target.closest?.('#unified-extensions-button')) shown = this.menus.forButton(at, keyboard);
    else {
      const pa = target.closest?.('.vx-pa') as HTMLElement | null;
      if (pa) shown = this.menus.forPageAction(this.pageActions.extensionFor(pa), at, keyboard);
    }
    if (shown) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}
