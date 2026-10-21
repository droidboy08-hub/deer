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
//                           A side of a split pair answers with the pair's element (.item.tab.pair).
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
//   b.bar.halfRect(tabId)   split view: the half of the split pill that shows that side (the address
//                           field grows from it), or null.
//   Anchors                 b.anchor('site') is the active pill (in split view its focused half),
//                           b.anchor('menu') the + circle.
//   Tooltips                setTip(el, label, key) from ./tips (title attributes show nothing).
//   Classes on .item        tab | plus, active, loading, home, morphing, entering, mixed; a closed
//                           tab's item stays for 400 ms as .item.leaving (no longer .tab). A split
//                           pair is one item, .item.tab.pair, with two faces: the split pill
//                           (.pill-face.split-face, while one of its sides is active) and the
//                           capsule (.capsule-face, 2 circles + gap wide, while another tab is).
//
// Split view (../design/SPLIT-VIEW-SPEC.md, boards SplitPill, SplitSpec; split.ts has the model)
//   - A pair is one unit of the layout: active, it takes the pill's slot (480, giving way to 360
//     before circles shrink); in the background it is a capsule exactly as wide as two circles and a
//     gap. The group is centred exactly as for one tab and never follows the divider (owner's
//     decision 2026-10-20).
//   - Split pill (pill-local, 480): Back 8..36, Forward 38..66, left half 70..240, seam at 240, right
//     half 240..410, mark 410..438, Reload 442..470; extension buttons sit between the right half and
//     the mark and both halves give way equally. A half: favicon 16 px at 14, host from 38 with a
//     12 px fade when cut, a 24 px x at h-30 on hover; the focused half has the "on" plate (inset
//     2 px, radius 16), the other a hover plate; a click on the unfocused half focuses that side, on
//     the focused half opens the address field for it; middle-click or x closes that side. With a
//     Home side focused Back, Forward and Reload stay (Back and Forward dimmed: SplitSpec "Home side").
//   - Capsule: favicons 18 px centred on each circle's footprint, a 1x16 hairline between, a close
//     badge at the hovered half's outer top corner; a click shows the pair with that side focused.
//   - Keyboard: both halves of the split pill and both halves of a capsule are stops of the bar
//     (barkeys.ts); Shift+F10 or the Menu key on one opens its menu (splitpill, capsule).
//   - Mixed tint: when one page of the showing pair is light and the other is not, every glass item
//     that sits (even partly) over the other page gets class "mixed" (skin/bar.css). The window
//     controls take the theme of the page under them (class theme-* on #vitre-winctl). Both follow
//     the panes on 'split-changed' (every divider move), without a layout of the bar.
//
// Glass (see ./glass)
//   - The active pill has its own lens element: lens(w, 44, { blur: 2.4 }).
//   - All circles (and +) share ONE row-lens element per 24 shapes: div.row-lens under the items,
//     clipped to the union of the circles, with one shared filter (rowLens). It is rebuilt when the
//     layout settles. A background pair's capsule is one wider shape of the same row.
//   - While anything moves (420 ms spring) the row lens cannot follow, so it is removed and each
//     circle's own .lens carries the plain blur (class "moving" on #vitre-bar); an item whose width
//     changes (circle <-> pill) carries the morph frost (class "morphing"). 440 ms after the last
//     change the lenses for the final layout are installed.
//
// Many tabs (the Electron build only shrinks the pill; the rest is this build's answer, see render):
//   1. the pill gives way from 480 down to 220 px (360 for a split pill; not below a claimPill
//      width), the group stays centred;
//   2. the group moves left of centre, into the room beside the window controls;
//   3. the circles shrink from 44 to 30 px (gaps 8 -> 4);
//   4. only the tabs nearest the active one are drawn (the rest stay reachable by keys and the
//      switcher); a background pair counts as two circles.
//
// Window move: pressing on a bar item and dragging more than 5 px starts a native window move
// (fx.beginWindowMove); a plain click still does what the control does.
import type { Browser } from './browser';
import { el, fill, svg } from './dom';
import * as fx from './firefox';
import { glass, lens, lensCount, MAX_ROW_SHAPES, rowLens, type RowLens } from './glass';
import { icons } from './icons';
import type { Tab, Theme } from './model';
import { Reveal } from './reveal';
import { titleOf, type Pair, type Unit } from './split';
import { setTip, Tips } from './tips';
import { WindowControls } from './winctl';
import { BAR_ITEM, BAR_TOP } from '../shared/geometry';
import { displayHost } from '../shared/url';

const PILL = 480;
const PILL_MIN = 220;
/** Spec "Split pill": Give-way. The split pill narrows to 360 (halves 170 -> 110) before circles shrink. */
const PAIR_MIN = 360;
/** A half's host starts at 38 and ends 12 px from the half's end at rest, 34 beside the hover x (skin/bar.css). */
const HALF_TEXT_REST = 38 + 12;
const HALF_TEXT_HOVER = 38 + 34;
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
  /** The units that are drawn, in order (a tab, or a split pair). */
  shown: Unit[];
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

/** Fill a .fav span with `want` ('home', 'search', or the tab's favicon URL), once per change. */
function paintFav(fav: HTMLElement, t: Tab, want: string): void {
  if (fav.dataset.src === want) return;
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
  /** Tab items by tab id, split pairs by their unit key ('pair-<splitViewId>'), the + circle. */
  private items = new Map<number | string, HTMLElement>();
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
  /** The key of the active unit's item (the tab id, or a pair's key). */
  private activeKey: number | string = 0;
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
    // In split view native popups hang from the focused half (spec "Prompts and other per-pane surfaces").
    b.setAnchor('site', () => this.activeItem()?.querySelector<HTMLElement>('.half.focused') ?? this.activeItem() ?? null);
    b.setAnchor('menu', () => this.items.get('plus') ?? null);
    // The panes moved (a divider drag, a key, a double-click, a resize) or the pair changed: the mixed
    // tint goes to the glass over the other page now, and the window controls take the theme of the
    // page under them (spec "Where the bar sits": Theme). Nothing in the bar moves for it.
    b.on('split-changed', () => this.paintSplitTheme());
    this.watchDrag();
  }

  // ---- for other authors ----

  item(id: number): HTMLElement | undefined {
    return this.items.get(id) ?? this.pairItem(id);
  }

  accessories(): HTMLElement | null {
    return this.activeItem()?.querySelector<HTMLElement>('.accessories') ?? null;
  }

  downloadMark(): HTMLButtonElement | null {
    return this.activeItem()?.querySelector<HTMLButtonElement>('.dl-mark') ?? null;
  }

  /** The half of a split pill that shows tab `id` (window coordinates), or null. */
  halfRect(id: number): DOMRect | null {
    const half = this.pairItem(id)?.querySelector<HTMLElement>(`.split-face .half[data-id="${id}"]`);
    const r = half?.getBoundingClientRect();
    return r && r.width > 0 ? r : null;
  }

  private pairItem(id: number): HTMLElement | undefined {
    const p = this.b.pairOf(id);
    return p ? this.items.get(`pair-${p.id}`) : undefined;
  }

  private activeItem(): HTMLElement | undefined {
    return this.items.get(this.activeKey) ?? this.item(this.activeId);
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

  /** Where everything goes for these units in this window. */
  private arrange(units: Unit[], activeId: number): Place {
    const W = Math.floor(window.innerWidth); // fractional at 125 % / 150 % scaling
    const popup = this.b.isPopup;
    const reserve = this.controls.reserve;
    const activeIndex = Math.max(0, units.findIndex((u) => u.tabs.some((t) => t.id === activeId)));
    const activeUnit = units[activeIndex];
    // A popup window shows its one page: a read-only pill and the window controls.
    let shown = popup ? units.slice(activeIndex, activeIndex + 1) : units;
    // Circle slots beside the pill: the other units (a background pair is two circles and the gap
    // between them, i.e. two slots) and the + circle.
    const weight = (u: Unit): number => (u.kind === 'pair' ? 2 : 1);
    const circles = (list: Unit[]): number => list.reduce((n, u) => n + (u === activeUnit ? 0 : weight(u)), 0) + (popup ? 0 : 1);
    const width = (list: Unit[], size: number, gap: number, pill: number): number => pill + circles(list) * (size + gap);
    const pillMin = activeUnit?.kind === 'pair' ? PAIR_MIN : PILL_MIN;

    let size = CIRCLE;
    let gap = GAP;
    // 1. As designed: centred between two equal margins that clear the window controls.
    const centred = W - 2 * reserve;
    let pill = Math.max(pillMin, Math.min(PILL, centred - circles(shown) * (CIRCLE + GAP)));
    // 2. Beyond that the group may use all the room left of the window controls.
    const room = W - LEFT_MARGIN - reserve;
    // A claimed width (find's face) is not given up to the number of tabs: the pill keeps what the
    // window would give it beside CLAIM_CIRCLES circles, and the other circles shrink and give way
    // instead (3, 4). A narrow window still narrows it (DESIGN-NOTES Find: under 400 px, Aa moves
    // into the field menu).
    const claim = popup ? 0 : Math.max(0, ...[...this.claims].map((c) => c.width));
    if (claim > pill) {
      const afforded = Math.min(centred - Math.min(circles(shown), CLAIM_CIRCLES) * (CIRCLE + GAP), room - (CIRCLE_MIN + 4));
      pill = Math.max(pill, Math.min(claim, afforded));
    }
    let total = width(shown, size, gap, pill);
    if (total > room) {
      if (popup) {
        pill = Math.max(120, room);
      } else {
        // 3. Smaller circles.
        while (size > CIRCLE_MIN && width(shown, size, gap, pill) > room) {
          size -= 2;
          gap = size >= 38 ? 8 : size >= 34 ? 6 : 4;
        }
        if (width(shown, size, gap, pill) > room) {
          // 4. Draw the units nearest the active one.
          const fit = Math.max(1, Math.floor((room - pill) / (size + gap))); // circle slots that fit, + included
          shown = nearest(units, activeIndex, Math.max(0, fit - 1), weight);
        }
      }
      total = width(shown, size, gap, pill);
    }
    let x0 = Math.round((W - total) / 2);
    if (x0 + total > W - reserve) x0 = W - reserve - total;
    x0 = Math.max(LEFT_MARGIN, x0);
    return { size, gap, pill, x0, total, shown };
  }

  render(tabs: Tab[], activeId: number): void {
    const popup = this.b.isPopup;
    const first = !this.started;
    const units = this.b.units();
    const p = this.arrange(units, activeId);
    const circleTop = TOP + (CIRCLE - p.size) / 2;
    this.lastTabs = tabs;
    this.place = p;
    this.activeId = activeId;
    this.host.classList.toggle('close-always', this.b.settings.closeButton === 'always');
    this.host.classList.toggle('compact', p.size < CIRCLE);

    let x = p.x0;
    const seen = new Set<number | string>();
    const shapes: string[] = [`${p.size}`];
    this.layout = { pillRect: null, left: x, right: x + p.total };

    const put = (item: HTMLElement, left: number, width: number, active: boolean): void => {
      item.style.left = `${left}px`;
      item.style.width = `${width}px`;
      item.style.top = `${active ? TOP : circleTop}px`;
      item.style.height = `${active ? CIRCLE : p.size}px`;
    };

    for (const u of p.shown) {
      const key = u.key;
      seen.add(key);
      const active = u.tabs.some((t) => t.id === activeId);
      if (active) this.activeKey = key;
      const width = active ? p.pill : u.kind === 'pair' ? 2 * p.size + p.gap : p.size;
      let item = this.items.get(key);
      if (!item) {
        item = u.kind === 'pair' ? this.createPair(u.key) : this.createTab(u.tab.id);
        if (!first) {
          // Grow from a circle at the middle of the slot (a split pair fades in: phase 1 motion).
          if (u.kind === 'pair') put(item, x, width, active);
          else put(item, x + (width - p.size) / 2, p.size, false);
          item.classList.add(u.kind === 'pair' ? 'entering-fade' : 'entering');
        }
        this.host.append(item);
        if (!first) {
          void item.offsetWidth; // the start state must be computed for the transition to run
          item.classList.remove('entering', 'entering-fade');
          this.widths.set(item, u.kind === 'pair' ? width : p.size);
        }
      }
      if (u.kind === 'pair') this.updatePair(item, u.pair, active, p);
      else this.updateTab(item, u.tab, active, popup);
      const before = this.widths.get(item);
      if (before !== undefined && before !== width) item.classList.add('morphing');
      this.widths.set(item, width);
      put(item, x, width, active);
      if (active) this.layout.pillRect = new DOMRect(x, TOP, width, CIRCLE);
      shapes.push(`${key}${active ? 'P' : 'c'}${x}:${width}`);
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
      for (const slot of item.querySelectorAll('.accessories')) this.accessoriesWatch.unobserve(slot);
      // No longer a tab: it only fades out (selectors for tabs must not find it).
      item.classList.remove('tab');
      item.classList.add('leaving');
      item.setAttribute('inert', '');
      window.setTimeout(() => item.remove(), 400);
    }

    this.paintSplitTheme();
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

  /**
   * Split view's glass (spec "Where the bar sits": Theme). The group takes the focused side's theme
   * (the root's, set by the Browser); when one page is light and the other is not, every item over
   * the other page, even partly, takes the mixed tint. The window controls take the theme of the
   * page under them. Without a showing pair nothing is set (the bar is as it always was).
   */
  private paintSplitTheme(): void {
    const split = this.b.splitView;
    const pair = split.showing();
    const rects = pair ? split.paneRects() : null;
    const active = this.b.active();
    let other: { l: number; r: number } | null = null;
    let mixed = false;
    let controls: Theme | null = null;
    if (pair && rects && active) {
      const o = pair.left === active ? pair.right : pair.left;
      const or = o === pair.left ? rects.left : rects.right;
      other = { l: or.left, r: or.right };
      mixed = (active.theme === 'light') !== (o.theme === 'light');
      // The capsule's place: 12 px from the right, 108 wide.
      const mid = window.innerWidth - 12 - 54;
      const under = mid >= or.left && mid < or.right ? o : active;
      // A module's hold (the switcher's deck) is read by the controls too: no theme of their own then.
      if (this.b.theme() === active.theme && under.theme !== active.theme) controls = under.theme;
    }
    for (const [, item] of this.items) {
      if (item.classList.contains('leaving')) continue;
      const left = parseFloat(item.style.left) || 0;
      const w = parseFloat(item.style.width) || 0;
      item.classList.toggle('mixed', mixed && !!other && left < other.r && left + w > other.l);
    }
    this.controls.setTheme(controls);
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

  /** The layout is at rest: the pill gets its lens, the circles (and capsules) share row lenses. */
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
      if (id === this.activeKey) {
        own.style.backdropFilter = lens(p.pill, CIRCLE, { blur: 2.4 });
      } else {
        own.style.backdropFilter = '';
        circles.push({ x: left, w: item.classList.contains('pair') ? 2 * p.size + p.gap : p.size });
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
      paintFav(fav, t, home && fav.parentElement?.classList.contains('address') ? 'search' : key);
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

  // ---- split pairs (spec "Split pill", "Pair capsule") ----

  private createPair(key: string): HTMLElement {
    const back = el('button', { type: 'button', class: 'nav back', 'aria-label': 'Back' }, svg(icons.back));
    const forward = el('button', { type: 'button', class: 'nav forward', 'aria-label': 'Forward' }, svg(icons.forward));
    const reload = el('button', { type: 'button', class: 'nav reload', 'aria-label': 'Reload' });
    const mark = el('button', { type: 'button', class: 'nav dl-mark empty', 'aria-hidden': 'true', tabindex: '-1' });
    const accessories = el('span', { class: 'accessories', role: 'group', 'aria-label': 'Extensions' });
    const idOf = (node: HTMLElement): number => Number(node.dataset.id);
    const half = (side: 'left' | 'right'): HTMLElement => {
      const main = el('button', { type: 'button', class: 'half-main' }, el('span', { class: 'fav' }), el('span', { class: 'host' }));
      const x = el('button', { type: 'button', class: 'half-x' }, svg(icons.closeHalf));
      setTip(x, 'Close this side');
      const node = el('div', { class: `half ${side}` }, el('div', { class: 'plate' }), main, x, el('div', { class: 'half-load' }));
      // The unfocused half works like a circle, the focused one like the pill (spec "Split pill": Clicks).
      main.addEventListener('click', () => {
        const id = idOf(node);
        if (id === this.activeId) this.h.editAddress();
        else this.h.activate(id);
      });
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.close(idOf(node));
      });
      node.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        this.h.close(idOf(node));
      });
      return node;
    };
    const face = el('div', { class: 'pill-face split-face', role: 'group' }, back, forward, half('left'), half('right'), accessories, mark, reload);
    const capHalf = (side: 'left' | 'right'): HTMLElement => {
      const button = el('button', { type: 'button', class: 'cap-half' }, el('span', { class: 'fav' }));
      const x = el('button', { type: 'button', class: 'close-badge cap-x' }, svg(icons.closeSmall));
      const slot = el('div', { class: `cap-slot ${side}` }, button, x);
      button.addEventListener('click', () => this.h.activate(idOf(slot)));
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.close(idOf(slot));
      });
      slot.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        this.h.close(idOf(slot));
      });
      return slot;
    };
    const capsule = el('div', { class: 'capsule-face', role: 'group' }, el('span', { class: 'hair', 'aria-hidden': 'true' }), capHalf('left'), capHalf('right'));
    const item = el('div', { class: 'item tab pair', 'data-pair': key }, face, capsule);
    glass(item);
    this.accessoriesWatch.observe(accessories);
    setTip(back, 'Back', 'Alt+Left');
    setTip(forward, 'Forward', 'Alt+Right');
    back.addEventListener('click', () => this.h.back());
    forward.addEventListener('click', () => this.h.forward());
    reload.addEventListener('click', (e) => this.h.reloadOrStop(e.shiftKey));
    item.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // no autoscroll cursor
    });
    this.items.set(key, item);
    return item;
  }

  private updatePair(item: HTMLElement, pair: Pair, active: boolean, p: Place): void {
    const { left, right } = pair;
    item.classList.toggle('active', active);
    item.classList.remove('home');
    const face = item.querySelector('.split-face') as HTMLElement;
    const capsule = item.querySelector('.capsule-face') as HTMLElement;
    if (active) {
      face.removeAttribute('inert');
      capsule.setAttribute('inert', '');
    } else {
      face.setAttribute('inert', '');
      capsule.removeAttribute('inert');
    }
    const names = `${titleOf(left)}, left; ${titleOf(right)}, right`;
    face.setAttribute('aria-label', `Split view: ${names}`);
    capsule.setAttribute('aria-label', `${titleOf(left)} and ${titleOf(right)}, split view`);
    // Two pages of one site show their titles instead of the host (spec "What a half shows").
    const sameHost = left.kind === 'web' && right.kind === 'web' && displayHost(left.url) === displayHost(right.url);
    const focusedTab = active ? this.b.active() : undefined;

    for (const side of ['left', 'right'] as const) {
      const t = pair[side];
      const node = item.querySelector(`.split-face .half.${side}`) as HTMLElement;
      node.dataset.id = String(t.id);
      const focused = !!focusedTab && focusedTab === t;
      const home = t.kind === 'home';
      node.classList.toggle('focused', focused);
      node.classList.toggle('home', home);
      node.classList.toggle('loading', t.loading);
      paintFav(node.querySelector('.fav') as HTMLElement, t, home ? 'search' : t.favicon ?? 'globe');
      const label = home ? 'Search' : t.zoomFlash > Date.now() ? `${Math.round(t.zoom * 100)}%` : sameHost ? t.title || displayHost(t.url) : displayHost(t.url) || titleOf(t);
      const host = node.querySelector('.host') as HTMLElement;
      if (host.textContent !== label) host.textContent = label;
      const main = node.querySelector('.half-main') as HTMLElement;
      const named = home ? 'Search' : sameHost ? t.title || displayHost(t.url) : displayHost(t.url) || titleOf(t);
      main.setAttribute('aria-label', `${named}, ${side} page${focused ? ', edit address' : ''}`);
      main.setAttribute('aria-pressed', String(focused));
      setTip(main, home ? null : t.title || displayHost(t.url) || null);
      (node.querySelector('.half-x') as HTMLElement).setAttribute('aria-label', `Close ${side} page, ${titleOf(t)}`);

      const slot = item.querySelector(`.capsule-face .cap-slot.${side}`) as HTMLElement;
      slot.dataset.id = String(t.id);
      paintFav(slot.querySelector('.fav') as HTMLElement, t, home ? 'home' : t.favicon ?? 'globe');
      const button = slot.querySelector('.cap-half') as HTMLElement;
      button.setAttribute('aria-label', `${titleOf(t)}, ${side} page`);
      setTip(button, titleOf(t));
      (slot.querySelector('.cap-x') as HTMLElement).setAttribute('aria-label', `Close ${side} page, ${titleOf(t)}`);
    }

    // The capsule: two circles' footprint (spec "Pair capsule": favicons centred at s/2 and s+gap+s/2).
    const s = p.size;
    const g = p.gap;
    const capW = 2 * s + g;
    const ls = item.querySelector('.cap-slot.left') as HTMLElement;
    const rs = item.querySelector('.cap-slot.right') as HTMLElement;
    ls.style.width = `${capW / 2}px`;
    rs.style.left = `${capW / 2}px`;
    rs.style.width = `${capW / 2}px`;
    (ls.querySelector('.fav') as HTMLElement).style.left = `${s / 2 - 9}px`;
    (rs.querySelector('.fav') as HTMLElement).style.left = `${s + g + s / 2 - 9 - capW / 2}px`;
    for (const fav of [ls, rs].map((x) => x.querySelector('.fav') as HTMLElement)) fav.style.top = `${s / 2 - 9}px`;
    (rs.querySelector('.cap-x') as HTMLElement).style.left = `${capW / 2 - 13}px`;

    // Back, Forward, Reload act on the focused side; their names carry it (spec "Accessibility").
    const f = focusedTab ?? left;
    const where = pair.left === f ? 'left' : 'right';
    const back = item.querySelector('.split-face .back') as HTMLElement;
    const forward = item.querySelector('.split-face .forward') as HTMLElement;
    const reload = item.querySelector('.split-face .reload') as HTMLElement;
    back.setAttribute('aria-disabled', String(!f.canBack));
    forward.setAttribute('aria-disabled', String(!f.canForward));
    back.setAttribute('aria-label', `Back, ${where} page`);
    forward.setAttribute('aria-label', `Forward, ${where} page`);
    item.classList.toggle('focus-home', f.kind === 'home');
    const reloadKey = `${f.loading ? 'stop' : 'reload'}-${where}`;
    if (reload.dataset.icon !== reloadKey) {
      reload.dataset.icon = reloadKey;
      fill(reload, svg(f.loading ? icons.stop : icons.reload));
      reload.setAttribute('aria-label', `${f.loading ? 'Stop' : 'Reload'}, ${where} page`);
      setTip(reload, f.loading ? 'Stop' : 'Reload', f.loading ? 'Esc' : 'Ctrl+R');
    }
    // A host that is cut ends in a 12 px fade (measured once laid out), at rest and beside the
    // hover x, where it ends 22 px sooner (SplitPill board: the mask whenever the label is wider than
    // the text box, h - 12 - 38 at rest and h - 34 - 38 on hover): class cut, and cut-hover.
    requestAnimationFrame(() => {
      for (const host of item.querySelectorAll<HTMLElement>('.split-face .host')) {
        const half = host.closest('.half') as HTMLElement | null;
        if (!half) continue;
        const range = document.createRange();
        range.selectNodeContents(host);
        const text = range.getBoundingClientRect().width;
        const w = half.getBoundingClientRect().width;
        host.classList.toggle('cut', text > w - HALF_TEXT_REST + 0.5);
        host.classList.toggle('cut-hover', text > w - HALF_TEXT_HOVER + 0.5);
      }
    });
  }

  // ---- dragging the bar moves the window ----

  private watchDrag(): void {
    let dragged = false;
    this.host.addEventListener('mousedown', (e) => {
      this.press = null;
      dragged = false;
      if (e.button !== 0 || window.fullScreen) return;
      const target = e.target as Element;
      if (!target.closest('.item') || target.closest('.close-badge, .half-x, .accessories, input')) return;
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

/**
 * Step 4 of the layout: the units around the active one that fit in `slots` circle slots (a pair
 * in the background takes two), about half before and the rest after, as many as fit.
 */
function nearest(units: Unit[], active: number, slots: number, weight: (u: Unit) => number): Unit[] {
  const take = (from: number, dir: -1 | 1, limit: number): { n: number; used: number } => {
    let n = 0;
    let used = 0;
    for (let i = from + dir; i >= 0 && i < units.length; i += dir) {
      const w = weight(units[i]);
      if (used + w > limit) break;
      used += w;
      n++;
    }
    return { n, used };
  };
  const first = take(active, -1, Math.floor(slots / 2));
  const after = take(active, 1, slots - first.used);
  const before = take(active, -1, slots - after.used);
  return units.slice(active - before.n, active + after.n + 1);
}

function glassLens(item: HTMLElement): HTMLElement {
  return item.querySelector(':scope > .lens') as HTMLElement;
}
