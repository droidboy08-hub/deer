// The switcher's behaviour (keymap.json "Tab switcher", SwitcherKeys board). Ported from
// app/src/renderer/modules/switcher/controller.ts; the Electron main-process key routing
// (app/src/main/modules/switcher.ts) is the key hook here (b.keys.addHook).
// - Ctrl+Tab / Ctrl+Shift+Tab step. A quick tap (Ctrl up within 150 ms) switches straight to the
//   previous tab with nothing shown; holding Ctrl shows the switcher, and letting go opens the
//   selected card. Letting go on the starting card, clicking the background or losing window focus
//   cancels.
// - Latched (Ctrl+Shift+A, the first typed character, Sticky Keys, opened by mouse or through the
//   service): Ctrl up does nothing; Enter opens, Esc cancels, Up/Down/Tab move, Left/Right edit a
//   query (they move while it is empty; Grid uses all four arrows then).
// - Ctrl+W, Ctrl+F4 or Delete (empty query) closes the selected card; middle-click closes a card.
// - While the switcher is up every Ctrl+letter except Ctrl+W types that letter into the search, and
//   any other Deer shortcut does nothing; AltGr characters, dead keys and IME input go to the field.
// - Element full screen (Deer's layer is not drawn there): Ctrl+Tab falls back to the core's MRU
//   step for the whole held gesture (the first step leaves full screen). Popup windows have one tab:
//   nothing happens.
// - Ctrl+W on a card whose page would ask "Leave page?": its tab is opened and closed there, where
//   Firefox shows the prompt (never hidden under the switcher or in a background tab).
// Focus: while the switcher is up the search field holds keyboard focus (also while it is still
// invisible, during the quick-tap window), and Firefox's tab-switch focus handling is held off
// (fx.guardTabSwitchFocus), so closing the current tab under the switcher cannot pull focus into a
// page.
import type { Browser } from '../../browser';
import { svg } from '../../dom';
import * as fx from '../../firefox';
import { icons } from '../../icons';
import type { KeyVerdict } from '../../keys';
import type { Binding } from '../../../shared/shortcuts';
import type { Tab } from '../../model';
import { DeckView } from './deck';
import { asksBeforeClosing, mayAskBeforeClosing } from './gecko';
import { GridView } from './grid';
import { el, optionId, reducedMotion, wait } from './parts';
import { matchTab, type Match } from './search';
import { StripView } from './strip';
import type { Thumbs } from './thumbs';
import type { Model, Style, View, ViewHandlers } from './types';
import type { Wallpaper } from './wallpaper';

const QUICK_TAP = 150;
/** How long a latched opening waits for a fresh picture of the current page. */
const FRESH_THUMB = 150;
const ESC_PRIORITY = 40;

type Phase = 'idle' | 'pending' | 'open' | 'closing';
export type OpenMode = 'cycle' | 'latched' | 'search';

/** What the last opening measured (tests: tests/switcher). Times are performance.now(). */
export interface Timing {
  /** The action ran (the Ctrl+Tab keydown). */
  begin: number;
  /** The switcher's DOM went in. */
  show: number;
  /** The first animation frame after that. */
  frame: number;
  /** The first MozAfterPaint after that: the switcher is on screen. */
  paint: number;
  style: Style | '';
  tabs: number;
  latched: boolean;
}

export class Switcher {
  private phase: Phase = 'idle';
  /** While pending: open latched when the wait ends (search, Sticky Keys) rather than on a timer. */
  private pendingLatched = false;
  private pendingTimer: number | null = null;
  private model: Model | null = null;
  private view: View | null = null;
  private root: HTMLElement | null = null;
  private finishClosing: (() => void) | null = null;
  private matches = new Map<number, Match | null>();
  /** Tabs whose page is being asked whether it would prompt before closing (closeCard). */
  private asking = new Set<number>();
  /**
   * This Ctrl+Tab gesture began in element full screen: it steps with the core's MRU cycle until Ctrl
   * is released (the first switch leaves full screen; a switcher opening mid-gesture would start
   * again from the tab the core just showed).
   */
  private coreCycle = false;
  /** The glass theme hold while the deck or grid covers the page (b.holdTheme). */
  private releaseTheme: (() => void) | null = null;
  private readonly layer: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly fieldRow: HTMLElement;
  /** Holds the search field, invisible, before the switcher shows (see grabKeys). */
  private readonly holder = el('sw-holder');
  private readonly handlers: ViewHandlers = {
    select: (id) => this.select(id),
    open: (id) => void this.close(id),
    close: (id) => this.closeCard(id),
    cancel: () => this.cancel(),
    newTab: () => {
      void this.close(null, false);
      this.b.newTab();
    },
  };
  timing: Timing = { begin: 0, show: 0, frame: 0, paint: 0, style: '', tabs: 0, latched: false };

  constructor(private b: Browser, private thumbs: Thumbs, private wallpaper: Wallpaper) {
    this.layer = b.layer('switcher', 40);
    this.input = this.makeInput();
    this.count = el('sw-count', 'span');
    this.count.setAttribute('role', 'status');
    this.fieldRow = el('sw-fieldrow');
    const ico = el('ico', 'span');
    ico.setAttribute('aria-hidden', 'true');
    ico.append(svg(icons.search));
    this.fieldRow.append(ico, this.input, this.count);

    b.registerAction('nextTabMru', () => this.step(1));
    b.registerAction('prevTabMru', () => this.step(-1));
    b.registerAction('switcherSearch', () => this.search());
    b.on('ctrl-up', (reason) => {
      // A gesture the core stepped (element full screen) ends with Ctrl; the core commits it itself.
      if (this.coreCycle) {
        this.coreCycle = false;
        return;
      }
      if (reason === 'blur') this.lostFocus();
      else this.ctrlUp();
    });
    b.on('tab-closed', (t) => this.tabGone(t.id));
    b.on('tab-updated', (t) => {
      if (this.phase === 'open') this.view?.refresh(t.id);
    });
    b.addEscLayer(ESC_PRIORITY, () => this.escape());
    b.addCloseLayer(ESC_PRIORITY, () => this.closeKey());
    b.keys?.addHook((binding, e) => this.onKey(binding, e));
    thumbs.onChange((id) => {
      if (this.phase === 'open') this.view?.refresh(id);
    });
    // Minimized: cancel back to the tab you started on (the window's deactivation is 'ctrl-up' 'blur').
    const hidden = (): void => {
      if (document.hidden) this.lostFocus();
    };
    document.addEventListener('visibilitychange', hidden);
    const resized = (): void => {
      if (this.phase === 'open') this.view?.layout();
    };
    window.addEventListener('resize', resized);
    const focused = (e: Event): void => this.keepFocus(e.target);
    document.addEventListener('focus', focused, true);
    b.onDestroy(() => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('resize', resized);
      document.removeEventListener('focus', focused, true);
      this.reset();
    });
    fx.guardTabSwitchFocus(() => this.phase === 'pending' || this.phase === 'open');
  }

  // ---- service ----

  isOpen(): boolean {
    return this.phase === 'pending' || this.phase === 'open';
  }

  /**
   * 'cycle': as Ctrl+Tab (held while Ctrl is down, else latched); 'latched': open latched on the
   * previous tab; 'search': as Ctrl+Shift+A.
   */
  open(mode: OpenMode = 'latched'): void {
    if (mode === 'search') this.search();
    else if (mode === 'cycle') this.step(1);
    else if (this.phase === 'idle' || this.phase === 'closing') {
      if (this.phase === 'closing') this.finishClosing?.();
      this.begin(1, true);
    } else if (this.phase === 'open') this.latch();
  }

  /** Service close(): cancel as Esc does, whatever the mode (held or latched). */
  dismiss(): void {
    if (this.isOpen()) this.cancel();
  }

  /** For tests and diagnostics: the session as it is now. */
  state(): { phase: Phase; latched: boolean; style: Style; list: number[]; sel: number; selected: number | undefined; startId: number; query: string } | { phase: Phase } {
    const m = this.model;
    if (!m) return { phase: this.phase };
    return { phase: this.phase, latched: m.latched, style: this.style(), list: [...m.list], sel: m.sel, selected: this.selectedId(), startId: m.startId, query: m.query };
  }

  // ---- entry points ----

  private step(dir: 1 | -1): void {
    if (this.b.isPopup) return;
    // Deer's layer is not drawn in element full screen: switch tabs as the core does, for the whole
    // gesture (the first step leaves full screen; the next Tab must not open the switcher there).
    if (this.coreCycle || fx.inDOMFullscreen()) {
      this.coreCycle = this.ctrlDown();
      this.b.builtin(dir === 1 ? 'nextTabMru' : 'prevTabMru');
      return;
    }
    if (this.phase === 'closing') this.finishClosing?.();
    if (this.phase === 'idle') this.begin(dir, false);
    else this.move(dir);
  }

  private search(): void {
    if (this.b.isPopup || fx.inDOMFullscreen()) return;
    if (this.phase === 'closing') this.finishClosing?.();
    if (this.phase === 'idle') {
      if (!this.b.tabs.length) return;
      this.model = this.newModel();
      this.model.sel = Math.max(0, this.model.list.indexOf(this.model.startId));
      this.prepare();
      this.openSoon();
    } else if (this.phase === 'pending') {
      if (!this.pendingLatched) this.show(true);
    } else if (this.phase === 'open') {
      this.latch();
      this.input.select();
    }
  }

  /** Ctrl+Tab from rest: the previous tab (or the one to the right, in tab-bar order) is selected. */
  private begin(dir: 1 | -1, latched: boolean): void {
    if (this.b.tabs.length < 2) return;
    const m = this.newModel();
    this.model = m;
    const start = m.list.indexOf(m.startId);
    m.sel = (start + dir + m.list.length) % m.list.length;
    this.prepare();
    // No release will come (Sticky Keys lets go of Ctrl right after Tab; a call without Ctrl down):
    // there is no quick tap, it opens latched.
    if (latched || !this.ctrlDown() || this.stickyKeys()) {
      this.openSoon();
      return;
    }
    this.phase = 'pending';
    this.pendingLatched = false;
    this.grabKeys();
    this.pendingTimer = window.setTimeout(() => this.show(false), QUICK_TAP);
  }

  /** A fresh picture of the page you are on (its card is where the deck starts) and the neighbours' JPEGs. */
  private prepare(): void {
    const m = this.model;
    if (!m) return;
    this.timing = { begin: performance.now(), show: 0, frame: 0, paint: 0, style: this.style(), tabs: m.all.length, latched: false };
    const active = this.b.active();
    if (active) void this.thumbs.capture(active, 'open');
    if (this.style() === 'deck') this.wallpaper.warm();
    this.thumbs.loadRestored();
    const near = [m.list[m.sel], m.list[m.sel + 1], m.list[m.sel - 1], m.list[m.sel + 2]].filter((x): x is number => x !== undefined);
    this.thumbs.prepare(this.style() === 'deck' ? near : m.list.slice(0, 18));
  }

  /** Opens latched once the current page has a fresh picture (or after 150 ms). */
  private openSoon(): void {
    this.phase = 'pending';
    this.pendingLatched = true;
    this.grabKeys();
    const active = this.b.active();
    const fresh = active ? this.thumbs.capture(active, 'open') : Promise.resolve(false);
    void Promise.race([fresh, wait(FRESH_THUMB)]).then(() => {
      if (this.phase === 'pending' && this.pendingLatched) this.show(true);
    });
  }

  /**
   * Keyboard focus moves into the (still invisible) search field at once, so the keys typed during
   * the quick-tap window land in it and never in the page.
   */
  private grabKeys(): void {
    if (!this.fieldRow.isConnected) {
      this.holder.append(this.fieldRow);
      this.layer.append(this.holder);
    }
    this.focusInput();
  }

  private focusInput(): void {
    if (document.activeElement !== this.input) this.input.focus({ preventScroll: true });
  }

  /**
   * While the switcher is up the search field keeps keyboard focus: a page that gets focus (the tab
   * that comes to the front when the current one is closed) would take the keys otherwise.
   */
  private keepFocus(target: EventTarget | null): void {
    if (!this.isOpen() || target === this.input) return;
    window.setTimeout(() => {
      if (this.isOpen() && document.activeElement !== this.input) this.focusInput();
    }, 0);
  }

  private ctrlUp(): void {
    if (this.phase === 'pending' && !this.pendingLatched) {
      // Quick tap: straight to the selected tab, nothing shown.
      const id = this.selectedId();
      this.reset();
      if (id !== undefined && id !== this.b.activeId) this.b.activate(id);
      else this.b.focusPage();
      return;
    }
    const m = this.model;
    if (this.phase !== 'open' || !m || m.latched) return;
    const id = this.selectedId();
    if (id === undefined || id === m.startId) this.cancel();
    else void this.close(id);
  }

  // ---- open and close ----

  private show(latched: boolean): void {
    this.clearPending();
    const m = this.model;
    if (!m) return;
    this.phase = 'open';
    m.latched = latched || m.latched;
    if (this.b.omni.open) this.b.omni.close();
    this.b.closePanels();
    const style = this.style();
    const view = this.makeView(style, m);
    const root = el('sw');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Switch tabs');
    root.append(view.root);
    // Keep keyboard focus in the search field whatever is clicked (the grid's scrollbar still drags).
    root.addEventListener('mousedown', (e) => {
      const target = e.target as Element | null;
      if (target !== this.input && !target?.classList?.contains('sw-gscroll')) e.preventDefault();
    });
    // A held switcher whose Ctrl release went missing (the router saw Ctrl go up) ends on the next
    // pointer move.
    root.addEventListener('mousemove', (e) => {
      if (this.phase === 'open' && this.model && !this.model.latched && !e.ctrlKey && this.b.keys && !this.b.keys.ctrlHeld) this.ctrlUp();
    });
    this.view = view;
    this.root = root;
    this.layer.append(root);
    view.mount(this.fieldRow);
    this.holder.remove();
    this.b.root.classList.toggle('vitre-switcher-grid', style === 'grid');
    // The deck and grid cover the page: the window controls are lifted onto the switcher's surface
    // (styles.ts, vitre-switcher-cover) and read as clear glass there, as on the TabOverview board,
    // whatever the page underneath is. The strip leaves the dimmed page and its bar as they are.
    this.b.root.classList.toggle('vitre-switcher-cover', style !== 'strip');
    if (style !== 'strip' && !this.releaseTheme) this.releaseTheme = this.b.holdTheme('clear');
    root.classList.toggle('latched', m.latched);
    this.thumbs.quiet = true;
    view.enter();
    this.syncAria();
    this.focusInput();
    // Typed while the switcher was about to open.
    if (this.input.value) this.onInput();
    this.measure(style, m);
    this.freshen();
  }

  /** When the switcher reaches the screen: the first frame and the first paint after show. */
  private measure(style: Style, m: Model): void {
    const t = this.timing;
    t.show = performance.now();
    t.style = style;
    t.tabs = m.all.length;
    t.latched = m.latched;
    // The refresh tick whose callbacks run first paints the new DOM; the MozAfterPaint that follows
    // it (listened for from inside the tick, so an earlier paint cannot answer) is that paint.
    window.requestAnimationFrame(() => {
      t.frame = performance.now();
      window.addEventListener(
        'MozAfterPaint',
        () => {
          t.paint = performance.now();
        },
        { once: true }
      );
    });
  }

  /** Fresh pictures for the cards on screen whose picture is old (the start tab's is on its way). */
  private freshen(): void {
    const view = this.view;
    const m = this.model;
    if (!view || !m) return;
    for (const id of view.visible()) {
      if (id === m.startId || this.thumbs.fresh(id)) continue;
      const t = this.b.tab(id);
      if (t) void this.thumbs.capture(t, 'visible');
    }
  }

  /**
   * Opens a card (or, with null, just leaves): the tab switches underneath while the card grows to
   * fill the window, then the switcher fades away. Another Ctrl+Tab cuts the motion short.
   * `focusPage` false leaves focus to whatever opens next (the New tab card's address field).
   */
  private async close(id: number | null, focusPage = true): Promise<void> {
    const m = this.model;
    const view = this.view;
    const root = this.root;
    if (this.phase !== 'open' || !m || !view || !root) return;
    this.phase = 'closing';
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      this.finishClosing = null;
      if (this.root === root) this.reset();
      else root.remove();
    };
    this.finishClosing = finish;
    if (id !== null) {
      m.sel = m.list.indexOf(id);
      view.update();
    }
    if (id !== null && id !== this.b.activeId) this.b.activate(id);
    else if (focusPage) this.b.focusPage();
    else this.input.blur();
    if (id !== null) await view.expand(id);
    if (finished) return;
    root.classList.add('sw-out');
    await wait(reducedMotion() ? 150 : 120);
    finish();
  }

  /** Back to the tab you started on: its card grows back into the window. */
  private cancel(): void {
    if (this.phase === 'pending') {
      this.reset();
      this.b.focusPage();
      return;
    }
    const m = this.model;
    if (this.phase !== 'open' || !m) return;
    void this.close(m.list.includes(m.startId) || m.all.includes(m.startId) ? m.startId : null);
  }

  private lostFocus(): void {
    if (this.phase === 'pending') this.reset();
    else if (this.phase === 'open') this.cancel();
  }

  private reset(): void {
    this.clearPending();
    const hadFocus = document.activeElement === this.input;
    this.root?.remove();
    this.root = null;
    this.view = null;
    this.model = null;
    this.phase = 'idle';
    this.finishClosing = null;
    this.matches.clear();
    this.input.value = '';
    this.input.removeAttribute('aria-activedescendant');
    this.fieldRow.remove();
    this.holder.remove();
    if (hadFocus) this.input.blur();
    this.b.root.classList.remove('vitre-switcher-grid', 'vitre-switcher-cover');
    this.releaseTheme?.();
    this.releaseTheme = null;
    this.thumbs.quiet = false;
  }

  private clearPending(): void {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  // ---- selection, search, closing cards ----

  private move(dir: 1 | -1): void {
    const m = this.model;
    if (!m || !m.list.length) return;
    m.sel = m.sel < 0 ? 0 : (m.sel + dir + m.list.length) % m.list.length;
    if (this.phase === 'open') this.render();
  }

  /** Up and Down in the grid: a row at a time, stopping at the edges. */
  private moveRow(dir: 1 | -1): void {
    const m = this.model;
    if (!m || !m.list.length || !this.view) return;
    const cols = this.view.columns();
    const last = m.list.length - 1;
    let next = m.sel + dir * cols;
    if (next > last) next = Math.floor(m.sel / cols) < Math.floor(last / cols) ? last : m.sel;
    if (next < 0) next = m.sel;
    if (next === m.sel) return;
    m.sel = next;
    this.render();
  }

  private select(id: number): void {
    const m = this.model;
    const i = m ? m.list.indexOf(id) : -1;
    if (!m || i < 0 || this.phase !== 'open') return;
    m.sel = i;
    this.render();
  }

  private latch(): void {
    const m = this.model;
    if (!m || m.latched) return;
    m.latched = true;
    this.render();
  }

  private onInput(): void {
    const m = this.model;
    if (this.phase !== 'open' || !m) return;
    if (this.input.value) m.latched = true;
    const before = this.selectedId();
    const q = this.input.value;
    m.query = q;
    this.matches.clear();
    if (q.trim()) {
      m.list = m.all.filter((id) => {
        const t = m.tab(id);
        const hit = t ? matchTab(t, q) : null;
        this.matches.set(id, hit);
        return !!hit;
      });
      m.sel = m.list.length ? 0 : -1;
    } else {
      m.list = [...m.all];
      const keep = before === undefined ? -1 : m.list.indexOf(before);
      m.sel = keep >= 0 ? keep : Math.min(1, m.list.length - 1);
    }
    this.render();
  }

  private typeText(text: string): void {
    const i = this.input;
    this.focusInput();
    const start = i.selectionStart ?? i.value.length;
    const end = i.selectionEnd ?? start;
    i.setRangeText(text, start, end, 'end');
    this.onInput();
  }

  /**
   * Ctrl+W, Ctrl+F4, Delete or a middle click: the card lifts away and the tab closes.
   * A page that may ask "Leave page?" first is asked quietly (gecko.ts asksBeforeClosing): Firefox
   * would otherwise switch to that tab under the switcher, show its prompt there, hidden by the
   * switcher, and hold this key in a nested event loop until it is answered. A page that would ask
   * gets its tab opened (the switcher closes onto it) and is closed there, where its prompt shows.
   */
  private closeCard(id = this.selectedId()): void {
    const m = this.model;
    if (this.phase !== 'open' || !m || !this.view || id === undefined || !m.all.includes(id)) return;
    const t = this.b.tab(id);
    if (t && mayAskBeforeClosing(t.browser)) {
      if (this.asking.has(id)) return;
      this.asking.add(id);
      void asksBeforeClosing(t.browser).then((asks) => {
        this.asking.delete(id);
        if (!this.b.tabs.includes(t)) return;
        if (asks) this.closeThere(t);
        else this.dropCard(id);
      });
      return;
    }
    this.dropCard(id);
  }

  /** The card lifts away (when it is still shown) and its tab closes. */
  private dropCard(id: number): void {
    const m = this.model;
    if (this.phase === 'open' && m && this.view && m.all.includes(id)) {
      this.view.closing(id);
      this.forget(id);
    }
    this.b.closeTab(id);
    // Closing the current tab brings another one to the front.
    if (m && this.model === m && m.startId === id) m.startId = this.b.activeId;
    if (this.phase === 'open') this.focusInput();
  }

  /** A tab whose page asks before it closes: shown first (the switcher opens it), then closed there. */
  private closeThere(t: Tab): void {
    const go = (): void => {
      if (this.b.tabs.includes(t)) this.b.closeTab(t.id);
    };
    if (this.phase === 'open') {
      // Its card may have been filtered away by a search meanwhile: then leave, and show it after.
      const shown = !!this.model?.list.includes(t.id);
      void this.close(shown ? t.id : null).then(() => {
        if (!shown && this.b.tabs.includes(t) && this.b.activeId !== t.id) this.b.activate(t.id);
        window.setTimeout(go, 0);
      });
      return;
    }
    if (this.b.activeId !== t.id) this.b.activate(t.id);
    window.setTimeout(go, 0);
  }

  /** A tab closed some other way (the page closed itself, another window...). */
  private tabGone(id: number): void {
    const m = this.model;
    if (!m || !m.all.includes(id)) return;
    if (this.phase === 'open') this.view?.closing(id);
    this.forget(id);
    // The core picks the next tab after this event.
    queueMicrotask(() => {
      if (this.model === m && m.startId === id) m.startId = this.b.activeId;
    });
    if (this.phase === 'pending' && m.all.length < 2) this.reset();
  }

  /** Drops a tab from the session; the selection stays in place, or steps back at the end. */
  private forget(id: number): void {
    const m = this.model;
    if (!m) return;
    const i = m.list.indexOf(id);
    m.all = m.all.filter((x) => x !== id);
    m.list = m.list.filter((x) => x !== id);
    this.matches.delete(id);
    if (i >= 0 && i < m.sel) m.sel--;
    if (m.sel >= m.list.length) m.sel = m.list.length - 1;
    if (this.phase === 'open') this.render();
  }

  // ---- keys ----

  /**
   * Runs on every keydown before the router acts (keys.ts hook). While the switcher is up it takes
   * the keyboard: steps and Ctrl+W still go through the router (their actions and the close layer
   * act on the switcher), its own keys are handled here, typing goes to the field, everything else
   * does nothing.
   */
  private onKey(binding: Binding | null, e: KeyboardEvent): KeyVerdict {
    if (this.phase !== 'pending' && this.phase !== 'open') return undefined;
    const m = this.model;
    if (!m) return undefined;
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'AltGraph' || e.key === 'Meta' || e.key === 'OS') return 'pass';
    const action = binding?.action;
    if (action === 'nextTabMru' || action === 'prevTabMru' || action === 'closeTab') return undefined;
    if (action === 'switcherSearch') {
      if (!e.repeat) this.search();
      return 'swallow';
    }
    // IME composition: the field's.
    if (e.isComposing || e.keyCode === 229 || e.key === 'Process') return 'pass';
    const ctrlLetter = e.ctrlKey && !e.altKey && !e.metaKey && /^(Key[A-Z]|Digit\d)$/.test(e.code);

    if (this.phase === 'pending') {
      if (e.key === 'Escape') {
        if (!e.repeat) this.cancel();
        return 'swallow';
      }
      if (ctrlLetter) {
        this.show(this.pendingLatched);
        if (this.typing()) this.typeText(e.key.length === 1 ? e.key : '');
        return 'swallow';
      }
      if (!e.ctrlKey && !e.altKey && e.key.length === 1) {
        this.focusInput();
        return 'pass';
      }
      return 'swallow';
    }

    // Held, yet Ctrl is up: its release went missing. Treat the key as the release, except that Esc
    // (now safe, with Ctrl up) still means cancel. The router's own Ctrl state decides, not the
    // event's flag: an AltGr character typed while Ctrl is held comes with AltGraph and without
    // ctrlKey (Windows), and is search text, not a release.
    if (!m.latched && !e.ctrlKey && !this.ctrlDown()) {
      if (e.key === 'Escape') {
        if (!e.repeat) this.cancel();
      } else this.ctrlUp();
      return 'swallow';
    }
    // AltGr characters (Ctrl+Alt): typed into the field, which latches.
    if (e.ctrlKey && e.altKey) {
      if (!this.typing()) return 'swallow';
      this.focusInput();
      return 'pass';
    }
    if (ctrlLetter) {
      if (this.typing() && e.key.length === 1) this.typeText(e.key);
      return 'swallow';
    }

    const empty = this.input.value === '';
    const grid = this.style() === 'grid';
    switch (e.key) {
      case 'Tab':
        this.move(e.shiftKey ? -1 : 1);
        return 'swallow';
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!empty && m.latched) return this.edit();
        this.move(e.key === 'ArrowLeft' ? -1 : 1);
        return 'swallow';
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (grid && empty) this.moveRow(dir);
        else this.move(dir);
        return 'swallow';
      }
      case 'Home':
      case 'End':
        if (!empty) return this.edit();
        if (m.list.length) {
          m.sel = e.key === 'Home' ? 0 : m.list.length - 1;
          this.render();
        }
        return 'swallow';
      case 'Enter': {
        const id = this.selectedId();
        if (id !== undefined && !e.repeat) void this.close(id);
        return 'swallow';
      }
      case 'Escape':
        if (!e.repeat) this.cancel();
        return 'swallow';
      case 'Delete':
        if (!empty) return this.edit();
        if (!e.repeat) this.closeCard();
        return 'swallow';
    }
    // Any other Deer shortcut does nothing while the switcher is up.
    if (binding) return 'swallow';
    if (e.ctrlKey) return m.latched ? this.edit() : 'swallow';
    if (e.key.length === 1 && !m.latched && !this.typing()) return 'swallow';
    return this.edit();
  }

  /** The key edits the search text: it goes to the field. */
  private edit(): KeyVerdict {
    this.focusInput();
    return 'pass';
  }

  /** Typing searches: always when latched, while held only with Settings > Tabs > Type to search. */
  private typing(): boolean {
    return !!this.model?.latched || this.b.settings.typeToSearch;
  }

  /** Esc ladder, layer 40: the latched switcher cancels (Esc that arrives another way, e.g. the Stop key). */
  private escape(): boolean {
    if (this.phase !== 'open' && this.phase !== 'pending') return false;
    this.cancel();
    return true;
  }

  /** Ctrl+W while the switcher is up closes the selected card, not the tab underneath. */
  private closeKey(): boolean {
    if (this.phase === 'pending') this.show(this.pendingLatched);
    if (this.phase !== 'open') return false;
    this.closeCard();
    return true;
  }

  // ---- helpers ----

  private ctrlDown(): boolean {
    return this.b.keys ? this.b.keys.ctrlHeld : true;
  }

  private stickyKeys(): boolean {
    try {
      return this.b.sys('VitreSwitcher').stickyKeys();
    } catch {
      return false;
    }
  }

  private style(): Style {
    const s = this.b.settings.switcherStyle;
    return s === 'grid' || s === 'strip' ? s : 'deck';
  }

  private newModel(): Model {
    const all = this.order();
    const b = this.b;
    return {
      all,
      list: [...all],
      sel: 0,
      startId: b.activeId,
      query: '',
      latched: false,
      tab: (id) => b.tab(id),
      match: (id) => this.matches.get(id) ?? null,
      paint: (id, media) => {
        const t = b.tab(id);
        if (t) this.thumbs.paint(t, media);
      },
    };
  }

  /** Most recently used first (the current tab, then the one before it), or tab-bar order. */
  private order(): number[] {
    const ids = this.b.tabs.map((t) => t.id);
    // Tab bar order: the cards stand as the bar does; Ctrl+Tab starts at the tab on the right.
    if (this.b.settings.tabOrder === 'bar') return ids;
    const out = [this.b.activeId];
    for (const id of [...this.b.mru, ...ids]) if (!out.includes(id) && ids.includes(id)) out.push(id);
    return out.filter((id) => ids.includes(id));
  }

  private makeView(style: Style, m: Model): View {
    if (style === 'grid') return new GridView(m, this.handlers);
    if (style === 'strip') return new StripView(m, this.handlers);
    return new DeckView(m, this.handlers, this.wallpaper.element());
  }

  private selectedId(): number | undefined {
    const m = this.model;
    return m && m.sel >= 0 ? m.list[m.sel] : undefined;
  }

  private render(): void {
    this.view?.update();
    // Held, the field takes no typing of its own (the first character latches): no caret until then.
    if (this.model) this.root?.classList.toggle('latched', this.model.latched);
    this.syncAria();
    this.freshen();
  }

  private syncAria(): void {
    const m = this.model;
    if (!m) return;
    const id = this.selectedId();
    if (id === undefined) this.input.removeAttribute('aria-activedescendant');
    else this.input.setAttribute('aria-activedescendant', optionId(id));
    const n = m.all.length;
    this.input.placeholder = `Search ${n} ${n === 1 ? 'tab' : 'tabs'}`;
    this.count.textContent = m.query.trim() ? (m.list.length ? `${m.list.length} of ${n}` : 'No matches') : '';
  }

  private makeInput(): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'text';
    i.className = 'sw-input';
    i.spellcheck = false;
    i.autocomplete = 'off';
    i.setAttribute('role', 'combobox');
    i.setAttribute('aria-label', 'Search tabs');
    i.setAttribute('aria-expanded', 'true');
    i.setAttribute('aria-controls', 'sw-list');
    i.setAttribute('aria-autocomplete', 'list');
    i.addEventListener('input', () => this.onInput());
    return i;
  }
}
