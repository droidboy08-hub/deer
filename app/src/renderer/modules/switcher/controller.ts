// The switcher's behaviour (keymap.json "Tab switcher", SwitcherKeys board):
// - Ctrl+Tab / Ctrl+Shift+Tab step. A quick tap (Ctrl up within 150 ms) switches straight to the
//   previous tab with nothing shown; holding Ctrl shows the switcher, and letting go opens the
//   selected card. Letting go on the starting card, clicking the background or losing window
//   focus cancels.
// - Latched (Ctrl+Shift+A, the first typed character, or Sticky Keys): Ctrl up does nothing;
//   Enter opens, Esc cancels, Up/Down/Tab move, Left/Right edit a query.
// - Ctrl+W or Delete (empty query) closes the selected card; Ctrl+letter types into the search.
import type { Browser } from '../../app';
import { icons } from '../../icons';
import type { Tab } from '../../model';
import { DeckView } from './deck';
import { GridView } from './grid';
import { el, optionId, reducedMotion, wait } from './parts';
import { matchTab, type Match } from './search';
import { StripView } from './strip';
import type { Thumbs } from './thumbs';
import type { Model, Style, View, ViewHandlers } from './types';

const QUICK_TAP = 150;
/** How long opening waits for a fresh picture of the current page. */
const FRESH_THUMB = 150;
const ESC_PRIORITY = 40;

type Phase = 'idle' | 'pending' | 'open' | 'closing';

/** A Ctrl+letter the main process routes here while the switcher is open (src/main/modules/switcher.ts). */
type MainKey = { kind: 'type'; text: string };

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
  private sticky = false;
  private readonly layer: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly fieldRow: HTMLElement;
  /** Holds the search field, invisible, before the switcher shows (see grabKeys). */
  private readonly holder = el('div', 'sw-holder');
  private readonly handlers: ViewHandlers = {
    select: (id) => this.select(id),
    open: (id) => void this.close(id),
    close: (id) => this.closeCard(id),
    cancel: () => this.cancel(),
    newTab: () => {
      // Not via the page: its focus lands late and would take the new tab's address field away.
      void this.close(null, false);
      this.b.newTab();
    },
  };

  constructor(private b: Browser, private thumbs: Thumbs) {
    this.layer = b.layer('switcher', 40);
    this.input = this.makeInput();
    this.count = el('span', 'sw-count');
    this.count.setAttribute('role', 'status');
    this.fieldRow = el('div', 'sw-fieldrow', `<span class="ico" aria-hidden="true">${icons.search}</span>`);
    this.fieldRow.append(this.input, this.count);

    b.registerAction('nextTabMru', () => this.step(1));
    b.registerAction('prevTabMru', () => this.step(-1));
    b.registerAction('switcherSearch', () => this.search());
    b.on('ctrl-up', () => this.ctrlUp());
    b.on('tab-closed', (t: Tab) => this.tabGone(t.id));
    b.on('tab-updated', (t: Tab) => {
      if (this.phase === 'open') this.view?.refresh(t.id);
    });
    b.addEscLayer(ESC_PRIORITY, () => this.escape());
    b.addCloseLayer(ESC_PRIORITY, () => this.closeKey());
    thumbs.onChange((id) => {
      if (this.phase === 'open') this.view?.refresh(id);
    });
    window.vitre.ipc.on('switcher:key', (k) => this.mainKey(k as MainKey));
    // Start, Alt+Tab or the Win key: cancel back to the tab you started on.
    window.vitre.win.onState((s) => {
      if (!s.focused) this.lostFocus();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.lostFocus();
    });
    window.addEventListener('resize', () => {
      if (this.phase === 'open') this.view?.layout();
    });
    // 'focus' rather than 'focusin': a <webview> that takes focus fires only 'focus'.
    document.addEventListener('focus', (e) => this.keepFocus(e.target), true);
    this.refreshSticky();
  }

  // ---- entry points ----

  private step(dir: 1 | -1): void {
    if (this.phase === 'closing') this.finishClosing?.();
    if (this.phase === 'idle') this.begin(dir);
    else this.move(dir);
  }

  private search(): void {
    if (this.phase === 'closing') this.finishClosing?.();
    if (this.phase === 'idle') {
      this.model = this.newModel();
      this.model.sel = Math.max(0, this.model.list.indexOf(this.model.startId));
      this.openSoon();
    } else if (this.phase === 'pending') {
      if (!this.pendingLatched) this.show(true);
    } else if (this.phase === 'open') {
      this.latch();
      this.input.select();
    }
  }

  /** Ctrl+Tab from rest: the previous tab (or the one to the right, in tab-bar order) is selected. */
  private begin(dir: 1 | -1): void {
    if (this.b.tabs.length < 2) return;
    const m = this.newModel();
    this.model = m;
    const start = m.list.indexOf(m.startId);
    m.sel = (start + dir + m.list.length) % m.list.length;
    if (this.sticky) {
      // Sticky Keys lets go of Ctrl right after Tab, so there is no quick tap: open latched.
      this.openSoon();
      return;
    }
    void this.thumbs.captureActive();
    this.phase = 'pending';
    this.pendingLatched = false;
    this.grabKeys();
    this.pendingTimer = window.setTimeout(() => this.show(false), QUICK_TAP);
  }

  /** Opens latched once the current page has a fresh picture (or after 150 ms). */
  private openSoon(): void {
    this.phase = 'pending';
    this.pendingLatched = true;
    this.grabKeys();
    void Promise.race([this.thumbs.captureActive(), wait(FRESH_THUMB)]).then(() => {
      if (this.phase === 'pending' && this.pendingLatched) this.show(true);
    });
  }

  /**
   * Keyboard focus moves into the (still invisible) search field at once. A page that had a
   * Ctrl+Tab taken from it never reports the Ctrl release (Chromium drops a widget's key-ups
   * after a key-down the browser consumed), so the release must arrive here instead. From now
   * on the main process also routes Ctrl+letter here instead of running its command.
   */
  private grabKeys(): void {
    if (!this.fieldRow.isConnected) {
      this.holder.append(this.fieldRow);
      this.layer.append(this.holder);
    }
    window.vitre.ipc.send('switcher:state', true);
    this.input.focus({ preventScroll: true });
  }

  /**
   * While the switcher is up the search field keeps keyboard focus. Closing the current tab
   * brings another page to the front, and the page's focus lands a moment later; if it stayed
   * there, the page would take the keys and the Ctrl release.
   */
  private keepFocus(target: EventTarget | null): void {
    const up = () => this.phase === 'pending' || this.phase === 'open';
    if (!up() || target === this.input) return;
    window.setTimeout(() => {
      if (up() && document.activeElement !== this.input) this.input.focus({ preventScroll: true });
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
    m.latched = latched;
    if (this.b.omni.open) this.b.omni.close();
    const view = this.makeView(this.b.settings.switcherStyle, m);
    const root = el('div', 'sw');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Switch tabs');
    root.append(view.root);
    // Keep keyboard focus in the search field whatever is clicked.
    root.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) e.preventDefault();
    });
    // A missed Ctrl release still ends a held switcher: the next real pointer move tells
    // (Blink's synthetic moves after layout carry no movement and may carry stale modifiers).
    root.addEventListener('mousemove', (e) => {
      if (!e.ctrlKey && (e.movementX !== 0 || e.movementY !== 0)) this.ctrlUp();
    });
    this.view = view;
    this.root = root;
    this.layer.append(root);
    view.mount(this.fieldRow);
    this.holder.remove();
    view.enter();
    this.syncAria();
    window.vitre.ipc.send('switcher:state', true);
    this.input.focus({ preventScroll: true });
    // Typed while the switcher was about to open.
    if (this.input.value) this.onInput();
  }

  /**
   * Opens a card (or, with null, just leaves): the tab switches underneath while the card grows
   * to fill the window, then the switcher fades away. Another Ctrl+Tab cuts the motion short.
   * `focusPage` false leaves focus to whatever opens next (the New tab card's address field).
   */
  private async close(id: number | null, focusPage = true): Promise<void> {
    const m = this.model;
    const view = this.view;
    const root = this.root;
    if (this.phase !== 'open' || !m || !view || !root) return;
    this.phase = 'closing';
    window.vitre.ipc.send('switcher:state', false);
    let finished = false;
    const finish = () => {
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
    void this.close(m.list.includes(m.startId) ? m.startId : null);
  }

  private lostFocus(): void {
    if (this.phase === 'pending') this.reset();
    else if (this.phase === 'open') this.cancel();
  }

  private reset(): void {
    this.clearPending();
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
    window.vitre.ipc.send('switcher:state', false);
    this.refreshSticky();
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
    const start = i.selectionStart ?? i.value.length;
    const end = i.selectionEnd ?? start;
    i.setRangeText(text, start, end, 'end');
    this.onInput();
  }

  /** Ctrl+W, Ctrl+F4, Delete or a middle click: the card lifts away and the tab closes. */
  private closeCard(id = this.selectedId()): void {
    const m = this.model;
    if (this.phase !== 'open' || !m || !this.view || id === undefined || !m.all.includes(id)) return;
    this.view.closing(id);
    this.forget(id);
    this.b.closeTab(id);
    // Closing the current tab brings another one to the front, which takes focus.
    if (m.startId === id) m.startId = this.b.activeId;
    if (this.phase === 'open') this.input.focus({ preventScroll: true });
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

  private onKey(e: KeyboardEvent): void {
    const m = this.model;
    // Ctrl+Tab and other Vitre keys were handled (and prevented) before reaching the field.
    if (e.defaultPrevented || !m || e.isComposing || e.keyCode === 229) return;
    if (this.phase === 'pending') {
      // Esc before the switcher shows (Ctrl+Shift+A, then Esc at once) still cancels.
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
      return;
    }
    if (this.phase !== 'open') return;
    if (!m.latched && !e.ctrlKey && e.key !== 'Control') {
      // Held, yet Ctrl is up: its release went missing. Treat it as the release, except that
      // Esc (now safe, with Ctrl up) still means cancel.
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!e.repeat) this.cancel();
      } else {
        this.ctrlUp();
      }
      return;
    }
    if (!m.latched && !this.b.settings.typeToSearch && e.key.length === 1) {
      // Type to search is off: an AltGr character doesn't start a search either.
      e.preventDefault();
      return;
    }
    const empty = this.input.value === '';
    const grid = this.b.settings.switcherStyle === 'grid';
    const handled = () => e.preventDefault();
    switch (e.key) {
      case 'Tab':
        handled();
        this.move(e.shiftKey ? -1 : 1);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!empty && m.latched) return; // edit the query
        handled();
        this.move(e.key === 'ArrowLeft' ? -1 : 1);
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        handled();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (grid && empty) this.moveRow(dir);
        else this.move(dir);
        break;
      }
      case 'Home':
      case 'End':
        if (!empty || !m.list.length) return;
        handled();
        m.sel = e.key === 'Home' ? 0 : m.list.length - 1;
        this.render();
        break;
      case 'Enter': {
        handled();
        const id = this.selectedId();
        if (id !== undefined && !e.repeat) void this.close(id);
        break;
      }
      case 'Escape':
        handled();
        if (!e.repeat) this.cancel();
        break;
      case 'Delete':
        if (!empty) return;
        handled();
        if (!e.repeat) this.closeCard();
        break;
    }
  }

  private mainKey(k: MainKey): void {
    if (this.phase === 'pending') this.show(this.pendingLatched);
    const m = this.model;
    if (this.phase !== 'open' || !m || k.kind !== 'type') return;
    if (m.latched || this.b.settings.typeToSearch) this.typeText(k.text);
  }

  /** Esc ladder, layer 40: the latched switcher cancels. */
  private escape(): boolean {
    if (this.phase !== 'open') return false;
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
      tab: (id) => b.tabs.find((t) => t.id === id),
      thumb: (id) => this.thumbs.get(id),
      match: (id) => this.matches.get(id) ?? null,
    };
  }

  /** Most recently used first (the current tab, then the one before it), or tab-bar order. */
  private order(): number[] {
    const ids = this.b.tabs.map((t) => t.id);
    if (this.b.settings.tabOrder === 'bar') return ids;
    const out = [this.b.activeId];
    for (const id of [...this.b.mru, ...ids]) if (!out.includes(id) && ids.includes(id)) out.push(id);
    return out;
  }

  private makeView(style: Style, m: Model): View {
    if (style === 'grid') return new GridView(m, this.handlers);
    if (style === 'strip') return new StripView(m, this.handlers);
    return new DeckView(m, this.handlers);
  }

  private selectedId(): number | undefined {
    const m = this.model;
    return m && m.sel >= 0 ? m.list[m.sel] : undefined;
  }

  private render(): void {
    this.view?.update();
    this.syncAria();
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
    i.addEventListener('keydown', (e) => this.onKey(e));
    return i;
  }

  private refreshSticky(): void {
    window.vitre.ipc
      .invoke('switcher:sticky')
      .then((on) => {
        this.sticky = on === true;
      })
      .catch(() => undefined);
  }
}
