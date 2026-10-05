// Script of Deer's Home page (about:vitre-home -> chrome://vitre/content/pages/home/home.html).
// It shows the background the user chose in Settings (settings.homeBackground):
//   windows   the user's Windows desktop wallpaper (a screen-sized cached copy, see VitreHome)
//   image     a picture file
//   video     a video file, muted and looping; it plays only while this tab is on screen
//   none      the plain base colour
// and tells every window which glass suits it (VitreHome.setTheme: light over a bright picture,
// clear otherwise). A file that cannot be shown falls back to "none".
//
// The page runs in the parent process with the system principal. It builds DOM with createElement
// only, takes no input from the web, and loads nothing from the network.
//
// State for tests and diagnostics, on <html>: data-kind, data-state (loading | ready | error),
// data-theme, data-luma, data-cached, data-ms, data-playing (video).
import type { Settings } from '../../shared/settings';

type Media = HTMLImageElement | HTMLVideoElement;
type Background = Settings['homeBackground'];

const { VitreSettings } = ChromeUtils.importESModule('chrome://vitre/content/modules/VitreSettings.sys.mjs') as typeof import('../../modules/VitreSettings.sys');
const { VitreHome } = ChromeUtils.importESModule('chrome://vitre/content/modules/VitreHome.sys.mjs') as typeof import('../../modules/VitreHome.sys');

const FADE_MS = 300;
const root = document.documentElement;
const host = document.getElementById('bg') as HTMLElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let applied = '';
let current: Media | null = null;
/** Bumped for every background change: a slower, older load must not win. */
let serial = 0;

const keyOf = (bg: Background): string => `${bg.kind}|${bg.path}`;

function setState(state: 'loading' | 'ready' | 'error', extra: Record<string, string> = {}): void {
  root.dataset.state = state;
  for (const [k, v] of Object.entries(extra)) root.dataset[k] = v;
}

function setTheme(luma: number | null): void {
  const theme = VitreHome.themeFor(luma);
  root.dataset.theme = theme;
  root.dataset.luma = luma === null ? '' : luma.toFixed(3);
  VitreHome.setTheme(theme);
}

/** Brightness of the top tenth of what the element shows (where the tab bar sits). */
function topLuma(el: Media): number | null {
  const width = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const height = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!width || !height) return null;
  try {
    const w = 160;
    const h = Math.max(1, Math.round((w * height) / width));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0, w, h);
    const rows = Math.max(1, Math.round(h * 0.1));
    const d = ctx.getImageData(0, 0, w, rows).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  } catch {
    return null;
  }
}

/** A video plays only while Home is on screen and motion is welcome. */
function syncPlayback(): void {
  const v = current;
  if (!(v instanceof HTMLVideoElement)) {
    delete root.dataset.playing;
    return;
  }
  if (document.visibilityState === 'visible' && !reducedMotion.matches) {
    if (v.paused) v.play().catch(() => undefined);
  } else if (!v.paused) v.pause();
  root.dataset.playing = String(!v.paused);
}

function retire(el: Media | null, fade: boolean): void {
  if (!el) return;
  if (el instanceof HTMLVideoElement) el.pause();
  if (!fade) {
    el.remove();
    return;
  }
  el.classList.add('fade');
  el.classList.remove('shown');
  window.setTimeout(() => el.remove(), FADE_MS + 20);
}

/** Put a loaded picture or video on screen; the first one of a page load appears without a fade. */
function present(el: Media): void {
  const old = current;
  current = el;
  if (old) {
    el.classList.add('fade');
    void el.offsetWidth; // the start state must be computed for the fade to run
  }
  el.classList.add('shown');
  if (old) window.setTimeout(() => retire(old, false), FADE_MS + 20);
  syncPlayback();
}

function showNone(state: 'ready' | 'error'): void {
  retire(current, true);
  current = null;
  setTheme(null);
  setState(state);
  syncPlayback();
}

function makeImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = document.createElement('img');
    img.className = 'media';
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('load', () => resolve(img), { once: true });
    img.addEventListener('error', () => resolve(null), { once: true });
    img.src = url;
    host.append(img);
  });
}

function makeVideo(url: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.className = 'media';
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.tabIndex = -1;
    // Playback follows visibility (syncPlayback); autoplay could start it in a background tab.
    v.addEventListener('loadeddata', () => resolve(v), { once: true });
    v.addEventListener('error', () => resolve(null), { once: true });
    v.addEventListener('play', syncPlayback);
    v.addEventListener('pause', () => (root.dataset.playing = 'false'));
    v.src = url;
    host.append(v);
  });
}

async function apply(bg: Background): Promise<void> {
  const key = keyOf(bg);
  if (key === applied) return;
  applied = key;
  const mine = ++serial;
  const started = performance.now();
  root.dataset.kind = bg.kind;
  delete root.dataset.cached;
  setState('loading');
  const done = (state: 'ready' | 'error'): void => setState(state, { ms: String(Math.round(performance.now() - started)) });
  const box = { width: window.screen.width * window.devicePixelRatio, height: window.screen.height * window.devicePixelRatio };

  if (bg.kind === 'none') {
    showNone('ready');
    done('ready');
    return;
  }

  let el: Media | null = null;
  let luma: number | null = null;
  try {
    if (bg.kind === 'video') {
      if (bg.path) el = await makeVideo(VitreHome.fileURL(bg.path));
      if (el) luma = topLuma(el);
    } else {
      const path = bg.kind === 'windows' ? (await VitreHome.windowsWallpaper())?.path : bg.path;
      const picture = path ? await VitreHome.picture(window, path, box) : null;
      if (picture) {
        root.dataset.cached = String(picture.cached);
        el = await makeImage(picture.url);
        luma = picture.luma ?? (el ? topLuma(el) : null);
      }
    }
  } catch (e) {
    console.error('Deer Home: background failed', e);
    el?.remove();
    el = null;
  }
  if (mine !== serial) {
    el?.remove(); // a newer choice came first
    return;
  }
  if (!el) {
    // No wallpaper (a solid-colour desktop) is not an error; a chosen file that will not open is.
    showNone(bg.kind === 'windows' ? 'ready' : 'error');
    done(bg.kind === 'windows' ? 'ready' : 'error');
    return;
  }
  present(el);
  setTheme(luma);
  done('ready');
}

void apply(VitreSettings.get().homeBackground);
const unsubscribe = VitreSettings.onChange((s, changed) => {
  if (changed.some((k) => k.startsWith('homeBackground.'))) void apply(s.homeBackground);
});
window.addEventListener('unload', () => unsubscribe(), { once: true });
document.addEventListener('visibilitychange', syncPlayback);
reducedMotion.addEventListener('change', syncPlayback);
