// The update note: when Deer's updater (src/modules/VitreUpdater.sys.ts) has downloaded a new
// version, one quiet note under the tab pill says "Deer <v> is ready" with a "Restart to update"
// button. Shown once per version, in the most recent browser window (the updater picks it); it goes
// away on a click anywhere else, after 20 s, or when the button is used. The same
// action stays in Settings › About and in the + circle's menu while the update waits.
// The look is the downloads module's note (src/window/modules/downloads/video.ts note()): dark glass,
// 14 px radius, the accent button.
// Popup windows never show it.
import type { Browser } from '../browser';
import type { UpdateState } from '../../modules/VitreUpdater.sys';
import { el } from '../dom';
import { glass, lens } from '../glass';

const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SHOW_MS = 20_000;

const CSS = `
#vitre-root .module-layer > .vu-note.glass { position: fixed; border-radius: 14px; color: #fff; font-size: 13px; pointer-events: none;
  box-shadow: 0 16px 40px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3); }
#vitre-root .vu-note.glass > .tint { background: rgba(22,22,26,0.62); }
#vitre-root .vu-note-body { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 10px 16px; white-space: nowrap; }
#vitre-root .vu-note-body .b { font-weight: 600; }
#vitre-root .vu-note-body .d { color: rgba(255,255,255,0.72); }
#vitre-root .vu-note-act { pointer-events: auto; align-self: flex-start; margin-top: 8px; height: 28px; padding: 0 12px; border-radius: 6px; border: 0;
  background: #4cc2ff; color: #0b0b0d; font: 600 12.5px 'Segoe UI Variable Text', 'Segoe UI', sans-serif; cursor: default; }
#vitre-root .vu-note-act:hover { background: #7fd5ff; }
#vitre-root .vu-note-act:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
`;

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function install(b: Browser): void {
  if (b.isPopup) return;
  b.css('updates', CSS);
  const up = b.sys('VitreUpdater');
  let close: (() => void) | null = null;
  let waitPanel: MutationObserver | null = null;

  /** Shown by the updater (setNote): true when it is on screen, or will be once an open panel closes. */
  const show = (s: UpdateState): boolean => {
    if (window.closed || document.hidden) return false;
    if (b.root.classList.contains('panel-open')) {
      // Over Settings or Downloads it would sit on the dimmed page: it waits for the panel to close.
      waitPanel?.disconnect();
      waitPanel = new MutationObserver(() => {
        if (b.root.classList.contains('panel-open')) return;
        waitPanel?.disconnect();
        waitPanel = null;
        const now = up.state();
        if (now.phase === 'ready' && now.available === s.available) draw(now);
      });
      waitPanel.observe(b.root, { attributes: true, attributeFilter: ['class'] });
      return true;
    }
    draw(s);
    return true;
  };

  const draw = (s: UpdateState): void => {
    close?.();
    const layer = b.layer('updates-note', 30);
    const button = el('button', { type: 'button', class: 'vu-note-act' }, 'Restart to update');
    const body = el('div', { class: 'vu-note-body' }, el('span', { class: 'b' }, `Deer ${s.available} is ready`));
    if (s.machine) body.append(el('span', { class: 'd' }, 'Windows asks for administrator permission'));
    body.append(button);
    const note = el('section', { class: 'vu-note', role: 'status', 'aria-label': `Deer ${s.available} is ready` }, body);
    glass(note);
    layer.replaceChildren(note);
    const r = b.bar.layout.pillRect;
    note.style.left = `${Math.round(r ? r.left + r.width / 2 - note.offsetWidth / 2 : window.innerWidth / 2 - note.offsetWidth / 2)}px`;
    note.style.top = `${Math.round(r ? r.bottom + 8 : 64)}px`;
    (note.querySelector('.lens') as HTMLElement | null)?.style.setProperty('backdrop-filter', lens(note.offsetWidth, note.offsetHeight, { radius: 14, scale: 18, blur: 16, opaque: true }));
    if (!reduced()) note.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: SPRING });
    const done = (): void => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', outside, true);
      note.remove();
      if (close === done) close = null;
    };
    const outside = (e: Event): void => {
      if (!note.contains(e.target as Node)) done();
    };
    button.addEventListener('click', () => {
      done();
      void up.restartToUpdate();
    });
    const timer = window.setTimeout(done, SHOW_MS);
    document.addEventListener('pointerdown', outside, true);
    close = done;
  };

  const off = up.setNote(window, show);
  // The update went away (installed, failed, a newer one on its way): no note for it.
  const offState = up.onChange((s) => {
    if (s.phase !== 'ready') close?.();
  });
  b.onDestroy(() => {
    off();
    offState();
    waitPanel?.disconnect();
    close?.();
  });
}
