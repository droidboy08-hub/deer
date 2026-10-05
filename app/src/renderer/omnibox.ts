// Address and search: the pill opens into a 640×48 field with a suggestion panel under it.
// Enter goes; Alt+Enter opens a new tab; Esc first puts the address back, then closes.
import { lens } from './glass';
import { icons } from './icons';
import type { Tab } from './model';
import { displayHost, looksLikeAddress, resolveInput, searchUrl, stripUrl } from './url';

const FIELD_W = 640;
const FIELD_H = 48;

export interface OmniHandlers {
  go(url: string, where: 'here' | 'newTab'): void;
  switchTo(id: number): void;
  tabs(): Tab[];
  activeId(): number;
  closed(): void;
}

interface Row {
  kind: 'switch' | 'history' | 'search' | 'url';
  title: string;
  detail: string;
  url: string;
  tabId?: number;
  removable?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export class Omnibox {
  private root = document.getElementById('omnibox') as HTMLElement;
  private field = document.getElementById('omni-field') as HTMLElement;
  private panel = document.getElementById('omni-panel') as HTMLElement;
  private input = document.getElementById('omni-input') as HTMLInputElement;
  private list = document.getElementById('omni-list') as HTMLElement;
  private rows: Row[] = [];
  private sel = 0;
  private moved = false;
  private original = '';
  private queryToken = 0;
  open = false;

  constructor(private h: OmniHandlers) {
    (this.field.querySelector('.omni-icon') as HTMLElement).innerHTML = icons.search;
    this.input.addEventListener('input', () => {
      this.moved = false;
      this.refresh();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => {
      // Clicking a row keeps focus logic in mousedown; a real blur closes.
      setTimeout(() => {
        if (this.open && document.activeElement !== this.input) this.close();
      }, 0);
    });
    this.list.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest('.omni-item') as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      this.sel = Number(row.dataset.i);
      this.choose(e.altKey || e.button === 1 ? 'newTab' : 'here');
    });
    this.list.addEventListener('mousemove', (e) => {
      const row = (e.target as HTMLElement).closest('.omni-item') as HTMLElement | null;
      if (row && Number(row.dataset.i) !== this.sel) {
        this.sel = Number(row.dataset.i);
        this.moved = true;
        this.paintSelection();
      }
    });
  }

  show(from: DOMRect | null, tab: Tab | undefined, opts: { query?: string } = {}): void {
    const W = window.innerWidth;
    const fw = Math.min(FIELD_W, W - 48);
    const left = Math.round((W - fw) / 2);
    this.original = tab && tab.kind === 'web' ? tab.url : '';
    this.input.value = opts.query ?? this.original;
    this.root.hidden = false;
    this.open = true;
    document.body.classList.add('omni-open');
    (this.field.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(fw, FIELD_H);
    this.panel.style.left = `${left}px`;
    this.panel.style.width = `${fw}px`;

    // Grow out of the pill: 240 ms on the expand curve.
    const start = from ?? new DOMRect(left, 12, fw, FIELD_H);
    this.field.style.transition = 'none';
    this.field.style.left = `${start.x}px`;
    this.field.style.top = `${start.y}px`;
    this.field.style.width = `${start.width}px`;
    this.field.style.height = `${start.height}px`;
    this.field.getBoundingClientRect();
    this.field.style.transition = '';
    this.field.style.left = `${left}px`;
    this.field.style.top = '12px';
    this.field.style.width = `${fw}px`;
    this.field.style.height = `${FIELD_H}px`;

    this.input.focus();
    this.input.select();
    this.moved = false;
    this.refresh();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('omni-open');
    this.h.closed();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.rows.length) return;
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : this.rows.length - 1)) % this.rows.length;
      this.moved = true;
      this.paintSelection();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey && !e.altKey && !/\s/.test(this.input.value.trim()) && !this.input.value.includes('.')) {
        this.h.go(`https://www.${this.input.value.trim()}.com`, 'here');
        this.close();
        return;
      }
      this.choose(e.altKey && !e.ctrlKey ? 'newTab' : 'here');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.input.value !== this.original) {
        this.input.value = this.original;
        this.input.select();
        this.refresh();
      } else {
        this.close();
      }
      return;
    }
    if (e.key === 'Delete' && e.shiftKey && this.moved) {
      const row = this.rows[this.sel];
      if (row?.removable) {
        e.preventDefault();
        window.vitre.history.remove(row.url).then(() => this.refresh());
      }
    }
  }

  private choose(where: 'here' | 'newTab'): void {
    const row = this.rows[this.sel];
    const text = this.input.value;
    if (row?.kind === 'switch' && row.tabId !== undefined && where === 'here') {
      this.h.switchTo(row.tabId);
    } else if (row) {
      this.h.go(row.url, where);
    } else if (text.trim()) {
      this.h.go(resolveInput(text), where);
    }
    this.close();
  }

  private async refresh(): Promise<void> {
    const text = this.input.value.trim();
    const token = ++this.queryToken;
    const rows: Row[] = [];
    if (text && text !== this.original) {
      const url = resolveInput(text);
      rows.push(looksLikeAddress(text)
        ? { kind: 'url', title: stripUrl(url), detail: 'Go to address', url }
        : { kind: 'search', title: text, detail: 'Search', url: searchUrl(text) });
    }
    const q = text === this.original ? '' : text.toLowerCase();
    const active = this.h.activeId();
    for (const t of this.h.tabs()) {
      if (t.kind !== 'web' || t.id === active || !q) continue;
      if (t.url.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)) {
        rows.push({ kind: 'switch', title: t.title || displayHost(t.url), detail: displayHost(t.url), url: t.url, tabId: t.id });
      }
      if (rows.length >= 3) break;
    }
    const hist = await window.vitre.history.query(q, 6);
    if (token !== this.queryToken) return;
    const have = new Set(rows.map((r) => r.url));
    for (const e of hist) {
      if (have.has(e.url) || e.url === this.original) continue;
      rows.push({ kind: 'history', title: e.title || stripUrl(e.url), detail: stripUrl(e.url), url: e.url, removable: true });
      if (rows.length >= 7) break;
    }
    if (text && !looksLikeAddress(text) && rows[0]?.kind !== 'search') rows.push({ kind: 'search', title: text, detail: 'Search', url: searchUrl(text) });
    this.rows = rows;
    this.sel = 0;
    this.renderRows();
  }

  private renderRows(): void {
    const html: string[] = [];
    let lastGroup = '';
    this.rows.forEach((r, i) => {
      const group = r.kind === 'history' ? 'History' : r.kind === 'switch' ? 'Open tabs' : '';
      if (group && group !== lastGroup) html.push(`<div class="omni-group">${group}</div>`);
      lastGroup = group;
      const icon = r.kind === 'search' ? icons.search : r.kind === 'history' ? icons.history : icons.globe;
      const tail = r.kind === 'switch' ? `<span class="omni-tail">Switch to tab ${icons.switchTab}</span>` : '';
      html.push(`<div class="omni-item" role="option" data-i="${i}" id="omni-${i}"><span class="omni-glyph">${icon}</span><span class="omni-title">${esc(r.title)}</span><span class="omni-detail">${esc(r.detail)}</span>${tail}</div>`);
    });
    this.list.innerHTML = html.join('');
    this.panel.hidden = this.rows.length === 0;
    this.paintSelection();
  }

  private paintSelection(): void {
    for (const el of this.list.querySelectorAll('.omni-item')) {
      const on = Number((el as HTMLElement).dataset.i) === this.sel;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', String(on));
    }
    this.input.setAttribute('aria-activedescendant', `omni-${this.sel}`);
  }
}
