// Strip (Settings > Tabs): a compact frosted panel of 192x120 cards centred over the dimmed page
// (TabSwitcherStrip board: panel 1080x212 at (180,344), radius 24, tint rgba(20,20,24,0.58), cards
// 16 px apart with 28 px padding, label 10 px under the card, page dimmed by rgba(8,8,12,0.22)).
// Latched, the search field appears above it (SwitcherKeys). Ported from
// app/src/renderer/modules/switcher/strip.ts.
// Material: the panel and its field are frost (CSS blur 18 / 6 and saturate 1.5, the Electron lens's
// blur and saturation) without the strip-lens refraction. On Gecko the SVG strip lens (glass.ts
// lens()) with these blurs rendered the raw, unblurred page in 3 of the first 6 runs over real pages
// (no error, intermittent; over a static page it always worked), while CSS blur never failed: at a
// blur this heavy the edge refraction is not visible anyway.
import type { Tab } from '../../model';
import { cardAt, cardName, el, EXPAND, fadeLayers, favicon, flight, glassBox, labelChanged, labelParts, Media, nextCard, optionId, play, reducedMotion, settle, SPRING } from './parts';
import type { Model, View, ViewHandlers } from './types';

const CW = 192;
const CH = 120;
const GAP = 16;
const PAD = 28;
const PANEL_H = 212;
const CARD_TOP = 32;
const SIDE = 48;
const FIELD_W = 480;
const FIELD_MIN = 320;
const FIELD_H = 44;
const FIELD_GAP = 12;
const DROP_MS = 220;
const PANEL_FROST = 'blur(18px) saturate(1.5)';
const FIELD_FROST = 'blur(6px) saturate(1.5)';

interface Card {
  el: HTMLElement;
  inner: HTMLElement;
  face: HTMLElement;
  media: Media;
  label: HTMLElement;
}

export class StripView implements View {
  readonly root = el('sw-view sw-strip');
  private bg = el('sw-bg');
  private field = glassBox('sw-sfield');
  private panel = glassBox('sw-panel');
  private clip = el('sw-sclip');
  private row = el('sw-srow');
  private cards = new Map<number, Card>();
  private closingIds = new Set<number>();
  private panelW = 0;
  private paintedQuery = '';
  private shift = 0;

  constructor(private m: Model, private h: ViewHandlers) {
    this.row.id = 'sw-list';
    this.row.setAttribute('role', 'listbox');
    this.row.setAttribute('aria-label', 'Tabs');
    this.clip.append(this.row);
    this.panel.append(this.clip);
    this.root.append(this.bg, this.panel, this.field);
    (this.panel.querySelector('.lens') as HTMLElement).style.backdropFilter = PANEL_FROST;
    (this.field.querySelector('.lens') as HTMLElement).style.backdropFilter = FIELD_FROST;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('auxclick', (e) => {
      const id = e.button === 1 ? cardAt(e, '.sw-scard') : null;
      if (id !== null) this.h.close(id);
    });
  }

  mount(fieldRow: HTMLElement): void {
    this.field.append(fieldRow);
  }

  enter(): void {
    settle(this.root, () => this.update());
    if (reducedMotion()) {
      this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
      return;
    }
    play(this.bg, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' });
    play(this.panel, [{ transform: 'scale(0.96)' }, { transform: 'none' }], { duration: 320, easing: SPRING });
    fadeLayers(this.panel, 0, 1, { duration: 320, easing: SPRING });
  }

  update(): void {
    this.syncCards();
    if (this.m.query !== this.paintedQuery) {
      this.paintedQuery = this.m.query;
      for (const [id, c] of this.cards) {
        const t = this.m.tab(id);
        if (t) this.paintLabel(t, c);
      }
    }
    this.place();
  }

  refresh(id: number): void {
    const t = this.m.tab(id);
    const c = this.cards.get(id);
    if (!t || !c) return;
    this.paintLabel(t, c);
    if (this.onScreen(this.m.list.indexOf(id))) this.paintMedia(id, c);
  }

  /** The card's picture, on a canvas sized for the current device scale. */
  private paintMedia(id: number, c: Card): void {
    c.media.size(CW, CH);
    this.m.paint(id, c.media);
  }

  visible(): number[] {
    const sel = Math.max(0, this.m.sel);
    return [...this.m.list.keys()]
      .sort((a, b) => Math.abs(a - sel) - Math.abs(b - sel))
      .filter((i) => this.onScreen(i))
      .map((i) => this.m.list[i]);
  }

  closing(id: number): void {
    this.closingIds.add(id);
  }

  async expand(id: number): Promise<void> {
    this.root.classList.add('sw-expanding');
    const c = this.cards.get(id);
    if (!c || reducedMotion()) return;
    await flight(c.face, this.root, true, 10, 360, EXPAND);
  }

  layout(): void {
    this.place();
  }

  columns(): number {
    return 1;
  }

  private syncCards(): void {
    const want = new Set(this.m.list);
    for (const [id, c] of this.cards) if (!want.has(id)) this.drop(id, c);
    this.m.list.forEach((id, i) => {
      if (this.cards.has(id)) return;
      const t = this.m.tab(id);
      if (!t) return;
      const c = this.makeCard(t, nextCard(this.m.list, i, this.cards));
      this.cards.set(id, c);
      c.el.style.transform = `translate(${this.x(i)}px, ${CARD_TOP}px)`;
    });
  }

  private makeCard(t: Tab, before: HTMLElement | null): Card {
    const card = el('sw-scard');
    card.id = optionId(t.id);
    card.dataset.id = String(t.id);
    card.setAttribute('role', 'option');
    const inner = el('sw-sin');
    const face = el('sw-sface');
    const media = new Media(18);
    media.size(CW, CH);
    face.append(media.root, el('sw-rim', 'span'));
    const label = el('sw-slabel');
    label.setAttribute('aria-hidden', 'true');
    inner.append(face, label);
    card.append(inner);
    this.row.insertBefore(card, before);
    const c: Card = { el: card, inner, face, media, label };
    this.paintLabel(t, c);
    return c;
  }

  private paintLabel(t: Tab, c: Card): void {
    if (!labelChanged(c.label, t, this.m)) return;
    const title = el('t', 'span');
    title.append(labelParts(t, this.m).title);
    c.label.replaceChildren(favicon(t, 14), title);
    c.el.setAttribute('aria-label', cardName(t, this.m));
  }

  private drop(id: number, c: Card): void {
    this.cards.delete(id);
    c.el.removeAttribute('id');
    c.el.removeAttribute('role');
    c.el.style.pointerEvents = 'none';
    const lift = this.closingIds.delete(id);
    const anim = play(c.inner, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: lift ? 'translateY(-12px)' : 'none' }], { duration: DROP_MS, easing: SPRING, fill: 'forwards' });
    if (anim) void anim.finished.catch(() => undefined).then(() => c.el.remove());
    else c.el.remove();
  }

  private x(i: number): number {
    return PAD + i * (CW + GAP);
  }

  private onScreen(i: number): boolean {
    if (i < 0) return false;
    const left = this.x(i) + this.shift;
    return left + CW >= -CW && left <= this.panelW + CW;
  }

  private place(): void {
    const W = this.root.clientWidth || window.innerWidth;
    const H = this.root.clientHeight || window.innerHeight;
    const n = this.m.list.length;
    const content = this.x(n) - GAP + PAD;
    const width = Math.max(PAD * 2 + CW, Math.min(content, W - 2 * SIDE));
    const left = Math.round((W - width) / 2);
    const top = Math.round((H - PANEL_H) / 2);
    Object.assign(this.panel.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
    this.panelW = width;

    const selId = this.m.list[this.m.sel];
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (!c) return;
      c.el.style.transform = `translate(${this.x(i)}px, ${CARD_TOP}px)`;
      c.el.classList.toggle('sel', id === selId);
      c.el.setAttribute('aria-selected', String(id === selId));
    });
    // More cards than fit: keep the selected one in view, centred where possible.
    const centre = this.x(Math.max(0, this.m.sel)) + CW / 2;
    this.shift = content > width ? Math.max(width - content, Math.min(0, width / 2 - centre)) : 0;
    this.row.style.transform = `translateX(${this.shift}px)`;
    const fw = Math.round(Math.min(FIELD_W, W - 32, Math.max(FIELD_MIN, width)));
    Object.assign(this.field.style, { left: `${Math.round((W - fw) / 2)}px`, top: `${top - FIELD_GAP - FIELD_H}px`, width: `${fw}px` });
    this.root.classList.toggle('latched', this.m.latched);
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (c && this.onScreen(i)) this.paintMedia(id, c);
    });
  }

  private onClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    const id = cardAt(e, '.sw-scard');
    if (id !== null) {
      this.h.open(id);
      return;
    }
    const target = e.target as Element;
    if (target.closest('.sw-panel') || target.closest('.sw-sfield')) return;
    this.h.cancel();
  }
}
