// Window-level Windows integration of the downloader: the taskbar progress under this window's
// button, and the prompt when someone quits (or closes the last window, or restarts) while
// downloads run. Each Firefox internal is behind one small function with its source.
import type { Browser } from '../../browser';
import { el } from '../../dom';
import { glass, lens } from '../../glass';
import type { DownloadView } from '../../../modules/downloads/types';
import type { DownloadStore } from './store';

// ---- taskbar progress ----

/**
 * nsITaskbarProgress for this window (widget/nsIWinTaskbar.idl getTaskbarProgress(docShell);
 * gre/moz-src/browser/components/downloads/DownloadsTaskbar.sys.mjs does the same for Firefox's own
 * downloads, which Deer takes over, so Firefox's indicator only ever reports an empty list).
 */
function taskbarProgress(): any {
  try {
    return Cc['@mozilla.org/windows-taskbar;1'].getService(Ci.nsIWinTaskbar).getTaskbarProgress(window.docShell);
  } catch {
    return null;
  }
}

/** What this window's taskbar button was last told (nsITaskbarProgress has no getter): for tests. */
export const taskbarShown = { state: -1, done: 0, total: 0 };

/** Follows the store: normal (green) while anything downloads, paused (yellow) when all wait paused. */
export function installTaskbar(b: Browser, store: DownloadStore): void {
  const progress = taskbarProgress();
  if (!progress) return;
  let last = '';
  const apply = (): void => {
    const views = store.all();
    const running = views.filter((v) => v.state === 'downloading' || v.state === 'starting' || v.state === 'queued');
    const paused = views.filter((v) => v.state === 'paused');
    const P = Ci.nsITaskbarProgress;
    let state = P.STATE_NO_PROGRESS;
    let done = 0;
    let total = 0;
    const sum = (list: DownloadView[]): void => {
      for (const v of list) {
        if (v.total > 0) {
          total += v.total;
          done += Math.min(v.received, v.total);
        }
      }
    };
    if (running.length) {
      sum(running);
      state = total > 0 ? P.STATE_NORMAL : P.STATE_INDETERMINATE;
    } else if (paused.length) {
      sum(paused);
      state = total > 0 ? P.STATE_PAUSED : P.STATE_NO_PROGRESS;
    }
    // Large files: nsITaskbarProgress takes 64-bit values, but keep them in a sane range.
    const scale = total > 1e12 ? 1e6 : 1;
    const key = `${state}:${Math.round(done / scale)}:${Math.round(total / scale)}`;
    if (key === last) return;
    last = key;
    try {
      progress.setProgressState(state, Math.round(done / scale), Math.round(total / scale));
      Object.assign(taskbarShown, { state, done: Math.round(done / scale), total: Math.round(total / scale) });
    } catch {
      /* the window is going away */
    }
  };
  b.onDestroy(store.subscribe(apply));
  // Firefox's own indicator resets the button when its (empty) list changes: say it again now and then.
  const timer = window.setInterval(() => {
    last = '';
    apply();
  }, 5000);
  b.onDestroy(() => window.clearInterval(timer));
  apply();
}

// ---- element full screen ----

/**
 * Deer's layer is hidden while a page element is full screen (skin/shell.css): a surface that must
 * be seen (the panel, the picker, the quit prompt) first leaves it, as Firefox's own exit button does:
 * FullScreen.exitDomFullScreen() (browser/chrome/browser/content/browser/browser-fullScreenAndPointerLock.js).
 * The surface shows once the page is back (MozDOMFullscreen:Exited).
 */
export function leaveElementFullscreen(b: Browser): void {
  if (!b.root.classList.contains('element-fullscreen')) return;
  try {
    const fs = (window as unknown as { FullScreen?: { exitDomFullScreen?: () => void } }).FullScreen;
    if (fs?.exitDomFullScreen) fs.exitDomFullScreen();
    else if (document.fullscreenElement) void document.exitFullscreen();
  } catch (e) {
    console.error('Deer downloads: could not leave element full screen', e);
  }
}

// ---- the quit prompt ----

type Kind = 'quit' | 'lastwindow' | 'restart' | 'private';

/** The prompt's layer: above panels (30), the switcher (40) and menus (50); below the core's tips (60). */
const PROMPT_Z = 55;

/**
 * Do what was asked again, now that the person confirmed (gre/chrome/toolkit/content/global/globalOverlay.js).
 * A restart this prompt held back may be the updater's "Restart to update": that one quits for the
 * update's setup (VitreUpdater.proceedRestart), not in place.
 */
function proceed(b: Browser, kind: Kind): void {
  if (kind === 'lastwindow' || kind === 'private') b.run('closeWindow');
  else if (kind === 'restart') {
    let forUpdate = false;
    try {
      forUpdate = b.sys('VitreUpdater').proceedRestart();
    } catch (e) {
      console.error('Deer downloads: the updater could not take the restart', e);
    }
    if (!forUpdate) Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
  } else b.run('quit');
}

/** The prompt's words: private downloads are cancelled, the others pause and continue next time. */
export function promptCopy(kind: Kind, count: number, priv: number): { title: string; body: string; go: string } {
  const one = count === 1;
  if (kind === 'private') {
    return {
      title: one ? 'A private download is still running' : `${count} private downloads are still running`,
      body: `If you close this window, ${one ? 'it is' : 'they are'} cancelled. Private downloads can’t continue later.`,
      go: one ? 'Cancel download and close' : 'Cancel downloads and close',
    };
  }
  const title = one ? 'A download is still running' : `${count} downloads are still running`;
  const verb = kind === 'restart' ? 'restart' : 'quit';
  const when = kind === 'restart' ? 'when Deer opens again' : 'the next time you open Deer';
  let body: string;
  if (priv >= count) body = `If you ${verb} now, ${one ? 'it is' : 'they are'} cancelled. Private downloads can’t continue later.`;
  else {
    body = `If you ${verb} now, ${one ? 'it pauses and continues from where it stopped' : 'they pause and continue from where they stopped'} ${when}.`;
    if (priv) body += ` ${priv === 1 ? 'The private one is' : 'Private ones are'} cancelled.`;
  }
  return { title, body, go: kind === 'restart' ? 'Restart' : 'Quit' };
}

/**
 * The engine refuses a quit while downloads run (quit-application-requested) and asks the most
 * recent window to show this: "Keep downloading" (default, Esc) or "Quit" (the downloads pause and
 * resume next time). A frosted 400 px dialog over the page dimmed at 0.3, like the panels.
 * Closing the last private window while a private download runs (kind 'private') asks the same
 * way in that window: "Keep downloading" or "Cancel downloads and close".
 */
export class QuitPrompt {
  private el: HTMLElement | null = null;
  private scrim: HTMLElement | null = null;
  private undo: (() => void)[] = [];

  constructor(private b: Browser) {
    const engine = b.sys('VitreDownloads');
    engine.setQuitPrompt(window, (kind, count, priv) => this.show(kind, count, priv ?? 0));
    b.onDestroy(() => engine.setQuitPrompt(window, null));
  }

  get isOpen(): boolean {
    return !!this.el;
  }

  show(kind: Kind, count: number, priv = 0): void {
    this.close();
    // In element full screen the prompt would be invisible and the quit silently refused.
    leaveElementFullscreen(this.b);
    this.b.bar.reveal();
    // It must be seen and answered: transient surfaces give way (an open menu, a held or latched
    // switcher), and its layer sits above the panels (30) and the switcher (40), under the tips.
    this.b.service('menus')?.close();
    this.b.service('switcher')?.close?.();
    const layer = this.b.layer('downloads-prompt', PROMPT_Z);
    const scrim = el('div', { class: 'vd-scrim in' });
    const { title, body, go: goLabel } = promptCopy(kind, count, priv);
    const keep = el('button', { type: 'button', class: 'vd-btn accent vd-q-keep' }, 'Keep downloading');
    const go = el('button', { type: 'button', class: 'vd-btn vd-q-go' }, goLabel);
    const box = el('section', { class: 'vd-quit', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'vd-quit-title', 'aria-describedby': 'vd-quit-body' }, el('div', { class: 'vd-quit-body' }, el('h2', { id: 'vd-quit-title' }, title), el('p', { id: 'vd-quit-body' }, body), el('div', { class: 'vd-quit-acts' }, go, keep)));
    glass(box);
    layer.append(scrim, box);
    this.el = box;
    this.scrim = scrim;
    (box.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(400, box.offsetHeight || 188, { radius: 20, scale: 22, blur: 18, opaque: true });
    keep.addEventListener('click', () => this.close());
    scrim.addEventListener('pointerdown', () => this.close());
    go.addEventListener('click', () => {
      this.close();
      const engine = this.b.sys('VitreDownloads');
      if (kind === 'private') engine.confirmPrivateClose();
      else engine.confirmQuit();
      proceed(this.b, kind);
    });
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      (document.activeElement === keep ? go : keep).focus();
    });
    this.undo.push(
      this.b.addEscLayer(30, () => {
        this.close();
        return true;
      })
    );
    keep.focus();
  }

  close(): void {
    for (const u of this.undo.splice(0)) u();
    this.el?.remove();
    this.scrim?.remove();
    this.el = this.scrim = null;
  }
}
