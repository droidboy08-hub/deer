// The Settings panel: a 960×688 frosted sheet centred over the dimmed window (scaled down to fit
// small windows), a 48 px title bar, a 216 px sidebar with "Find a setting", and the pages.
// Esc and Ctrl+W close it (panel layer 60); focus stays inside while it is open.
import type { Browser } from '../../app';
import type { Settings } from '../../../shared/settings';
import { lens } from '../../glass';
import type { HomeBackground } from './background';
import { card, h, heading, uid, type Ctx, type Option, type RowDef, type SectionDef, type SectionId } from './controls';
import { ico } from './icons';
import { SECTIONS } from './pages';
import { CAPTURE_ESC_PRIORITY, capture, matchesKeys } from './shortcuts-page';

const W = 960;
const H = 688;
/** Space kept around the sheet when the window is too small for it. */
const MARGIN = 16;
const PANEL_LAYER = 60;
const LISTBOX_LAYER = 20;
const CLOSE_MS = 160;
/** The overlay layer's z (panels 30); surfaces above it, like the switcher or menus, may take focus. */
const PANEL_Z = 30;

const FOCUSABLE = 'button, input, [tabindex], a[href]';

export class SettingsPanel {
  private root!: HTMLElement;
  private sheet!: HTMLElement;
  private search!: HTMLInputElement;
  private clear!: HTMLButtonElement;
  private main!: HTMLElement;
  private content!: HTMLElement;
  private navItems = new Map<SectionId, HTMLButtonElement>();
  private built = false;
  private openNow = false;
  private section: SectionId = 'general';
  private query = '';
  private updaters = new Set<(s: Settings) => void>();
  private returnFocus: HTMLElement | null = null;
  /** Where focus goes once Downloads, which took over from Settings, closes again. */
  private handoff: HTMLElement | null = null;
  /** The last element focused inside the sheet, to go back to when something beneath takes focus. */
  private lastInside: HTMLElement | null = null;
  private fit = 1;
  private popup: { el: HTMLElement; anchor: HTMLElement; done(): void } | null = null;
  private hideTimer = 0;
  private readonly ctx: Ctx;

  constructor(private b: Browser, bg: HomeBackground) {
    this.ctx = {
      b,
      bg,
      s: () => this.b.settings,
      set: (patch) => window.vitre.settings.set(patch),
      bind: (fn) => {
        this.updaters.add(fn);
        fn(this.b.settings);
        return () => this.updaters.delete(fn);
      },
      listbox: { open: (anchor, options, selected, pick) => this.openListbox(anchor, options, selected, pick) },
      go: (section, focus) => this.show(section, focus),
    };
    b.on('settings', (s: Settings) => {
      for (const fn of this.updaters) fn(s);
    });
    b.addEscLayer(CAPTURE_ESC_PRIORITY, () => {
      if (!capture.active) return false;
      capture.active.cancel(true);
      return true;
    });
    b.addEscLayer(PANEL_LAYER, () => {
      if (!this.openNow) return false;
      this.close();
      return true;
    });
    b.addCloseLayer(PANEL_LAYER, () => {
      if (!this.openNow) return false;
      // While a key is being captured, Ctrl+W is just a key the capture refuses.
      if (!capture.active) this.close();
      return true;
    });
    window.addEventListener('resize', () => {
      if (!this.openNow) return;
      this.closeListbox(false);
      this.layout();
    });
    // One panel at a time: when Downloads opens (body.downloads-open), Settings steps aside.
    // Downloads then hands focus back to an element of this hidden sheet, which can't take it,
    // so once it closes focus goes to where it was before Settings opened.
    new MutationObserver(() => {
      const cl = document.body.classList;
      if (this.openNow && cl.contains('downloads-open')) {
        this.close('handoff');
      } else if (this.handoff && !cl.contains('panel-open')) {
        const el = this.handoff;
        this.handoff = null;
        if (!this.openNow) this.focusBack(el);
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // Switching tabs underneath (Ctrl+1, Ctrl+Tab) focuses the page; the panel keeps focus.
    b.on('tab-activated', () => {
      if (this.openNow) this.reclaimFocus();
    });
  }

  get isOpen(): boolean {
    return this.openNow;
  }

  toggle(): void {
    if (this.openNow) this.close();
    else this.show();
  }

  /** Open (or move) to a section; `anchor` names a group to scroll to and focus. */
  show(section?: SectionId, anchor?: string): void {
    this.build();
    if (section) {
      this.section = section;
      this.setQuery('');
    }
    if (!this.openNow) this.enter();
    this.paintNav();
    this.renderContent();
    this.focusInitial(anchor);
  }

  /**
   * `focus`: 'back' returns it to where it was before Settings opened; 'handoff' when Downloads
   * takes over (focus goes back once that closes too); 'stay' when the address field took it.
   */
  close(focus: 'back' | 'handoff' | 'stay' = 'back'): void {
    if (!this.openNow) return;
    capture.active?.cancel(false);
    this.closeListbox(false);
    this.openNow = false;
    document.body.classList.remove('settings-open');
    if (!document.body.classList.contains('downloads-open')) document.body.classList.remove('panel-open');
    this.root.classList.remove('open');
    this.root.classList.add('closing');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.openNow) return;
      this.root.hidden = true;
      this.root.classList.remove('closing');
      this.updaters.clear();
      this.content.replaceChildren();
    }, CLOSE_MS);
    const back = this.returnFocus;
    this.returnFocus = null;
    this.lastInside = null;
    if (focus === 'back') this.focusBack(back);
    else if (focus === 'handoff') this.handoff = back ?? this.b.active()?.webview ?? null;
  }

  // ---- building ----

  private build(): void {
    if (this.built) return;
    this.built = true;
    const layer = this.b.layer('settings', 30);

    const closeBtn = h('button', { type: 'button', class: 'vs-close', 'aria-label': 'Close settings', title: 'Close  Esc', html: ico.close });
    closeBtn.addEventListener('click', () => this.close());

    this.search = h('input', { type: 'search', placeholder: 'Find a setting', 'aria-label': 'Find a setting', spellcheck: 'false', autocomplete: 'off', 'aria-controls': 'vs-main' });
    this.clear = h('button', { type: 'button', class: 'vs-search-clear', 'aria-label': 'Clear search', title: 'Clear', tabindex: '-1', html: ico.close, hidden: true });
    this.search.addEventListener('input', () => this.onSearch());
    this.search.addEventListener('keydown', (e) => this.onSearchKey(e));
    this.clear.addEventListener('click', () => {
      this.applyQuery('');
      this.search.focus();
    });

    const nav = h('nav', { class: 'vs-nav', 'aria-label': 'Settings sections' }, h('label', { class: 'vs-search' }, h('span', { class: 'vs-search-ico', html: ico.search }), this.search, this.clear));
    for (const sec of SECTIONS) {
      const item = h('button', { type: 'button', class: 'vs-navitem', 'data-id': sec.id, tabindex: '-1' }, h('span', { class: 'vs-navico', html: sec.icon }), h('span', { text: sec.title }));
      item.addEventListener('click', () => this.go(sec.id, false));
      this.navItems.set(sec.id, item);
      nav.append(item);
    }
    nav.addEventListener('keydown', (e) => this.onNavKey(e));

    this.content = h('div', { class: 'vs-content' });
    this.main = h('main', { class: 'vs-main', id: 'vs-main', tabindex: '-1', 'aria-labelledby': 'vs-h1' }, this.content);
    this.main.addEventListener('scroll', () => this.closeListbox(false), { passive: true });

    const lensEl = h('div', { class: 'vs-lens' });
    lensEl.style.backdropFilter = lens(W, H, { radius: 22, scale: 24, blur: 22 });
    this.sheet = h(
      'section',
      { class: 'vs-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vs-title' },
      lensEl,
      h('div', { class: 'vs-tint' }),
      h('div', { class: 'vs-rim' }),
      h(
        'div',
        { class: 'vs-body' },
        h('header', { class: 'vs-titlebar' }, h('span', { class: 'vs-tico', html: ico.settings }), h('span', { class: 'vs-ttl', id: 'vs-title', text: 'Settings' }), closeBtn),
        h('div', { class: 'vs-cols' }, nav, h('div', { class: 'vs-vsep', 'aria-hidden': 'true' }), this.main),
      ),
    );
    this.sheet.addEventListener('keydown', (e) => this.onSheetKey(e));

    const scrim = h('div', { class: 'vs-scrim', 'aria-hidden': 'true' });
    scrim.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.close();
    });
    this.root = h('div', { class: 'vs-root', hidden: true }, scrim, h('div', { class: 'vs-drag', 'aria-hidden': 'true' }), this.sheet);
    layer.append(this.root);

    // Keep focus inside the sheet while it is open (surfaces stacked above it may take it).
    document.addEventListener('focusin', (e) => {
      if (!this.openNow) return;
      const t = e.target as HTMLElement;
      if (this.sheet.contains(t)) this.lastInside = t;
      // Ctrl+T, Ctrl+L or F6 opened the address field, which sits under the panel: step aside.
      else if (t.closest('#omnibox')) this.close('stay');
      else if (this.isBeneath(t)) this.reclaimFocus();
    });
    // A page taking focus fires no focusin here, only a window blur with the webview active.
    window.addEventListener('blur', () => {
      window.setTimeout(() => {
        const at = document.activeElement as HTMLElement | null;
        if (this.openNow && at?.tagName === 'WEBVIEW') this.reclaimFocus();
      }, 0);
    });
  }

  /** Is this element under the panel: the page, the tab bar, or a module layer below panels? */
  private isBeneath(el: HTMLElement): boolean {
    const layer = el.closest<HTMLElement>('.module-layer');
    return !layer || Number(layer.style.zIndex || 0) < PANEL_Z;
  }

  /** Bring focus back into the sheet. A page takes focus asynchronously, so look again shortly after. */
  private reclaimFocus(): void {
    const pull = () => {
      const at = document.activeElement as HTMLElement | null;
      if (!this.openNow || (at && (this.sheet.contains(at) || !this.isBeneath(at)))) return;
      const back = this.lastInside;
      (back && this.sheet.contains(back) && this.isTabbable(back) ? back : this.focusables()[0])?.focus();
    };
    pull();
    window.setTimeout(pull, 60);
  }

  private enter(): void {
    window.clearTimeout(this.hideTimer);
    // Downloads' action toggles its panel, so this closes it before Settings takes the window
    // (and it hands focus back to the page, which is where Settings returns it too).
    if (document.body.classList.contains('downloads-open')) this.b.run('downloads');
    // Coming back from Downloads (which took over from Settings), keep the original place to return to.
    const active = document.activeElement as HTMLElement | null;
    this.returnFocus = this.handoff ?? (active && active !== document.body && !this.b.omni.open ? active : null);
    this.handoff = null;
    if (this.b.omni.open) this.b.omni.close();
    this.openNow = true;
    document.body.classList.add('panel-open', 'settings-open');
    this.layout();
    this.root.hidden = false;
    this.root.classList.remove('closing', 'open');
    void this.root.offsetWidth; // start the transition from the closed state
    this.root.classList.add('open');
  }

  /**
   * Focus where it was before Settings opened, if that is still on screen: after a tab switch the
   * old tab's page is hidden (visibility: hidden) and must not take keys, so the current page does.
   */
  private focusBack(el: HTMLElement | null): void {
    const usable = el && el.isConnected && !this.sheet.contains(el) && el.checkVisibility({ visibilityProperty: true });
    if (usable) el.focus();
    else this.b.focusPage();
  }

  /** Centre the sheet; below 992×720 scale it down so it always fits with a margin. */
  private layout(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.fit = Math.min(1, (vw - 2 * MARGIN) / W, (vh - 2 * MARGIN) / H);
    this.sheet.style.left = `${Math.round((vw - W) / 2)}px`;
    this.sheet.style.top = `${Math.round((vh - H) / 2)}px`;
    this.sheet.style.transform = this.fit < 1 ? `scale(${this.fit.toFixed(4)})` : '';
  }

  // ---- navigation and pages ----

  private go(id: SectionId, focusNav: boolean): void {
    this.section = id;
    this.setQuery('');
    this.paintNav();
    this.renderContent();
    if (focusNav) this.navItems.get(id)?.focus();
  }

  private paintNav(): void {
    const searching = !!this.query.trim();
    for (const [id, item] of this.navItems) {
      const on = id === this.section;
      if (on && !searching) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
      item.tabIndex = on ? 0 : -1;
    }
  }

  private renderContent(): void {
    capture.active?.cancel(false);
    this.closeListbox(false);
    this.updaters.clear();
    const q = this.query.trim();
    const sec = SECTIONS.find((s) => s.id === this.section) ?? SECTIONS[0];
    this.content.replaceChildren(...(q ? this.resultsView(q) : this.sectionView(sec)));
    this.main.scrollTop = 0;
  }

  private sectionView(sec: SectionDef): Node[] {
    const out: Node[] = [sec.header ? sec.header(this.ctx) : h('h1', { class: 'vs-h1', id: 'vs-h1', text: sec.title })];
    if (sec.intro) out.push(h('p', { class: 'vs-intro', text: sec.intro }));
    for (const g of sec.groups(this.ctx)) {
      if (g.title) out.push(heading(g.title));
      const c = card(...g.rows.map((r) => r.build(this.ctx)));
      if (g.anchor) c.dataset.anchor = g.anchor;
      out.push(c);
    }
    return out;
  }

  /** "Find a setting": matching rows from every page, under their page and group names. */
  private resultsView(q: string): Node[] {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rebind = this.b.settings.rebind ?? {};
    const matches = (r: RowDef) => {
      if (r.unlisted) return false;
      const hay = `${r.title} ${r.desc ?? ''} ${r.keywords ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t)) || matchesKeys(r, q, rebind);
    };
    const out: Node[] = [h('h1', { class: 'vs-h1', id: 'vs-h1', text: 'Results' })];
    let found = 0;
    for (const sec of SECTIONS) {
      for (const g of sec.groups(this.ctx)) {
        const hits = g.rows.filter(matches);
        if (!hits.length) continue;
        found += hits.length;
        out.push(heading(g.title && g.title !== sec.title ? `${sec.title} › ${g.title}` : sec.title));
        out.push(card(...hits.map((r) => r.build(this.ctx))));
      }
    }
    if (!found) out.push(h('p', { class: 'vs-intro vs-empty', text: `No settings match “${q}”.` }));
    return out;
  }

  private setQuery(q: string): void {
    this.query = q;
    if (this.search && this.search.value !== q) this.search.value = q;
    if (this.clear) this.clear.hidden = !q;
  }

  private applyQuery(q: string): void {
    this.setQuery(q);
    this.paintNav();
    this.renderContent();
  }

  private onSearch(): void {
    this.applyQuery(this.search.value);
  }

  private onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !e.repeat) {
      // Esc in the field clears it first, then closes the panel.
      e.preventDefault();
      if (this.search.value) {
        this.applyQuery('');
      } else {
        this.close();
      }
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      // Into the results; with nothing typed, Down goes on to the sections under the field.
      const target = this.query.trim()
        ? [...this.main.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => this.isTabbable(el))
        : e.key === 'ArrowDown'
          ? this.navItems.get(this.section)
          : undefined;
      if (target) {
        e.preventDefault();
        target.focus();
      }
    }
  }

  private onNavKey(e: KeyboardEvent): void {
    const items = [...this.navItems.values()];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: items.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const next = items[(j + items.length) % items.length];
    this.go(next.dataset.id as SectionId, true);
  }

  private onSheetKey(e: KeyboardEvent): void {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      if (!e.defaultPrevented) this.trapTab(e); // a drop-down list may have used it already
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      this.findSetting();
    }
  }

  /** Ctrl+F goes to the topmost surface: here, "Find a setting". */
  findSetting(): void {
    if (!this.openNow) return;
    this.search.focus();
    this.search.select();
  }

  private focusInitial(anchor?: string): void {
    requestAnimationFrame(() => {
      if (!this.openNow) return;
      const target = anchor ? this.content.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`) : null;
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
        const first = [...target.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => this.isTabbable(el));
        (first ?? this.main).focus();
        return;
      }
      if (!this.sheet.contains(document.activeElement) || document.activeElement === this.sheet) this.navItems.get(this.section)?.focus();
    });
  }

  // ---- focus ----

  private isTabbable(el: HTMLElement): boolean {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.closest('[hidden]')) return false;
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  private focusables(): HTMLElement[] {
    return [...this.sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => this.isTabbable(el));
  }

  private trapTab(e: KeyboardEvent): void {
    const list = this.focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !this.sheet.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !this.sheet.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---- drop-down lists ----

  private openListbox(anchor: HTMLElement, options: Option[], selected: string, pick: (v: string) => void): void {
    const wasOpenHere = this.popup?.anchor === anchor;
    this.closeListbox(false);
    if (wasOpenHere || !options.length) return;

    const items = options.map((o) => h('div', { class: 'vs-opt', role: 'option', id: uid('vs-opt'), 'aria-selected': String(o.value === selected) }, h('span', { text: o.label })));
    const list = h('div', { class: 'vs-pop', role: 'listbox', tabindex: '-1', 'aria-labelledby': anchor.id }, ...items);
    let active = Math.max(0, options.findIndex((o) => o.value === selected));
    const setActive = (i: number) => {
      active = (i + items.length) % items.length;
      items.forEach((el, j) => el.classList.toggle('active', j === active));
      list.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    };
    const choose = (i: number) => {
      this.closeListbox(true);
      pick(options[i].value);
    };
    items.forEach((el, i) => {
      el.addEventListener('mousemove', () => i !== active && setActive(i));
      el.addEventListener('click', () => choose(i));
    });
    list.addEventListener('keydown', (e) => {
      const n = items.length;
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
      if (step !== undefined) {
        e.preventDefault();
        setActive(Math.max(0, Math.min(n - 1, active + step)));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : n - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(active);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.closeListbox(true);
      } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey) {
        // Type-ahead: the next choice starting with that letter.
        const k = e.key.toLowerCase();
        for (let d = 1; d <= n; d++) {
          const j = (active + d) % n;
          if (options[j].label.toLowerCase().startsWith(k)) {
            setActive(j);
            break;
          }
        }
      }
    });

    this.sheet.append(list);
    const sr = this.sheet.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const f = this.fit;
    const minW = ar.width / f;
    list.style.minWidth = `${minW}px`;
    const w = list.offsetWidth;
    const hgt = list.offsetHeight;
    const x = Math.min((ar.left - sr.left) / f, W - 8 - w);
    const below = (ar.bottom - sr.top) / f + 4;
    const above = (ar.top - sr.top) / f - 4 - hgt;
    list.style.left = `${Math.max(8, x)}px`;
    list.style.top = `${below + hgt <= H - 8 || above < 8 ? below : above}px`;
    setActive(active);

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.contains(t) && !anchor.contains(t)) this.closeListbox(false);
    };
    document.addEventListener('mousedown', onDown, true);
    const offEsc = this.b.addEscLayer(LISTBOX_LAYER, () => {
      this.closeListbox(true);
      return true;
    });
    anchor.setAttribute('aria-expanded', 'true');
    this.popup = {
      el: list,
      anchor,
      done: () => {
        offEsc();
        document.removeEventListener('mousedown', onDown, true);
      },
    };
    list.focus();
  }

  private closeListbox(focusAnchor: boolean): void {
    const p = this.popup;
    if (!p) return;
    this.popup = null;
    p.done();
    p.el.remove();
    p.anchor.setAttribute('aria-expanded', 'false');
    if (focusAnchor) p.anchor.focus();
  }
}
