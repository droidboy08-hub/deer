// The background picker, shared by Settings › Home and background and Home's Background popover:
// Photo / Video / None tabs over a grid of tiles. A tile is a radio; choosing one applies it.
import { fileUrl, type HomeBackground, type Tile } from './background';
import { h, uid } from './controls';
import { ico } from './icons';

type Tab = 'photo' | 'video' | 'none';

const TABS: { id: Tab; label: string; group: string }[] = [
  { id: 'photo', label: 'Photo', group: 'Photos' },
  { id: 'video', label: 'Video', group: 'Videos' },
  { id: 'none', label: 'None', group: 'No picture' },
];

export interface Picker {
  el: HTMLElement;
  /** Focus the selected tile (or the tabs when there is none). */
  focus(): void;
}

function tabFor(kind: string): Tab {
  return kind === 'video' ? 'video' : kind === 'none' ? 'none' : 'photo';
}

export function backgroundPicker(bg: HomeBackground, variant: 'panel' | 'popover'): Picker {
  const thumbWidth = variant === 'panel' ? 420 : 320;
  const columns = variant === 'panel' ? 3 : 2;
  const panelId = uid('hb-panel');
  let tab: Tab = tabFor(bg.current().kind);
  let tiles: HTMLElement[] = [];
  let build = 0;

  const tabButtons = TABS.map((t) =>
    h('button', { type: 'button', role: 'tab', id: uid('hb-tab'), class: 'vs-seg-btn', 'aria-controls': panelId, 'data-tab': t.id, 'data-label': t.label, text: t.label }),
  );
  const tabList = h('div', { class: 'vs-seg hb-tabs', role: 'tablist', 'aria-label': 'Background' }, ...tabButtons);
  const grid = h('div', { class: `hb-grid cols-${columns}`, role: 'radiogroup' });
  const note = h('p', { class: 'hb-note', role: 'status' });
  const panel = h('div', { class: 'hb-panel', role: 'tabpanel', id: panelId }, grid, note);
  const el = h('div', { class: `hb-picker hb-${variant}` }, tabList, panel);

  const isCurrent = (t: Tile) => {
    const cur = bg.current();
    if (t.kind !== cur.kind) return false;
    return t.kind === 'windows' || t.kind === 'none' || t.path.toLowerCase() === cur.path.toLowerCase();
  };

  const paintChecks = () => {
    for (const tile of tiles) {
      const on = tile.dataset.current === 'true';
      tile.setAttribute('aria-checked', String(on));
    }
    const sel = tiles.find((t) => t.getAttribute('aria-checked') === 'true') ?? tiles[0];
    for (const t of tiles) t.tabIndex = t === sel ? 0 : -1;
  };

  const tileEl = (t: Tile): HTMLElement => {
    const face = h('span', { class: `hb-face${t.kind === 'none' ? ' hb-plain' : ''}` });
    const btn = h(
      'button',
      { type: 'button', role: 'radio', class: 'hb-tile', 'aria-label': t.label, title: variant === 'popover' ? t.label : undefined },
      face,
      h('span', { class: 'hb-badge', html: ico.check, 'aria-hidden': 'true' }),
      variant === 'panel' ? h('span', { class: 'hb-cap', text: t.label, 'aria-hidden': 'true' }) : null,
    );
    btn.dataset.current = String(isCurrent(t));
    btn.addEventListener('click', () => choose(btn, t));
    if (t.kind !== 'none' && t.path) fillFace(face, t);
    return btn;
  };

  const fillFace = async (face: HTMLElement, t: Tile) => {
    const url = await bg.thumb(t.path, thumbWidth);
    if (url) {
      face.append(h('img', { src: url, alt: '', draggable: 'false' }));
      return;
    }
    // Windows has no thumbnail for this file: show the picture itself, or the video's first frame.
    let media: HTMLImageElement | HTMLVideoElement;
    if (t.kind === 'video') {
      media = h('video', { muted: '', preload: 'metadata', 'aria-hidden': 'true', tabindex: '-1' });
      media.muted = true;
      media.src = `${fileUrl(t.path)}#t=0.5`;
    } else {
      media = h('img', { src: fileUrl(t.path), alt: '', draggable: 'false', loading: 'lazy' });
    }
    // A file that is gone leaves a plain face, never a broken-image glyph.
    media.addEventListener('error', () => media.remove(), { once: true });
    face.append(media);
  };

  const choose = (btn: HTMLElement, t: Tile) => {
    for (const x of tiles) x.dataset.current = String(x === btn);
    paintChecks();
    btn.focus();
    bg.choose(t.kind === 'windows' || t.kind === 'none' ? { kind: t.kind, path: '' } : { kind: t.kind, path: t.path });
  };

  const render = async () => {
    const mine = ++build;
    for (const b of tabButtons) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const active = tabButtons.find((b) => b.dataset.tab === tab);
    if (active) panel.setAttribute('aria-labelledby', active.id);
    grid.setAttribute('aria-label', TABS.find((t) => t.id === tab)?.group ?? 'Backgrounds');
    const list: Tile[] = tab === 'none' ? [{ kind: 'none', path: '', label: 'No picture' }] : (await bg.tiles(tab)).filter((t) => t.kind !== 'windows' || t.path);
    if (mine !== build) return;
    const key = `${tab}:${list.map((t) => `${t.kind}|${t.path}`).join('\n')}`;
    if (key === shownKey) {
      // Same tiles: only the check moves, so focus and loaded thumbnails stay put.
      list.forEach((t, i) => (tiles[i].dataset.current = String(isCurrent(t))));
    } else {
      const hadFocus = grid.contains(document.activeElement);
      shownKey = key;
      tiles = list.map(tileEl);
      grid.replaceChildren(...tiles);
      grid.hidden = !tiles.length;
      paintChecks();
      if (hadFocus) tiles.find((t) => t.tabIndex === 0)?.focus();
    }
    paintChecks();
    paintNote();
  };
  let shownKey = '';

  const paintNote = () => {
    const empty = tab === 'video' && !tiles.length;
    note.textContent = bg.error ?? (empty ? 'Add a video to play it behind Home. It plays muted and loops.' : tab === 'none' ? 'Home shows a plain dark background.' : '');
    note.classList.toggle('error', !!bg.error);
    note.hidden = !note.textContent;
  };

  const selectTab = (t: Tab, focus: boolean) => {
    tab = t;
    void render();
    if (focus) tabButtons.find((b) => b.dataset.tab === t)?.focus();
  };

  for (const b of tabButtons) b.addEventListener('click', () => selectTab(b.dataset.tab as Tab, false));
  tabList.addEventListener('keydown', (e) => {
    const i = tabButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    selectTab(TABS[(j + TABS.length) % TABS.length].id, true);
  });
  grid.addEventListener('keydown', (e) => {
    const i = tiles.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const n = tiles.length;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key];
    let j = step === undefined ? undefined : Math.max(0, Math.min(n - 1, i + step));
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = n - 1;
    if (j === undefined) return;
    e.preventDefault();
    for (const t of tiles) t.tabIndex = -1;
    tiles[j].tabIndex = 0;
    tiles[j].focus();
  });

  // Follow changes made elsewhere (the other picker, the file dialog, a file that won't open).
  let attached = false;
  requestAnimationFrame(() => (attached = el.isConnected));
  const off = bg.onChange(() => {
    if (attached && !el.isConnected) {
      off();
      return;
    }
    tab = tabFor(bg.current().kind);
    void render();
  });

  const first = render();
  return {
    el,
    focus: () => void first.then(() => (tiles.find((t) => t.tabIndex === 0) ?? tabButtons.find((b) => b.tabIndex === 0))?.focus()),
  };
}
