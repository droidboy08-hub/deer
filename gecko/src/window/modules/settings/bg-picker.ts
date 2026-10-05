// The background picker, shared by Settings › Home and background and Home's Background popover:
// Photo / Video / None tabs over a grid of tiles. A tile is a radio; choosing one applies it.
// Ported from app/src/renderer/modules/settings/bg-picker.ts. Gecko: tile faces are the files
// themselves (<img> / <video> on a file: URL; browser.xhtml's CSP leaves img-src and media-src
// open, and Gecko decodes an image at the size it is drawn), no thumbnail service.
import type { HomeBackground, Tile } from './background';
import { h, uid } from './controls';
import { fileURL } from './gecko';
import { ico, icon } from './icons';

type Tab = 'photo' | 'video' | 'none';

const TABS: { id: Tab; label: string; group: string }[] = [
  { id: 'photo', label: 'Photo', group: 'Photos' },
  { id: 'video', label: 'Video', group: 'Videos' },
  { id: 'none', label: 'None', group: 'No picture' },
];

export interface Picker {
  el: HTMLElement;
  /** The Photo / Video / None tabs (Settings puts them in the row's control column). */
  tabs: HTMLElement;
  /** Focus the selected tile (or the tabs when there is none). */
  focus(): void;
  /** Stop following the background (the view went away). */
  dispose(): void;
}

function tabFor(kind: string): Tab {
  return kind === 'video' ? 'video' : kind === 'none' ? 'none' : 'photo';
}

export function backgroundPicker(bg: HomeBackground, variant: 'panel' | 'popover'): Picker {
  const columns = variant === 'panel' ? 3 : 2;
  const panelId = uid('hb-panel');
  let tab: Tab = tabFor(bg.current().kind);
  let tiles: HTMLElement[] = [];
  let build = 0;
  let shownKey = '';

  const tabButtons = TABS.map((t) =>
    h('button', { type: 'button', role: 'tab', id: uid('hb-tab'), class: 'vs-seg-btn', 'aria-controls': panelId, 'data-tab': t.id, 'data-label': t.label, text: t.label }),
  );
  const tabList = h('div', { class: 'vs-seg hb-tabs', role: 'tablist', 'aria-label': 'Background' }, ...tabButtons);
  const grid = h('div', { class: `hb-grid cols-${columns}`, role: 'radiogroup' });
  const note = h('p', { class: 'hb-note', role: 'status' });
  const panel = h('div', { class: 'hb-panel', role: 'tabpanel', id: panelId }, grid, note);
  const el = h('div', { class: `hb-picker hb-${variant}` }, ...(variant === 'popover' ? [tabList] : []), panel);

  const isCurrent = (t: Tile): boolean => {
    const cur = bg.current();
    if (t.kind !== cur.kind) return false;
    return t.kind === 'windows' || t.kind === 'none' || t.path.toLowerCase() === cur.path.toLowerCase();
  };

  const paintChecks = (): void => {
    for (const tile of tiles) tile.setAttribute('aria-checked', String(tile.dataset.current === 'true'));
    const sel = tiles.find((t) => t.getAttribute('aria-checked') === 'true') ?? tiles[0];
    for (const t of tiles) t.tabIndex = t === sel ? 0 : -1;
  };

  const fillFace = (face: HTMLElement, t: Tile): void => {
    const url = fileURL(t.path);
    if (!url) return;
    let media: HTMLImageElement | HTMLVideoElement;
    if (t.kind === 'video') {
      const v = h('video', { preload: 'metadata', 'aria-hidden': 'true', tabindex: '-1' });
      v.muted = true;
      v.src = `${url}#t=0.5`;
      media = v;
    } else {
      const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
      img.src = url;
      media = img;
    }
    // A file that is gone leaves a plain face, never a broken-image glyph.
    media.addEventListener('error', () => media.remove(), { once: true });
    face.append(media);
  };

  const tileEl = (t: Tile): HTMLElement => {
    const face = h('span', { class: `hb-face${t.kind === 'none' ? ' hb-plain' : ''}` });
    const btn = h(
      'button',
      { type: 'button', role: 'radio', class: 'hb-tile', 'aria-label': t.label, 'data-kind': t.kind, 'data-path': t.path },
      face,
      h('span', { class: 'hb-badge', 'aria-hidden': 'true' }, icon(ico.check)),
      variant === 'panel' ? h('span', { class: 'hb-cap', text: t.label, 'aria-hidden': 'true' }) : null,
    );
    btn.dataset.current = String(isCurrent(t));
    btn.addEventListener('click', () => choose(btn, t));
    if (t.kind !== 'none' && t.path) fillFace(face, t);
    return btn;
  };

  const choose = (btn: HTMLElement, t: Tile): void => {
    for (const x of tiles) x.dataset.current = String(x === btn);
    paintChecks();
    btn.focus();
    void bg.chooseTile(t);
  };

  const paintNote = (): void => {
    const error = bg.error ?? bg.homeError();
    const empty = tab === 'video' && !tiles.length;
    note.textContent = error ?? (empty ? 'Add a video to play it behind Home. It plays muted and loops.' : tab === 'none' ? 'Home shows a plain dark background.' : '');
    note.classList.toggle('error', !!error);
    note.hidden = !note.textContent;
  };

  const render = async (): Promise<void> => {
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
      // Same tiles: only the check moves, so focus and loaded faces stay put.
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
    el.dataset.ready = String(build);
  };

  const selectTab = (t: Tab, focus: boolean): void => {
    tab = t;
    void render();
    if (focus) tabButtons.find((b) => b.dataset.tab === t)?.focus();
  };

  for (const b of tabButtons) b.addEventListener('click', () => selectTab(b.dataset.tab as Tab, false));
  tabList.addEventListener('keydown', (e) => {
    const i = tabButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = ({ ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: TABS.length - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    selectTab(TABS[(j + TABS.length) % TABS.length].id, true);
  });
  grid.addEventListener('keydown', (e) => {
    const i = tiles.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const n = tiles.length;
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns } as Record<string, number>)[e.key];
    let j = step === undefined ? undefined : Math.max(0, Math.min(n - 1, i + step));
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = n - 1;
    if (j === undefined) return;
    e.preventDefault();
    for (const t of tiles) t.tabIndex = -1;
    tiles[j].tabIndex = 0;
    tiles[j].focus();
  });

  // Follow changes made elsewhere (the other picker, the file dialog, another window).
  const off = bg.onChange(() => {
    tab = tabFor(bg.current().kind);
    void render();
  });

  const first = render();
  return {
    el,
    tabs: tabList,
    focus: () => void first.then(() => (tiles.find((t) => t.tabIndex === 0) ?? tabButtons.find((b) => b.tabIndex === 0))?.focus()),
    dispose: off,
  };
}
