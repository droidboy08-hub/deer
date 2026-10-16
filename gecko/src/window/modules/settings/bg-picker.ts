// The background picker, shared by Settings › Home and background and Home's Background popover:
// Photo / Video / None tabs over a grid of tiles. A tile is a radio; choosing one applies it.
// Ported from app/src/renderer/modules/settings/bg-picker.ts. Gecko: tile faces are the files
// themselves (<img> / <video> on a file: URL; browser.xhtml's CSP leaves img-src and media-src
// open, and Gecko decodes an image at the size it is drawn), no thumbnail service.
//
// The Photo tab ends with one more group, "Deer wallpapers" (VitreWallpapers: the collection hosted
// on GitHub Pages), under its own caption and radio group, shown only when it has a tile. Its tiles
// look and behave as the others (sizes, check, focus ring, arrows, Home / End); a tile's face is its
// thumbnail (the mean colour until it is in), its name and tooltip give the title and the credit
// ("Photo: <author> · <license>"). Choosing one that is not downloaded yet moves nothing: the tile
// dims and shows a thin progress line while the picture downloads, and the check moves once Home
// has it; another choice meanwhile supersedes it. A download that fails or does not check out
// leaves a short line on the tile ("Couldn’t download this wallpaper.", also said to screen readers)
// and changes nothing. The picker asks for the collection only while its Photo tab is shown
// (VitreWallpapers.watch), and never as one of Find a setting's results (`offline`: it shows what
// this session already has).
import type { WallpaperState, WallpaperTile } from '../../../modules/VitreWallpapers.sys';
import { setTip } from '../../tips';
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

/** What a failed Deer wallpaper's tile says. */
export const WALLPAPER_FAILED = 'Couldn’t download this wallpaper.';

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

/** "Photo: <author> · <license>", or '' when the credit is not known. */
function creditOf(w: WallpaperTile): string {
  return w.author ? `Photo: ${w.author}${w.license ? ` · ${w.license}` : ''}` : '';
}

export function backgroundPicker(bg: HomeBackground, variant: 'panel' | 'popover', opts: { offline?: boolean } = {}): Picker {
  const columns = variant === 'panel' ? 3 : 2;
  const panelId = uid('hb-panel');
  const wp = bg.deerWallpapers();
  let tab: Tab = tabFor(bg.current().kind);
  let tiles: HTMLElement[] = [];
  /** What `tiles` show, in order. */
  let shown: Tile[] = [];
  let deerTiles: HTMLElement[] = [];
  let build = 0;
  let shownKey = '';
  let deerKey = '';
  let unwatch: (() => void) | null = null;
  /**
   * A tile chosen here that HomeBackground has not answered yet (it looks for the file first): it is
   * the one checked meanwhile, whatever repaints come (a download superseded, a thumbnail arriving).
   */
  let picking: { kind: string; path: string } | null = null;
  /** The background the tab last followed ("kind|path"): only a new one moves the tab. */
  let followed = `${bg.current().kind}|${bg.current().path}`;

  const tabButtons = TABS.map((t) =>
    h('button', { type: 'button', role: 'tab', id: uid('hb-tab'), class: 'vs-seg-btn', 'aria-controls': panelId, 'data-tab': t.id, 'data-label': t.label, text: t.label }),
  );
  const tabList = h('div', { class: 'vs-seg hb-tabs', role: 'tablist', 'aria-label': 'Background' }, ...tabButtons);
  const grid = h('div', { class: `hb-grid cols-${columns}`, role: 'radiogroup' });
  const deerTitle = h('p', { class: 'hb-group', id: uid('hb-group'), text: 'Deer wallpapers' });
  const deerGrid = h('div', { class: `hb-grid cols-${columns}`, role: 'radiogroup', 'aria-labelledby': deerTitle.id });
  const deerBox = h('div', { class: 'hb-deer', hidden: true }, deerTitle, deerGrid);
  const note = h('p', { class: 'hb-note', role: 'status' });
  // A failed download, for screen readers (the tile shows it).
  const live = h('p', { class: 'hb-live', role: 'status' });
  const panel = h('div', { class: 'hb-panel', role: 'tabpanel', id: panelId }, grid, deerBox, note, live);
  const el = h('div', { class: `hb-picker hb-${variant}` }, ...(variant === 'popover' ? [tabList] : []), panel);

  const isCurrent = (t: Tile): boolean => {
    const cur = picking ?? bg.current();
    if (t.kind !== cur.kind) return false;
    return t.kind === 'windows' || t.kind === 'none' || t.path.toLowerCase() === cur.path.toLowerCase();
  };

  /**
   * Each group is a radio group of its own: one tab stop, on its checked tile or its first
   * (`keepFocused`: on the tile that has focus, when it is in the group).
   */
  const paintGroup = (group: HTMLElement[], keepFocused = false): void => {
    for (const tile of group) tile.setAttribute('aria-checked', String(tile.dataset.current === 'true'));
    const focused = keepFocused ? group.find((t) => t === document.activeElement) : undefined;
    const sel = focused ?? group.find((t) => t.getAttribute('aria-checked') === 'true') ?? group[0];
    for (const t of group) t.tabIndex = t === sel ? 0 : -1;
  };
  const paintChecks = (): void => {
    paintGroup(tiles);
    paintGroup(deerTiles);
  };
  /**
   * Each tile's check as the background is now, for the repaints Deer wallpapers bring (every
   * thumbnail, ten a second while a picture downloads): a group is painted again only when one of its
   * checks moved, so its tab stop stays where the arrows put it.
   */
  const syncGroup = (group: HTMLElement[], list: Tile[]): void => {
    let moved = false;
    list.forEach((t, i) => {
      const tile = group[i];
      if (!tile) return;
      tile.dataset.current = String(isCurrent(t));
      if (tile.getAttribute('aria-checked') !== tile.dataset.current) moved = true;
    });
    if (moved) paintGroup(group, true);
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
    const w = t.deer;
    const credit = w ? creditOf(w) : '';
    if (w) {
      // Drawn by paintDeer: the veil and progress line while it downloads, the line when it failed.
      face.append(
        h('span', { class: 'hb-veil', 'aria-hidden': 'true' }),
        h('span', { class: 'hb-progress', 'aria-hidden': 'true' }, h('span', { class: 'hb-bar' })),
        h('span', { class: 'hb-fail', 'aria-hidden': 'true', hidden: true, text: WALLPAPER_FAILED }),
      );
    }
    const btn = h(
      'button',
      { type: 'button', role: 'radio', class: 'hb-tile', 'aria-label': credit ? `${t.label}, ${credit}` : t.label, 'data-kind': t.kind, 'data-path': t.path, 'data-id': w?.id },
      face,
      h('span', { class: 'hb-badge', 'aria-hidden': 'true' }, icon(ico.check)),
      variant === 'panel' ? h('span', { class: 'hb-cap', text: t.label, 'aria-hidden': 'true' }) : null,
    );
    if (w) setTip(btn, t.label, credit || undefined);
    btn.dataset.current = String(isCurrent(t));
    btn.addEventListener('click', () => choose(btn, t));
    if (!w && t.kind !== 'none' && t.path) fillFace(face, t);
    return btn;
  };

  const choose = (btn: HTMLElement, t: Tile): void => {
    if (t.deer) {
      // The check stays where it is until the picture is here and Home has it.
      btn.focus();
      void bg.chooseTile(t);
      return;
    }
    picking = { kind: t.kind, path: t.path };
    for (const x of [...tiles, ...deerTiles]) x.dataset.current = String(x === btn);
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

  // ---- Deer wallpapers ----

  /** The collection is asked for only while the Photo tab is shown. */
  const follow = (): void => {
    const want = tab === 'photo' && !!wp && !opts.offline;
    if (want && !unwatch) unwatch = wp!.watch();
    else if (!want && unwatch) {
      unwatch();
      unwatch = null;
    }
  };

  /** A Deer tile as the state says: face, download, failure (touching only what changed). */
  const paintDeer = (btn: HTMLElement, w: WallpaperTile, st: WallpaperState): void => {
    const face = btn.querySelector('.hb-face') as HTMLElement;
    // The thumbnail; a picture no longer listed shows itself; the mean colour until then. A source is
    // tried once per face: one that does not decode (it passed every check and still holds no picture)
    // leaves the colour, and is not tried again on each repaint.
    const src = w.thumb ? fileURL(w.thumb) : !w.listed && w.local ? fileURL(w.path) : '';
    if (face.dataset.src !== src) {
      face.dataset.src = src;
      face.querySelector('img')?.remove();
      if (src) {
        const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
        img.src = src;
        img.addEventListener('error', () => img.remove(), { once: true });
        face.prepend(img);
      }
    }
    if (face.dataset.color !== w.color) {
      face.dataset.color = w.color;
      face.style.backgroundColor = w.color;
    }
    const d = st.downloading?.id === w.id ? st.downloading : null;
    if (d) {
      const p = d.total ? Math.min(1, d.received / d.total) : 0;
      btn.setAttribute('aria-busy', 'true');
      btn.dataset.progress = p.toFixed(3);
      (face.querySelector('.hb-bar') as HTMLElement).style.width = `${(p * 100).toFixed(1)}%`;
    } else if (btn.hasAttribute('aria-busy')) {
      btn.removeAttribute('aria-busy');
      delete btn.dataset.progress;
      (face.querySelector('.hb-bar') as HTMLElement).style.width = '0';
    }
    const failed = st.failed === w.id;
    const line = face.querySelector('.hb-fail') as HTMLElement;
    if (line.hidden === failed) line.hidden = !failed;
    btn.dataset.failed = String(failed);
  };

  const renderDeer = (): void => {
    const st = tab === 'photo' && wp ? wp.state() : null;
    const list = st?.tiles ?? [];
    const key = list.map((w) => `${w.id}|${w.listed}|${w.title}|${w.author}|${w.license}`).join('\n');
    if (key !== deerKey) {
      const was = (document.activeElement as HTMLElement | null)?.dataset?.id;
      const hadFocus = deerGrid.contains(document.activeElement);
      deerKey = key;
      deerTiles = list.map((w) => tileEl({ kind: 'image', path: w.path, label: w.title, deer: w }));
      deerGrid.replaceChildren(...deerTiles);
      paintGroup(deerTiles);
      if (hadFocus) {
        (deerTiles.find((t) => t.dataset.id === was) ?? deerTiles.find((t) => t.tabIndex === 0))?.focus();
        paintGroup(deerTiles, true); // the tab stop where focus came back
      }
    }
    deerBox.hidden = !list.length;
    list.forEach((w, i) => paintDeer(deerTiles[i], w, st!));
    syncGroup(deerTiles, list.map((w) => ({ kind: 'image', path: w.path, label: w.title })));
    // A Deer wallpaper just applied (or one taken off): the other group's check moves at the same
    // moment (its own render waits for its tiles).
    syncGroup(tiles, shown);
    const said = st?.failed && list.some((w) => w.id === st.failed) ? WALLPAPER_FAILED : '';
    if (live.textContent !== said) live.textContent = said;
    el.dataset.deer = String(list.length);
  };

  const render = async (): Promise<void> => {
    const mine = ++build;
    follow();
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
      shown = list;
      list.forEach((t, i) => (tiles[i].dataset.current = String(isCurrent(t))));
    } else {
      const hadFocus = grid.contains(document.activeElement);
      shownKey = key;
      shown = list;
      tiles = list.map(tileEl);
      grid.replaceChildren(...tiles);
      grid.hidden = !tiles.length;
      paintGroup(tiles);
      if (hadFocus) tiles.find((t) => t.tabIndex === 0)?.focus();
    }
    // The check, on the same tiles too: the background may have changed elsewhere (another window,
    // about:config, Browse giving the file first in the recent list already).
    paintGroup(tiles);
    renderDeer();
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
  /** Arrows move focus within a group (Up / Down by a row), Home / End to its ends; nothing is chosen. */
  const gridKeys = (gridEl: HTMLElement, group: () => HTMLElement[]): void => {
    gridEl.addEventListener('keydown', (e) => {
      const list = group();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      const n = list.length;
      const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns } as Record<string, number>)[e.key];
      let j = step === undefined ? undefined : Math.max(0, Math.min(n - 1, i + step));
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = n - 1;
      if (j === undefined) return;
      e.preventDefault();
      for (const t of list) t.tabIndex = -1;
      list[j].tabIndex = 0;
      list[j].focus();
    });
  };
  gridKeys(grid, () => tiles);
  gridKeys(deerGrid, () => deerTiles);

  // Follow changes made elsewhere (the other picker, the file dialog, another window). Only a new
  // background moves the tab: a note coming or going (a file that has gone, a Deer wallpaper chosen)
  // leaves the person where they are.
  const off = bg.onChange(() => {
    picking = null;
    const cur = bg.current();
    if (`${cur.kind}|${cur.path}` !== followed) {
      followed = `${cur.kind}|${cur.path}`;
      tab = tabFor(cur.kind);
    }
    void render();
  });
  // The collection, thumbnails arriving, a download's progress.
  const offDeer = wp?.onChange(renderDeer) ?? ((): void => undefined);

  const first = render();
  return {
    el,
    tabs: tabList,
    focus: () =>
      void first.then(async () => {
        const checked = (): HTMLElement | undefined => [...tiles, ...deerTiles].find((t) => t.getAttribute('aria-checked') === 'true');
        const was = document.activeElement;
        // A Deer wallpaper's tile comes once the collection is read, a moment after the first render.
        if (!checked() && wp?.isDeerPath(bg.current().path)) {
          await new Promise<void>((resolve) => {
            const done = (): void => {
              off();
              window.clearTimeout(timer);
              resolve();
            };
            const off = wp.onChange(() => checked() && done());
            const timer = window.setTimeout(done, 1500);
          });
          if (document.activeElement !== was) return; // the person moved on meanwhile
        }
        (checked() ?? tiles.find((t) => t.tabIndex === 0) ?? tabButtons.find((b) => b.tabIndex === 0))?.focus();
      }),
    dispose: () => {
      off();
      offDeer();
      unwatch?.();
      unwatch = null;
    },
  };
}
