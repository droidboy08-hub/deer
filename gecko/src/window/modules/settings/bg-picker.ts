// The background picker, shared by Settings › Home and background and Home's Background popover:
// Photo / Video / None tabs over a grid of tiles. A tile is a radio; choosing one applies it.
// Ported from app/src/renderer/modules/settings/bg-picker.ts. Gecko: tile faces are the files
// themselves (<img> / <video> on a file: URL; browser.xhtml's CSP leaves img-src and media-src
// open, and Gecko decodes an image at the size it is drawn), no thumbnail service.
//
// The Photo and Video tabs end with one more group, "Deer wallpapers" (VitreWallpapers: the collection
// hosted on GitHub; the Photo tab shows its photos, the Video tab its live wallpapers), under its own
// caption with a small "Credits" link (the collection's CREDITS.md, in a new tab). Nothing is asked
// of the network until the group's button is clicked (owner's plan of 2026-10-21): "Get wallpapers"
// (Photo tab) or "Get live wallpapers" (Video tab) downloads every item of that kind not here yet;
// meanwhile the button reads "Getting 12 of 49…" (its tooltip: "Click to stop") and a click on it
// stops the Get, but not the second click of a double-click, nor one within half a second of the
// start (a double-click must not start and stop it at once, with nothing said). Closing the picker
// (Settings, the popover) stops it too, a second later (VitreWallpapers.watch: the picker watches both
// kinds while it is open, so switching to the Video tab to get live wallpapers as well does not stop
// the photos). Once everything is here it reads "Check for new wallpapers": a click
// then fetches only what is new ("No new wallpapers." when nothing is). A Get that fails leaves one
// plain line, "Couldn’t get wallpapers. Try again." (also said to screen readers), and what came in
// stays. The group's tiles are the items downloaded; they look and behave as the others (sizes,
// check, focus ring, arrows, Home / End), a face is the thumbnail (a video's poster frame) on the mean
// colour, a name and tooltip give the title and the credit ("Photo: <author> · <license>", "Video:
// …"), and choosing one applies it at once. Right-click on a tile, or Shift+F10 / the Menu key on a
// focused one, offers "Remove" (the 'menus' service): the copy is deleted from this computer and
// later Gets skip it; removing the current background sets Home back to its default, the picker
// staying on its tab with focus on the next tile. A tile is an id and a kind: the Photo tab's are
// photos, the Video tab's videos. The Video tab's note ("Add a video…") is for a tab with no video at
// all; it waits until the folder has been read.
import type { GetState, WallpaperTile } from '../../../modules/VitreWallpapers.sys';
import type { WallpaperKind } from '../../../modules/wallpapers/manifest';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
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

/** What the Deer group says, by kind: the button's three faces and the line under a Get. */
export const WALLPAPER_WORDS: Record<WallpaperKind, { get: string; check: string; getting: string; stop: string; stopTip: string; none: string; failed: string; added: (n: number) => string }> = {
  photo: {
    get: 'Get wallpapers',
    check: 'Check for new wallpapers',
    getting: 'Getting wallpapers…',
    stop: 'Click again to stop.',
    stopTip: 'Click to stop',
    none: 'No new wallpapers.',
    failed: 'Couldn’t get wallpapers. Try again.',
    added: (n) => `${n} new wallpaper${n === 1 ? '' : 's'}.`,
  },
  video: {
    get: 'Get live wallpapers',
    check: 'Check for new live wallpapers',
    getting: 'Getting live wallpapers…',
    stop: 'Click again to stop.',
    stopTip: 'Click to stop',
    none: 'No new live wallpapers.',
    failed: 'Couldn’t get live wallpapers. Try again.',
    added: (n) => `${n} new live wallpaper${n === 1 ? '' : 's'}.`,
  },
};

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

/** "Photo: <author> · <license>" ("Video: …" for a video), or '' when there is no credit. */
function creditOf(w: WallpaperTile): string {
  return w.author ? `${w.kind === 'video' ? 'Video' : 'Photo'}: ${w.author}${w.license ? ` · ${w.license}` : ''}` : '';
}

/** The Deer wallpapers a tab shows: the Photo tab's photos, the Video tab's videos. */
function deerKindOf(tab: Tab): WallpaperKind | null {
  return tab === 'photo' ? 'photo' : tab === 'video' ? 'video' : null;
}

/** A Deer wallpaper as a tile of the picker: a photo is an 'image' background, a video a 'video' one. */
const deerTile = (w: WallpaperTile): Tile => ({ kind: w.kind === 'video' ? 'video' : 'image', path: w.path, label: w.title, deer: w });

/** Beyond a tile's face, its focus ring (styles.ts: a 2 px outline 4 px out). */
const RING = 6;
/** A click on the Get button this soon after it started a Get does not stop it (a double-click's second half). */
const STOP_GRACE_MS = 500;

export function backgroundPicker(bg: HomeBackground, variant: 'panel' | 'popover'): Picker {
  const columns = variant === 'panel' ? 3 : 2;
  const panelId = uid('hb-panel');
  const wp = bg.deerWallpapers();
  let tab: Tab = tabFor(bg.current().kind);
  let tiles: HTMLElement[] = [];
  /** What `tiles` show, in order. */
  let shown: Tile[] = [];
  let deerTiles: HTMLElement[] = [];
  /** What `deerTiles` show, in order. */
  let deerShown: WallpaperTile[] = [];
  let build = 0;
  let shownKey = '';
  let deerKey = '';
  /** The folder of Deer wallpapers has been read (the Video tab's note waits for it). */
  let deerReady = !wp;
  // Both kinds are watched while the picker is open, whichever tab shows: closing it is leaving.
  const unwatch: (() => void)[] = wp ? (['photo', 'video'] as const).map((k) => wp.watch(k)) : [];
  /** When this picker's button last started a Get (performance.now()). */
  let startedAt = -Infinity;
  /**
   * A tile chosen here that HomeBackground has not answered yet (it looks for the file first): it is
   * the one checked meanwhile, whatever repaints come (a Get's progress, a tile arriving).
   */
  let picking: { kind: string; path: string } | null = null;
  /** The background the tab last followed ("kind|path"): only a new one moves the tab. */
  let followed = `${bg.current().kind}|${bg.current().path}`;
  /** A Deer tile removed while it had focus: the tile to focus once the group is drawn again ('' = the button). */
  let refocus: string | null = null;

  const tabButtons = TABS.map((t) =>
    h('button', { type: 'button', role: 'tab', id: uid('hb-tab'), class: 'vs-seg-btn', 'aria-controls': panelId, 'data-tab': t.id, 'data-label': t.label, text: t.label }),
  );
  const tabList = h('div', { class: 'vs-seg hb-tabs', role: 'tablist', 'aria-label': 'Background' }, ...tabButtons);
  const grid = h('div', { class: `hb-grid cols-${columns}`, role: 'radiogroup' });
  const deerTitle = h('p', { class: 'hb-group', id: uid('hb-group'), text: 'Deer wallpapers' });
  const credits = h('button', { type: 'button', class: 'vs-link hb-credits', text: 'Credits', 'aria-label': 'Credits, opens in a new tab' });
  setTip(credits, 'Who made these wallpapers', 'Opens in a new tab');
  const getBtn = h('button', { type: 'button', class: 'vs-btn hb-get' });
  // A Get's outcome: the failure, or nothing new (screen readers hear it).
  const getNote = h('p', { class: 'hb-get-note', role: 'status', hidden: true });
  const deerGrid = h('div', { class: `hb-grid cols-${columns}`, role: 'radiogroup', 'aria-labelledby': deerTitle.id, hidden: true });
  const deerBox = h(
    'div',
    { class: 'hb-deer', hidden: true },
    h('div', { class: 'hb-deer-head' }, deerTitle, credits),
    h('div', { class: 'hb-get-row' }, getBtn, getNote),
    deerGrid,
  );
  const note = h('p', { class: 'hb-note', role: 'status' });
  // What a Get brought, for screen readers (the tiles show it).
  const live = h('p', { class: 'hb-live', role: 'status' });
  const panel = h('div', { class: 'hb-panel', role: 'tabpanel', id: panelId }, grid, note, deerBox, live);
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
   * Each tile's check as the background is now, for the repaints Deer wallpapers bring (each item a
   * Get brings): a group is painted again only when one of its checks moved, so its tab stop stays
   * where the arrows put it.
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

  /** A face's picture: a photo's file itself, or a frame of a video (muted, never playing). */
  const faceMedia = (url: string, video: boolean): HTMLImageElement | HTMLVideoElement => {
    let media: HTMLImageElement | HTMLVideoElement;
    if (video) {
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
    return media;
  };

  const tileEl = (t: Tile): HTMLElement => {
    const face = h('span', { class: `hb-face${t.kind === 'none' ? ' hb-plain' : ''}` });
    const w = t.deer;
    const credit = w ? creditOf(w) : '';
    const btn = h(
      'button',
      { type: 'button', role: 'radio', class: 'hb-tile', 'aria-label': credit ? `${t.label}, ${credit}` : t.label, 'data-kind': t.kind, 'data-path': t.path, 'data-id': w?.id },
      face,
      h('span', { class: 'hb-badge', 'aria-hidden': 'true' }, icon(ico.check)),
      variant === 'panel' ? h('span', { class: 'hb-cap', text: t.label, 'aria-hidden': 'true' }) : null,
    );
    if (w) {
      setTip(btn, t.label, credit || undefined);
      // The face: the thumbnail (a video's poster), or the file itself for one of Deer 0.1.5-0.1.8's,
      // on the mean colour.
      face.style.backgroundColor = w.color;
      const src = fileURL(w.thumb || w.path);
      if (src) face.append(faceMedia(src, !w.thumb && w.kind === 'video'));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // The keyboard's (Shift+F10, the Menu key: WM_CONTEXTMENU) comes with button 0.
        tileMenu(btn, w, e.button === 0 ? null : { x: e.clientX, y: e.clientY });
      });
    }
    btn.dataset.current = String(isCurrent(t));
    btn.addEventListener('click', () => choose(btn, t));
    if (!w && t.kind !== 'none' && t.path) {
      const url = fileURL(t.path);
      if (url) face.append(faceMedia(url, t.kind === 'video'));
    }
    return btn;
  };

  const choose = (btn: HTMLElement, t: Tile): void => {
    picking = { kind: t.kind, path: t.path };
    for (const x of [...tiles, ...deerTiles]) x.dataset.current = String(x === btn);
    paintChecks();
    btn.focus();
    void bg.chooseTile(t);
  };

  const paintNote = (): void => {
    const error = bg.error ?? bg.homeError();
    // No video of yours and no Deer video here (once the folder is read: the note would show, be
    // read out, and go again as the tiles come).
    const empty = tab === 'video' && !tiles.length && !deerTiles.length && deerReady;
    const text = error ?? (empty ? 'Add a video to play it behind Home. It plays muted and loops.' : tab === 'none' ? 'Home shows a plain dark background.' : '');
    // Only a change is written: the line is a status, read out each time it is set.
    if (note.textContent !== text) note.textContent = text;
    note.classList.toggle('error', !!error);
    note.hidden = !text;
  };

  // ---- Deer wallpapers ----

  /** The button and the line, as the tab's kind's Get is. */
  const paintGet = (kind: WallpaperKind, g: GetState): void => {
    const words = WALLPAPER_WORDS[kind];
    const text = g.running ? (g.of ? `Getting ${g.at} of ${g.of}…` : words.getting) : g.complete ? words.check : words.get;
    if (getBtn.textContent !== text) getBtn.textContent = text;
    const name = g.running ? `${text} ${words.stop}` : null;
    if (name) getBtn.setAttribute('aria-label', name);
    else getBtn.removeAttribute('aria-label');
    // The stop, for sighted people too: the tooltip while it runs.
    setTip(getBtn, g.running ? words.stopTip : null);
    getBtn.dataset.state = g.running ? 'running' : g.complete ? 'complete' : 'idle';
    const line = g.outcome === 'failed' ? words.failed : g.outcome === 'nothing-new' ? words.none : '';
    if (getNote.textContent !== line) getNote.textContent = line;
    getNote.classList.toggle('error', g.outcome === 'failed');
    getNote.hidden = !line;
    const said = g.outcome === 'added' ? words.added(g.added) : '';
    if (live.textContent !== said) live.textContent = said;
  };

  const renderDeer = (): void => {
    const kind = deerKindOf(tab);
    const st = kind && wp ? wp.state() : null;
    const list = st?.tiles.filter((w) => w.kind === kind) ?? [];
    const key = `${kind}\n${list.map((w) => `${w.id}|${w.path}|${w.thumb}|${w.color}|${w.title}|${w.author}|${w.license}`).join('\n')}`;
    if (key !== deerKey) {
      const was = (document.activeElement as HTMLElement | null)?.dataset?.id;
      const hadFocus = deerGrid.contains(document.activeElement);
      deerKey = key;
      deerShown = list;
      deerTiles = list.map((w) => tileEl(deerTile(w)));
      deerGrid.replaceChildren(...deerTiles);
      deerGrid.hidden = !deerTiles.length;
      paintGroup(deerTiles);
      if (refocus !== null) {
        // A tile removed with focus on it: the next one (or the one before, or the button).
        const target = (refocus && deerTiles.find((t) => t.dataset.id === refocus)) || deerTiles[0] || getBtn;
        refocus = null;
        target.focus();
        if (target !== getBtn) paintGroup(deerTiles, true);
      } else if (hadFocus) {
        (deerTiles.find((t) => t.dataset.id === was) ?? deerTiles.find((t) => t.tabIndex === 0))?.focus();
        paintGroup(deerTiles, true); // the tab stop where focus came back
      }
    }
    const boxHidden = !st;
    const ready = !wp || !!st?.ready || deerReady;
    if (deerBox.hidden !== boxHidden || deerReady !== ready || el.dataset.deer !== String(list.length)) {
      deerBox.hidden = boxHidden;
      deerReady = ready;
      paintNote(); // the Video tab's note is for a tab with no video at all
    }
    if (kind && st) paintGet(kind, st.get[kind]);
    syncGroup(deerTiles, deerShown.map(deerTile));
    // A Deer wallpaper just applied (or one taken off): the other group's check moves at the same
    // moment (its own render waits for its tiles).
    syncGroup(tiles, shown);
    el.dataset.deer = String(list.length);
  };

  /** The tile's menu: Remove (the 'menus' service; a build without it offers none). */
  const tileMenu = (btn: HTMLElement, w: WallpaperTile, point: { x: number; y: number } | null): void => {
    const menus = bg.menus();
    if (!menus || !wp) return;
    const keyboard = !point;
    const focused = keyboard || document.activeElement === btn;
    menus.show([{ label: 'Remove', access: 'r', run: () => removeTile(btn, w, focused) }], point ?? btn, {
      label: w.title,
      keyboard,
      owner: btn,
      onClose: () => {
        if (keyboard && btn.isConnected && document.activeElement !== btn) btn.focus();
      },
    });
  };

  /** "Remove": the copy goes from this computer; the current background's removal leaves the tab where it is. */
  const removeTile = (btn: HTMLElement, w: WallpaperTile, moveFocus: boolean): void => {
    if (!wp) return;
    const i = deerTiles.indexOf(btn);
    if (moveFocus && i >= 0) refocus = deerTiles[i + 1]?.dataset.id ?? deerTiles[i - 1]?.dataset.id ?? '';
    if (btn.getAttribute('aria-checked') === 'true') {
      // Home goes back to its default background: the tab stays (only a background chosen elsewhere moves it).
      const d = DEFAULT_SETTINGS.homeBackground;
      followed = `${d.kind}|${d.path}`;
    }
    void wp.remove(w.id, w.kind).then((done) => {
      if (!done) refocus = null;
    });
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
  // Shift+F10 and the Menu key on a focused Deer tile: its menu (also when no contextmenu follows the key).
  deerGrid.addEventListener('keydown', (e) => {
    if (!((e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.altKey) || (e.key === 'ContextMenu' && !e.shiftKey && !e.ctrlKey && !e.altKey))) return;
    const i = deerTiles.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || !deerShown[i]) return;
    e.preventDefault();
    tileMenu(deerTiles[i], deerShown[i], null);
  });

  getBtn.addEventListener('click', (e) => {
    const kind = deerKindOf(tab);
    if (!kind || !wp) return;
    // The second click of a double-click (detail 2 and up; a key's click is 0) is not a second click.
    if (e.detail > 1) return;
    if (wp.state().get[kind].running) {
      if (performance.now() - startedAt >= STOP_GRACE_MS) wp.stop(kind);
    } else {
      startedAt = performance.now();
      void wp.get(kind);
    }
  });
  credits.addEventListener('click', () => bg.openCredits());

  /**
   * A tile wholly inside the popover's scroll area, its focus ring too: Gecko's focus() scrolls only a
   * tile that is out of view, and leaves one partly hidden as it is (with two groups, the checked tile
   * can sit across the area's lower edge). Only the panel scrolls (Settings' panel does not: no-op).
   */
  const reveal = (tile: HTMLElement): void => {
    const box = panel.getBoundingClientRect();
    const r = (tile.querySelector('.hb-face') ?? tile).getBoundingClientRect();
    const top = r.top - RING - box.top;
    const bottom = r.bottom + RING - box.bottom;
    if (top < 0) panel.scrollTop += top;
    else if (bottom > 0) panel.scrollTop += Math.min(top, bottom);
  };

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
  // The folder read, a Get's progress and outcome, a tile coming or going.
  const offDeer = wp?.onChange(renderDeer) ?? ((): void => undefined);

  const first = render();
  return {
    el,
    tabs: tabList,
    focus: () =>
      void first.then(async () => {
        const checked = (): HTMLElement | undefined => [...tiles, ...deerTiles].find((t) => t.getAttribute('aria-checked') === 'true');
        const was = document.activeElement;
        // A Deer wallpaper's tile comes once the folder is read, a moment after the first render.
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
        const target = checked() ?? tiles.find((t) => t.tabIndex === 0);
        if (target) {
          target.focus();
          reveal(target);
        } else tabButtons.find((b) => b.tabIndex === 0)?.focus();
      }),
    dispose: () => {
      off();
      offDeer();
      for (const done of unwatch.splice(0)) done();
    },
  };
}
