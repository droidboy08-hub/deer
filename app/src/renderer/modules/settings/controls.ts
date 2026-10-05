// Windows 11 style controls for the Settings panel: cards, rows, switches, segmented
// controls, drop-downs, buttons, check boxes and radio rows. Each control paints itself from
// the settings through ctx.bind, so every copy on screen stays in step with the store.
import type { Browser } from '../../app';
import type { Settings } from '../../../shared/settings';
import type { HomeBackground } from './background';
import { ico } from './icons';

export type SectionId = 'general' | 'appearance' | 'home' | 'tabs' | 'downloads' | 'privacy' | 'search' | 'shortcuts' | 'about';

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

export interface ListboxHost {
  open(anchor: HTMLElement, options: Option[], selected: string, pick: (value: string) => void): void;
}

export interface Ctx {
  b: Browser;
  bg: HomeBackground;
  s(): Settings;
  set(patch: Partial<Settings>): void;
  /** Runs now and on every settings change while this view is on screen; returns a way to stop. */
  bind(fn: (s: Settings) => void): () => void;
  listbox: ListboxHost;
  go(section: SectionId, focus?: string): void;
}

/** One searchable entry on a page: a row, or a block such as the switcher style picker. */
export interface RowDef {
  title: string;
  desc?: string;
  /** Extra words "Find a setting" matches, such as the keys of a shortcut. */
  keywords?: string;
  /** Keys, matched without spaces or plus signs ("ctrl+q" finds Ctrl+Q). */
  keys?: string;
  /** Leave out of search results (General repeats rows that live elsewhere). */
  unlisted?: boolean;
  build(ctx: Ctx): HTMLElement;
}

export interface GroupDef {
  title?: string;
  /** Anchor for opening Settings at this group (Ctrl+Shift+Delete → 'clear'). */
  anchor?: string;
  rows: RowDef[];
}

export interface SectionDef {
  id: SectionId;
  title: string;
  icon: string;
  /** Replaces the plain page title (Keyboard shortcuts has a Reset button beside it). */
  header?(ctx: Ctx): HTMLElement;
  intro?: string;
  groups(ctx: Ctx): GroupDef[];
}

// ---- DOM helper ----

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

let seq = 0;
export const uid = (prefix: string) => `${prefix}-${++seq}`;

// ---- layout ----

export interface RowOpts {
  icon?: string;
  title: string;
  desc?: string;
  /** Builds the control, given the ids of the title and description for labelling. */
  control?: (ids: { title: string; desc: string }) => Node | null;
  class?: string;
}

export function row(o: RowOpts): HTMLElement {
  const ids = { title: uid('vs-t'), desc: uid('vs-d') };
  const text = h('div', { class: 'vs-text' }, h('span', { class: 'vs-title', id: ids.title, text: o.title }), o.desc ? h('span', { class: 'vs-desc', id: ids.desc, text: o.desc }) : null);
  return h('div', { class: `vs-row${o.icon ? ' has-ico' : ''}${o.class ? ` ${o.class}` : ''}` }, o.icon ? h('span', { class: 'vs-ico', html: o.icon }) : null, text, o.control?.(ids) ?? null);
}

/** A row's description that follows the settings. */
export function liveDesc(ctx: Ctx, el: HTMLElement, text: (s: Settings) => string): void {
  const d = el.querySelector('.vs-desc');
  if (d) ctx.bind((s) => (d.textContent = text(s)));
}

export function card(...rows: Node[]): HTMLElement {
  return h('div', { class: 'vs-card' }, ...rows);
}

export function heading(text: string, id?: string): HTMLElement {
  return h('h2', { class: 'vs-h2', id, text });
}

// ---- controls ----

export function toggle(ctx: Ctx, o: { labelledBy: string; describedBy?: string; get(s: Settings): boolean; set(v: boolean): void }): HTMLElement {
  const state = h('span', { class: 'vs-state', 'aria-hidden': 'true' });
  const btn = h('button', { type: 'button', class: 'vs-switch', role: 'switch', 'aria-labelledby': o.labelledBy, 'aria-describedby': o.describedBy }, h('span', { class: 'vs-knob' }));
  const paint = (v: boolean) => {
    btn.setAttribute('aria-checked', String(v));
    state.textContent = v ? 'On' : 'Off';
  };
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('aria-checked') !== 'true';
    paint(v);
    o.set(v);
  });
  state.addEventListener('click', () => btn.click());
  ctx.bind((s) => paint(o.get(s)));
  return h('div', { class: 'vs-toggle' }, state, btn);
}

/** Radio buttons in a row (Windows' segmented control). Arrows move and choose. */
export function segmented<T extends string>(ctx: Ctx | null, o: { labelledBy?: string; label?: string; options: Option<T>[]; get(s: Settings): T; set(v: T): void; class?: string }): HTMLElement {
  const group = h('div', { class: `vs-seg${o.class ? ` ${o.class}` : ''}`, role: 'radiogroup', 'aria-labelledby': o.labelledBy, 'aria-label': o.label });
  const buttons = o.options.map((opt) => h('button', { type: 'button', role: 'radio', class: 'vs-seg-btn', 'data-value': opt.value, 'data-label': opt.label, text: opt.label }));
  group.append(...buttons);
  const paint = (v: string) => {
    for (const btn of buttons) {
      const on = btn.dataset.value === v;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (btn: HTMLButtonElement, focus: boolean) => {
    paint(btn.dataset.value as string);
    if (focus) btn.focus();
    o.set(btn.dataset.value as T);
  };
  for (const btn of buttons) btn.addEventListener('click', () => choose(btn, false));
  group.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = buttons.length;
    const j = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: n - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    choose(buttons[(j + n) % n], true);
  });
  if (ctx) ctx.bind((s) => paint(o.get(s)));
  return group;
}

/** A Windows ComboBox: the value and a chevron; the list opens in the panel's popup layer. */
export function dropdown<T extends string>(ctx: Ctx, o: { labelledBy: string; options: Option<T>[] | ((s: Settings) => Option<T>[]); get(s: Settings): T; set(v: T): void }): HTMLElement {
  const id = uid('vs-dd');
  const label = h('span', { class: 'vs-dd-label' });
  const btn = h('button', { type: 'button', class: 'vs-dd', id, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-labelledby': `${o.labelledBy} ${id}` }, label, h('span', { class: 'vs-dd-chev', html: ico.chevronDown }));
  let value = '' as T;
  const options = (): Option<T>[] => (typeof o.options === 'function' ? o.options(ctx.s()) : o.options);
  const paint = (v: T) => {
    value = v;
    label.textContent = options().find((x) => x.value === v)?.label ?? String(v);
  };
  const pick = (v: string) => {
    if (v === value) return;
    paint(v as T);
    o.set(v as T);
  };
  btn.addEventListener('click', () => ctx.listbox.open(btn, options(), value, pick));
  btn.addEventListener('keydown', (e) => {
    const list = options();
    const i = list.findIndex((x) => x.value === value);
    if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
      e.preventDefault();
      ctx.listbox.open(btn, list, value, pick);
    } else if (!e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // As in Windows: arrows on a closed box step through the choices.
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) pick(next.value);
    }
  });
  ctx.bind((s) => paint(o.get(s)));
  return btn;
}

export function button(text: string, onClick: (e: MouseEvent) => void, o: { accent?: boolean; describedBy?: string; label?: string } = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: `vs-btn${o.accent ? ' accent' : ''}`, text, onclick: onClick, 'aria-describedby': o.describedBy, 'aria-label': o.label });
}

/** A row whose leading icon is a check box; clicking anywhere on the row toggles it. */
export function checkRow(o: { title: string; desc?: string; checked: boolean; onChange(v: boolean): void }): HTMLElement {
  let box!: HTMLElement;
  const el = row({
    title: o.title,
    desc: o.desc,
    class: 'vs-pickrow has-ico',
    control: (ids) => {
      box = h('span', { class: 'vs-check', role: 'checkbox', tabindex: '0', 'aria-labelledby': ids.title, 'aria-describedby': o.desc ? ids.desc : undefined, html: ico.checkSmall });
      return null;
    },
  });
  el.prepend(box);
  const set = (v: boolean) => {
    box.setAttribute('aria-checked', String(v));
    o.onChange(v);
  };
  box.setAttribute('aria-checked', String(o.checked));
  el.addEventListener('click', () => {
    set(box.getAttribute('aria-checked') !== 'true');
    box.focus();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      set(box.getAttribute('aria-checked') !== 'true');
    }
  });
  return el;
}

/** Radio rows inside one card, with a radio circle in the icon column. */
export function radioRows<T extends string>(ctx: Ctx, o: { label: string; options: (Option<T> & { desc?: string })[]; get(s: Settings): T; set(v: T): void }): HTMLElement {
  const group = h('div', { class: 'vs-card', role: 'radiogroup', 'aria-label': o.label });
  const radios: HTMLElement[] = [];
  for (const opt of o.options) {
    let dot!: HTMLElement;
    const el = row({
      title: opt.label,
      desc: opt.desc,
      class: 'vs-pickrow has-ico',
      control: (ids) => {
        dot = h('span', { class: 'vs-radio', role: 'radio', 'data-value': opt.value, 'aria-labelledby': ids.title, 'aria-describedby': opt.desc ? ids.desc : undefined });
        return null;
      },
    });
    el.prepend(dot);
    el.addEventListener('click', () => choose(dot, true));
    radios.push(dot);
    group.append(el);
  }
  const paint = (v: string) => {
    for (const r of radios) {
      const on = r.dataset.value === v;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (r: HTMLElement, focus: boolean) => {
    paint(r.dataset.value as string);
    if (focus) r.focus();
    o.set(r.dataset.value as T);
  };
  group.addEventListener('keydown', (e) => {
    const i = radios.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const n = radios.length;
    const j = { ArrowUp: i - 1, ArrowLeft: i - 1, ArrowDown: i + 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
    if (e.key === ' ') {
      e.preventDefault();
      choose(radios[i], true);
      return;
    }
    if (j === undefined) return;
    e.preventDefault();
    choose(radios[(j + n) % n], true);
  });
  ctx.bind((s) => paint(o.get(s)));
  return group;
}
