// The glass tab bar. The active tab is a pill (up to 480x44) that is also the address field; the
// other tabs are 44 px favicon circles with a close badge on hover; then the + circle. The group is
// centred in the window, 12 px from the top, 8 px apart, and re-flows on the spring when tabs open,
// close or change. Ported from app/src/renderer/bar.ts; look and motion are in skin/bar.css
// (ported from app/src/renderer/styles.css).
//
// For other authors
//   b.bar.layout            { pillRect, left, right } in window coordinates. pillRect is the active
//                           pill's slot even while the bar is hidden (auto-hide, full screen).
//   b.bar.item(tabId)       the tab's element (.item.glass.tab), or undefined when it is not drawn.
//   b.bar.accessories()     the active pill's <span class="accessories" role="group"
//                           aria-label="Extensions">: pinned extension buttons go here. Every tab
//                           item has its own (empty) slot; move your node on 'render' when the
//                           active tab changes. The pill's flex row gives the address what is left.
//                           The favicon + host stay centred at the pill's middle while they fit
//                           next to what the slot holds: the bar measures the slot (a
//                           ResizeObserver: class has-acc and --vitre-acc on the item) and
//                           bar.css balances the address with an invisible spacer of that width
//                           that gives way first when the host is long (then the host ellipsizes).
//   b.bar.downloadMark()    the active pill's <button class="nav dl-mark empty">, 4 px before
//                           Reload. Class "empty" keeps its 28 px slot free but invisible, so the
//                           address stays where the board puts it: the downloads author fills the
//                           button and removes "empty" to show it. (Not the hidden attribute:
//                           browser.xhtml's xul.css forces [hidden] to display: none !important.)
//   Pill slots (board HomeBrowse, 480 pill): Back 8..36, Forward 38..66, address 76..404 (its text
//                           centred at 240), download mark 410..438, Reload 442..470. On Home the
//                           buttons are not drawn and the placeholder is centred in the whole pill.
//   b.bar.reserve           width kept free at the right edge for the window controls; nothing that
//                           takes clicks may be drawn there (Windows hit-tests the caption buttons
//                           by their place, whatever is painted over them).
//   b.bar.hidden            true while the bar is slid away (auto-hide setting or F11 full screen).
//   b.bar.hiding            true while the bar is in hiding mode (auto-hide or F11), shown or not:
//                           it keeps no band at the top, so pages get no top strip then
//                           (./pagearea.ts; a reveal does not bring the strip back).
//   b.bar.reveal()          show it now; b.bar.hold(reason) keeps it shown until the returned
//                           function is called (find, a popup hanging from the pill).
//                           hold(reason, true) puts it in place without the slide.
//   b.bar.claimPill(width)  the active pill needs at least `width` px (at most 480) until the
//                           returned function is called: find's face (its field keeps its 160 px).
//                           With many tabs the circles shrink and give way first (steps 3 and 4
//                           below) instead of the pill: it keeps what the window would give it next
//                           to three circles, so only a narrow window narrows it. The bar re-renders
//                           at once on claim and release.
//   Anchors                 b.anchor('site') is the active pill, b.anchor('menu') the + circle.
//   Tooltips                setTip(el, label, key) from ./tips (title attributes show nothing).
//   Classes on .item        tab | plus, active, loading, home, morphing, entering; a closed tab's
//                           item stays for 400 ms as .item.leaving (no longer .tab).
//
// Glass (see ./glass)
//   - The active pill has its own lens element: lens(w, 44, { blur: 2.4 }).
//   - All circles (and +) share ONE row-lens element per 24 shapes: div.row-lens under the items,
//     clipped to the union of the circles, with one shared filter (rowLens). It is rebuilt when the
//     layout settles.
//   - While anything moves (420 ms spring) the row lens cannot follow, so it is removed and each
//     circle's own .lens carries the plain blur (class "moving" on #vitre-bar); an item whose width
//     changes (circle <-> pill) carries the morph frost (class "morphing"). 440 ms after the last
//     change the lenses for the final layout are installed.
//
// Many tabs (the Electron build only shrinks the pill; the rest is this build's answer, see render):
//   1. the pill gives way from 480 down to 220 px (not below a claimPill width), the group stays centred;
//   2. the group moves left of centre, into the room beside the window controls;
//   3. the circles shrink from 44 to 30 px (gaps 8 -> 4);
//   4. only the tabs nearest the active one are drawn (the rest stay reachable by keys and the
//      switcher).
//
// Window move: pressing on a bar item and dragging more than 5 px starts a native window move
// (fx.beginWindowMove); a plain click still does what the control does.
import type { Browser } from './browser';
import { el, fill, svg } from './dom';
import * as fx from './firefox';
import { glass, lens, lensCount, MAX_ROW_SHAPES, rowLens, type RowLens } from './glass';
import { icons } from './icons';
import type { Tab } from './model';
import { Reveal } from './reveal';
import { setTip, Tips } from './tips';
import { WindowControls } from './winctl';
import { BAR_ITEM, BAR_TOP } from '../shared/geometry';
import { displayHost } from '../shared/url';

const PILL = 480;
const PILL_MIN = 220;
/** claimPill: the pill keeps what the window gives it beside this many circles (the + included). */
const CLAIM_CIRCLES = 3;
const CIRCLE = BAR_ITEM;
const CIRCLE_MIN = 30;
const GAP = 8;
const TOP = BAR_TOP;
const LEFT_MARGIN = 12;
/** left/width transitions run 420 ms; the lenses for the final layout go in just after. */
const SETTLE = 440;
const SETTLE_REDUCED = 160;
const DRAG_THRESHOLD = 5;

export interface BarHandlers {
  activate(id: number): void;
  close(id: number): void;
  newTab(): void;
  editAddress(): void;
  back(): void;
  forward(): void;
  /** hard = Shift+click on Reload (reload without the cache). */
  reloadOrStop(hard?: boolean): void;
}

export interface BarLayout {
  /** The active pill in window coordinates, or null when there is no active tab. */
  pillRect: DOMRect | null;
  /** Left and right edge of the whole group (tabs and the + circle). */
  left: number;
  right: number;
}

interface Place {
  /** Circle diameter and gap for this layout. */
  size: number;
  gap: number;
  pill: number;
  x0: number;
  total: number;
  /** The tabs that are drawn, in order. */
  shown: Tab[];
}

type Tone = 'light' | 'dark' | 'ok';
/** Favicon URL -> whether the icon is one flat light or dark shape (needs a plate on like glass). */
const tones = new Map<string, Tone>();

/**
 * A favicon that is a single light shape (GitHub's white mark) vanishes on light glass, a single
 * dark one on dark glass. Read the icon back (allowed in the chrome document) and classify it;
 * skin/bar.css puts a plate behind it when the glass theme matches its tone.
 */
function toneOf(img: HTMLImageElement): Tone {
  try {
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'ok';
    ctx.drawImage(img, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let n = 0;
    let sum = 0;
    let squares = 0;
    let solid = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a > 0.5) solid++;
      if (a < 0.1) continue;
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      n += a;
      sum += l * a;
      squares += l * l * a;
    }
    // An icon that fills its box brings its own background.
    if (!n || solid / 256 > 0.92) return 'ok';
    const mean = sum / n;
    const deviation = Math.sqrt(Math.max(0, squares / n - mean * mean));
    if (deviation > 0.18) return 'ok';
    return mean > 0.72 ? 'light' : mean < 0.28 ? 'dark' : 'ok';
  } catch {
    return 'ok';
  }
}

export class Bar {
  layout: BarLayout = { pillRect: null, left: 0, right: 0 };
  /** Starts the native window move; a test may replace it. */
  moveWindow: (screenX: number, screenY: number) => boolean = fx.beginWindowMove;
  /** user32 is reachable and knows this window (everything the move needs except the button press). */
  canMoveWindow: () => boolean = fx.canMoveWindow;
  /**
   * How long after the last layout change the final lenses go in (the 420 ms spring plus a frame).
   * A test may raise it together with the transition durations to look at the bar mid-motion.
   */
  settleDelay = SETTLE;
  readonly tips: Tips;

  private host: HTMLElement;
  private items = new Map<number | 'plus', HTMLElement>();
  /** The width each item was last given (to tell a morph from a slide). */
  private widths = new WeakMap<HTMLElement, number>();
  private controls: WindowControls;
  private visibility: Reveal;
  private rows: { element: HTMLElement; lens: RowLens }[] = [];
  private signature = '';
  private settleTimer = 0;
  private started = false;
  private place: Place = { size: CIRCLE, gap: GAP, pill: PILL, x0: 0, total: 0, shown: [] };
  private activeId = 0;
  /** The tabs of the last render (claimPill re-renders with them). */
  private lastTabs: Tab[] = [];
  /** Widths the active pill must keep (claimPill). */
  private claims = new Set<{ width: number }>();
  private press: { x: number; y: number } | null = null;
  /** Watches each tab's accessories slot: its width balances the address (see the header). */
  private accessoriesWatch = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const slot = entry.target as HTMLElement;
      const item = slot.closest('.item') as HTMLElement | null;
      if (!item) continue;
      const w = Math.round((entry.borderBoxSize?.[0]?.inlineSize ?? slot.getBoundingClientRect().width) * 100) / 100;
      item.classList.toggle('has-acc', w > 0);
      if (w > 0) item.style.setProperty('--vitre-acc', `${w}px`);
      else item.style.removeProperty('--vitre-acc');
    }
  });

  constructor(
    private b: Browser,
    private h: BarHandlers
  ) {
    // The drag strip sits under every layer; the bar is layer 10.
    b.root.append(el('div', { id: 'vitre-drag' }));
    this.host = el('nav', { id: 'vitre-bar', 'aria-label': 'Tabs' });
    const layer = b.layer('bar', 10);
    layer.append(this.host);
    this.controls = new WindowControls(b, layer);
    this.visibility = new Reveal(b, this.host);
    this.tips = new Tips(b);
    b.setAnchor('site', () => this.items.get(this.activeId) ?? null);
    b.setAnchor('menu', () => this.items.get('plus') ?? null);
    this.watchDrag();
  }

  // ---- for other authors ----

  item(id: number): HTMLElement | undefined {
    return this.items.get(id);
  }

  accessories(): HTMLElement | null {
    return this.items.get(this.activeId)?.querySelector<HTMLElement>('.accessories') ?? null;
  }

  downloadMark(): HTMLButtonElement | null {
    return this.items.get(this.activeId)?.querySelector<HTMLButtonElement>('.dl-mark') ?? null;
  }

  get hidden(): boolean {
    return this.visibility.hidden;
  }

  /** In hiding mode (auto-hide setting or F11 full screen), whether or not it is revealed right now. */
  get hiding(): boolean {
    return this.visibility.hiding;
  }

  /** Width kept free at the right edge of the window for the window controls (and the Private label). */
  get reserve(): number {
    return this.controls.reserve;
  }

  reveal(): void {
    this.visibility.show();
  }

  hold(reason: string, instant = false): () => void {
    return this.visibility.hold(reason, instant);
  }

  /**
   * Keep the active pill at least `width` px wide (capped at 480 and at what the window leaves)
   * until the returned function is called. The bar is laid out again at once (b.bar.layout is the
   * new slot when this returns) and the window's full render follows in a microtask.
   */
  claimPill(width: number): () => void {
    const claim = { width: Math.max(0, Math.min(PILL, Math.round(width))) };
    this.claims.add(claim);
    this.relayout();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.claims.delete(claim);
      this.relayout();
    };
  }

  private relayout(): void {
    if (!this.started) return;
    this.render(this.lastTabs, this.activeId);
    queueMicrotask(() => this.b.render());
  }

  /** For tests: what the last render decided, and the lens filters that exist. */
  get state(): { size: number; gap: number; pill: number; shown: number; rows: number; settled: boolean; hiding: boolean; revealed: boolean; lenses: { filters: number; rows: number; cached: number } } {
    const p = this.place;
    return { size: p.size, gap: p.gap, pill: p.pill, shown: p.shown.length, rows: this.rows.length, settled: !this.settleTimer, hiding: this.visibility.hiding, revealed: this.visibility.revealed, lenses: lensCount() };
  }

  // ---- layout ----

  /** Where everything goes for this many tabs in this window. */
  private arrange(tabs: Tab[], activeId: number): Place {
    const W = Math.floor(window.innerWidth); // fractional at 125 % / 150 % scaling
    const popup = this.b.isPopup;
    const reserve = this.controls.reserve;
    const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === activeId));
    // A popup window shows its one page: a read-only pill and the window controls.
    let shown = popup ? tabs.slice(activeIndex, activeIndex + 1) : tabs;
    const circles = (n: number): number => Math.max(0, n - 1) + (popup ? 0 : 1); // other tabs and +
    const width = (n: number, size: number, gap: number, pill: number): number => pill + circles(n) * (size + gap);

    let size = CIRCLE;
    let gap = GAP;
    // 1. As designed: centred between two equal margins that clear the window controls.
    const centred = W - 2 * reserve;
    let pill = Math.max(PILL_MIN, Math.min(PILL, centred - circles(shown.length) * (CIRCLE + GAP)));
    // 2. Beyond that the group may use all the room left of the window controls.
    const room = W - LEFT_MARGIN - reserve;
    // A claimed width (find's face) is not given up to the number of tabs: the pill keeps what the
    // window would give it beside CLAIM_CIRCLES circles, and the other circles shrink and give way
    // instead (3, 4). A narrow window still narrows it (DESIGN-NOTES Find: under 400 px, Aa moves
    // into the field menu).
    const claim = popup ? 0 : Math.max(0, ...[...this.claims].map((c) => c.width));
    if (claim > pill) {
      const afforded = Math.min(centred - Math.min(circles(shown.length), CLAIM_CIRCLES) * (CIRCLE + GAP), room - (CIRCLE_MIN + 4));
      pill = Math.max(pill, Math.min(claim, afforded));
    }
    let total = width(shown.length, size, gap, pill);
    if (total > room) {
      if (popup) {
        pill = Math.max(120, room);
      } else {
        // 3. Smaller circles.
        while (size > CIRCLE_MIN && width(shown.length, size, gap, pill) > room) {
          size -= 2;
          gap = size >= 38 ? 8 : size >= 34 ? 6 : 4;
        }
        if (width(shown.length, size, gap, pill) > room) {
          // 4. Draw the tabs nearest the active one.
          const fit = Math.max(1, Math.floor((room - pill) / (size + gap))); // circles that fit, + included
          const others = Math.max(0, fit - 1);
          let before = Math.min(activeIndex, Math.floor(others / 2));
          const after = Math.min(tabs.length - 1 - activeIndex, others - before);
          before = Math.min(activeIndex, others - after);
          shown = tabs.slice(activeIndex - before, activeIndex + after + 1);
        }
      }
      total = width(shown.length, size, gap, pill);
    }
    let x0 = Math.round((W - total) / 2);
    if (x0 + total > W - reserve) x0 = W - reserve - total;
    x0 = Math.max(LEFT_MARGIN, x0);
    return { size, gap, pill, x0, total, shown };
  }

  render(tabs: Tab[], activeId: number): void {
    const popup = this.b.isPopup;
    const first = !this.started;
    const p = this.arrange(tabs, activeId);
    const circleTop = TOP + (CIRCLE - p.size) / 2;
    this.lastTabs = tabs;
    this.place = p;
    this.activeId = activeId;
    this.host.classList.toggle('close-always', this.b.settings.closeButton === 'always');
    this.host.classList.toggle('compact', p.size < CIRCLE);

    let x = p.x0;
    const seen = new Set<number | 'plus'>();
    const shapes: string[] = [`${p.size}`];
    this.layout = { pillRect: null, left: x, right: x + p.total };

    const put = (item: HTMLElement, left: number, width: number, active: boolean): void => {
      item.style.left = `${left}px`;
      item.style.width = `${width}px`;
      item.style.top = `${active ? TOP : circleTop}px`;
      item.style.height = `${active ? CIRCLE : p.size}px`;
    };

    for (const t of p.shown) {
      seen.add(t.id);
      const active = t.id === activeId;
      const width = active ? p.pill : p.size;
      let item = this.items.get(t.id);
      if (!item) {
        item = this.createTab(t.id);
        if (!first) {
          // Grow from a circle at the middle of the slot.
          put(item, x + (width - p.size) / 2, p.size, false);
          item.classList.add('entering');
        }
        this.host.append(item);
        if (!first) {
          void item.offsetWidth; // the start state must be computed for the transition to run
          item.classList.remove('entering');
          this.widths.set(item, p.size);
        }
      }
      this.updateTab(item, t, active, popup);
      const before = this.widths.get(item);
      if (before !== undefined && before !== width) item.classList.add('morphing');
      this.widths.set(item, width);
      put(item, x, width, active);
      if (active) this.layout.pillRect = new DOMRect(x, TOP, width, CIRCLE);
      shapes.push(`${t.id}${active ? 'P' : 'c'}${x}:${width}`);
      x += width + p.gap;
    }

    if (!popup) {
      let plus = this.items.get('plus');
      if (!plus) {
        const face = el('button', { type: 'button', class: 'face', 'aria-label': 'New tab' }, svg(icons.plus));
        setTip(face, 'New tab', 'Ctrl+T');
        face.addEventListener('click', () => this.h.newTab());
        plus = el('div', { class: 'item circle plus' }, face);
        glass(plus);
        this.items.set('plus', plus);
        this.host.append(plus);
      }
      seen.add('plus');
      put(plus, x, p.size, false);
      shapes.push(`+${x}`);
    }

    for (const [id, item] of this.items) {
      if (seen.has(id)) continue;
      this.items.delete(id);
      const slot = item.querySelector('.accessories');
      if (slot) this.accessoriesWatch.unobserve(slot);
      // No longer a tab: it only fades out (selectors for tabs must not find it).
      item.classList.remove('tab');
      item.classList.add('leaving');
      item.setAttribute('inert', '');
      window.setTimeout(() => item.remove(), 400);
    }

    this.controls.sync();
    this.visibility.update();

    // Lenses: install at once the first time, otherwise once the motion is over.
    const signature = shapes.join(' ');
    if (signature !== this.signature) {
      this.signature = signature;
      if (first) this.settle();
      else this.unsettle();
    }
    if (p.shown.length) this.started = true;
  }

  /** Something moves: per-item filters until it stops. */
  private unsettle(): void {
    for (const row of this.rows.splice(0)) {
      row.element.remove();
      row.lens.release();
    }
    this.host.classList.add('moving');
    window.clearTimeout(this.settleTimer);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.settleTimer = window.setTimeout(() => this.settle(), reduced ? SETTLE_REDUCED : this.settleDelay);
  }

  /** The layout is at rest: the pill gets its lens, the circles share row lenses. */
  private settle(): void {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = 0;
    for (const row of this.rows.splice(0)) {
      row.element.remove();
      row.lens.release();
    }
    const p = this.place;
    const circles: { x: number; w: number }[] = [];
    for (const [id, item] of this.items) {
      item.classList.remove('morphing');
      const own = glassLens(item);
      const left = parseFloat(item.style.left) || 0;
      if (id === this.activeId) {
        own.style.backdropFilter = lens(p.pill, CIRCLE, { blur: 2.4 });
      } else {
        own.style.backdropFilter = '';
        circles.push({ x: left, w: p.size });
      }
    }
    circles.sort((a, c) => a.x - c.x);
    const top = TOP + (CIRCLE - p.size) / 2;
    for (let i = 0; i < circles.length; i += MAX_ROW_SHAPES) {
      const chunk = circles.slice(i, i + MAX_ROW_SHAPES);
      const x0 = chunk[0].x;
      const last = chunk[chunk.length - 1];
      const width = last.x + last.w - x0;
      const row = rowLens(width, p.size, chunk.map((c) => ({ x: c.x - x0, w: c.w })));
      const element = el('div', { class: 'row-lens' });
      element.style.left = `${x0}px`;
      element.style.top = `${top}px`;
      element.style.width = `${width}px`;
      element.style.height = `${p.size}px`;
      element.style.clipPath = row.clip;
      element.style.backdropFilter = row.filter;
      this.host.prepend(element);
      this.rows.push({ element, lens: row });
    }
    this.host.classList.remove('moving');
  }

  // ---- items ----

  private createTab(id: number): HTMLElement {
    const back = el('button', { type: 'button', class: 'nav back', 'aria-label': 'Back' }, svg(icons.back));
    const forward = el('button', { type: 'button', class: 'nav forward', 'aria-label': 'Forward' }, svg(icons.forward));
    const address = el('button', { type: 'button', class: 'address', 'aria-label': 'Edit address' }, el('span', { class: 'fav' }), el('span', { class: 'host' }));
    const accessories = el('span', { class: 'accessories', role: 'group', 'aria-label': 'Extensions' });
    const mark = el('button', { type: 'button', class: 'nav dl-mark empty', 'aria-hidden': 'true', tabindex: '-1' });
    const reload = el('button', { type: 'button', class: 'nav reload', 'aria-label': 'Reload' });
    const pill = el('div', { class: 'pill-face' }, back, forward, address, accessories, mark, reload);
    const circle = el('button', { type: 'button', class: 'circle-face' }, el('span', { class: 'fav' }));
    const close = el('button', { type: 'button', class: 'close-badge', 'aria-label': 'Close tab' }, svg(icons.closeSmall));
    const item = el('div', { class: 'item tab', 'data-id': id }, pill, circle, close, el('div', { class: 'load-line' }));
    glass(item);
    this.accessoriesWatch.observe(accessories);

    setTip(back, 'Back', 'Alt+Left');
    setTip(forward, 'Forward', 'Alt+Right');
    setTip(close, 'Close tab');
    back.addEventListener('click', () => this.h.back());
    forward.addEventListener('click', () => this.h.forward());
    reload.addEventListener('click', (e) => this.h.reloadOrStop(e.shiftKey));
    address.addEventListener('click', () => {
      if (!this.b.isPopup) this.h.editAddress();
    });
    circle.addEventListener('click', () => this.h.activate(id));
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.h.close(id);
    });
    item.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.h.close(id);
    });
    item.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // no autoscroll cursor
    });
    this.items.set(id, item);
    return item;
  }

  private updateTab(item: HTMLElement, t: Tab, active: boolean, popup: boolean): void {
    const home = t.kind === 'home';
    item.classList.toggle('active', active);
    item.classList.toggle('loading', t.loading);
    item.classList.toggle('home', home);
    const label = home ? 'Home' : t.title || displayHost(t.url) || 'New tab';
    const circle = item.querySelector('.circle-face') as HTMLElement;
    const close = item.querySelector('.close-badge') as HTMLElement;
    circle.setAttribute('aria-label', label);
    setTip(circle, label);
    close.setAttribute('aria-label', `Close ${label}`);
    // The face that is not showing is out of the tab order.
    const pillFace = item.querySelector('.pill-face') as HTMLElement;
    if (active) {
      pillFace.removeAttribute('inert');
      circle.setAttribute('inert', '');
    } else {
      pillFace.setAttribute('inert', '');
      circle.removeAttribute('inert');
    }

    const key = home ? 'home' : t.favicon ?? 'globe';
    for (const fav of item.querySelectorAll<HTMLElement>('.fav')) {
      const want = home && fav.parentElement?.classList.contains('address') ? 'search' : key;
      if (fav.dataset.src === want) continue;
      fav.dataset.src = want;
      delete fav.dataset.tone;
      if (want === 'search') fill(fav, svg(icons.search));
      else if (want === 'home') fill(fav, svg(icons.home));
      else if (t.favicon) {
        const src = t.favicon;
        const img = el('img', { src, alt: '', draggable: 'false' });
        img.addEventListener('error', () => {
          if (fav.dataset.src === src) fill(fav, svg(icons.globe));
        });
        img.addEventListener('load', () => {
          let tone = tones.get(src);
          if (!tone) {
            tone = toneOf(img);
            tones.set(src, tone);
            if (tones.size > 400) tones.delete(tones.keys().next().value as string);
          }
          if (fav.dataset.src === src && tone !== 'ok') fav.dataset.tone = tone;
        });
        fill(fav, img);
      } else fill(fav, svg(icons.globe));
    }

    const host = item.querySelector('.host') as HTMLElement;
    const address = item.querySelector('.address') as HTMLElement;
    const shownHost = displayHost(t.url);
    address.classList.toggle('placeholder', home);
    const text = home ? 'Search or enter address' : t.zoomFlash > Date.now() ? `${Math.round(t.zoom * 100)}%` : shownHost;
    if (host.textContent !== text) host.textContent = text;
    address.setAttribute('aria-label', popup ? shownHost : home ? 'Search or enter address' : `${shownHost}, edit address`);
    if (popup) address.setAttribute('aria-disabled', 'true');

    const back = item.querySelector('.back') as HTMLElement;
    const forward = item.querySelector('.forward') as HTMLElement;
    const reload = item.querySelector('.reload') as HTMLElement;
    back.setAttribute('aria-disabled', String(!t.canBack));
    forward.setAttribute('aria-disabled', String(!t.canForward));
    const reloadKey = t.loading ? 'stop' : 'reload';
    if (reload.dataset.icon !== reloadKey) {
      reload.dataset.icon = reloadKey;
      fill(reload, svg(t.loading ? icons.stop : icons.reload));
      reload.setAttribute('aria-label', t.loading ? 'Stop' : 'Reload');
      setTip(reload, t.loading ? 'Stop' : 'Reload', t.loading ? 'Esc' : 'Ctrl+R');
    }
  }

  // ---- dragging the bar moves the window ----

  private watchDrag(): void {
    let dragged = false;
    this.host.addEventListener('mousedown', (e) => {
      this.press = null;
      dragged = false;
      if (e.button !== 0 || window.fullScreen) return;
      const target = e.target as Element;
      if (!target.closest('.item') || target.closest('.close-badge, .accessories, input')) return;
      this.press = { x: e.screenX, y: e.screenY };
    });
    window.addEventListener(
      'mousemove',
      (e) => {
        const press = this.press;
        if (!press) return;
        if (!(e.buttons & 1)) {
          this.press = null;
          return;
        }
        if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < DRAG_THRESHOLD) return;
        this.press = null;
        dragged = true;
        this.tips.hide();
        this.moveWindow(e.screenX, e.screenY);
      },
      true
    );
    window.addEventListener('mouseup', () => (this.press = null), true);
    // Windows' move loop takes the mouse-up, so no click follows a drag; if one does, it is not a click.
    this.host.addEventListener(
      'click',
      (e) => {
        if (!dragged) return;
        dragged = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
  }
}

function glassLens(item: HTMLElement): HTMLElement {
  return item.querySelector(':scope > .lens') as HTMLElement;
}
