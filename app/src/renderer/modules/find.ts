// Find in page. Ctrl+F turns the active tab pill into its find face, in place: this module's own
// 480×44 element, laid exactly over the pill (layer z 12) while body classes hide the pill's own face.
// Over a visible bar the pill's glass shows through (a lens above the whole bar would also bend the
// neighbouring circles' shadows); with the bar hidden the face brings its own glass and stays pinned.
// Matches and highlights are Chromium's (webview findInPage); a landing ring in a click-through
// layer under the bar (z 9) marks the active match after a step. Ctrl+Q in the field closes find
// and opens the match's link in Peek (window.vitrePeek) when Peek is installed.
// Design: DESIGN-NOTES "Find in page"; boards FindPill, FindMotion, FindStates, FindSpec, FindContexts.
import type { WebviewTag } from 'electron';
import { match } from '../../shared/shortcuts';
import type { Browser } from '../app';
import { lens } from '../glass';
import type { Tab } from '../model';

type StopAction = 'clearSelection' | 'keepSelection' | 'activateSelection';
type Dir = 1 | -1;
/** After an answer: 'ring' runs the scroll guard and lands the ring; 'guard' (key repeat) only guards. */
type Landing = 'ring' | 'guard';
type Rect = { x: number; y: number; width: number; height: number };

interface FindState {
  open: boolean;
  /** The field's text; kept after close for F3 and the next Ctrl+F. */
  query: string;
  matchCase: boolean;
  ord: number;
  total: number;
  final: boolean;
  /** A result has arrived for the current session. */
  searched: boolean;
  requestId: number;
  /** Query and case the current Chromium find session was started for. */
  session: string | null;
  /** When that session was started (Chromium holds short queries for ~400 ms before answering). */
  sessionAt: number;
  /** One step request in flight; extra presses merge into one queued step. */
  inFlight: boolean;
  queued: 0 | Dir;
  /** Settles a step whose reply never comes. */
  flightTimer: number;
  /** Replies with lower ids are about a document the tab has left. */
  staleBelow: number;
  /** Request id of the current session's opening request. */
  sessionId: number;
  /** The first session after a navigation stop is asked again if it finds nothing (see onNavigate). */
  retryEmpty: boolean;
  stepDir: 0 | Dir;
  rapid: boolean;
  /** The user stepped or scrolled since the page started loading (no re-run at did-stop-loading). */
  stepped: boolean;
  /** Searched while the page was loading (or it reloaded): run once more when it stops. */
  rerun: boolean;
  lastResultAt: number;
  /** Active match in window coordinates. */
  rect: Rect | null;
  ringKey: string;
  url: string;
  /** The page's selection when find opened on it: the new session must start on this match. */
  anchor: Rect | null;
}

type Anchor = { text: string; x: number; y: number; width: number; height: number };
type PageLink = { href: string; x: number; y: number; width: number; height: number };

/** Page module replies to ask(): the first argument is the request id. */
const REPLIES = new Set(['find:selection', 'find:guarded', 'find:focused', 'find:moved', 'find:link']);

const PILL_H = 44;
const OPEN_MS = 240;
const CLOSE_MS = 200;
const DROP_MS = 300;
const HOLD_HIDDEN_BAR_MS = 400;
const COOLDOWN_MS = 400;
const RAPID_MS = 140;
const TYPE_PAUSE_MS = 400;
const NARROW = 400;
const GUARD_Y = 92;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const near = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 4 && Math.abs(a.y - b.y) <= 4;
const fmt = (n: number) => n.toLocaleString('en-US');
const sessionKey = (s: FindState) => `${s.matchCase ? 'C' : 'c'}:${s.query}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const svg = (size: number, body: string) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  up: svg(16, '<path d="M5 12.5 10 7.5l5 5"/>'),
  down: svg(16, '<path d="M5 7.5l5 5 5-5"/>'),
  close: svg(13, '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
};

// ---------------------------------------------------------------------------------------------
// Styles. Positions are pill-local and anchored right, as on the FindPill board at 480 px:
// favicon x 16, field from x 42, counter right edge x 324, previous 334, next 364, divider 401,
// Aa 410, × 442. Open transitions sit on .vf-find (they run when it is added); the close ones on
// the base rule (they run when it is removed).
// ---------------------------------------------------------------------------------------------
const CSS = `
/* Over a visible bar the real pill keeps its glass and only its face hides; the find face is drawn
   on it, and the pill's tint gives way to the focused tint. With the bar hidden the face brings its
   own glass (it stays pinned) and the real pill stays out of the way. */
body.vt-find-face #bar .item.tab.active .pill-face, body.vt-find-face #bar .item.tab.active .pill-face *,
body.vt-find-face #bar .item.tab.active .load-line { visibility: hidden !important; }
body.vt-find-face #bar .item.tab.active > .tint { transition: opacity 160ms ease; }
body.vt-find-face.vt-find-focused #bar .item.tab.active > .tint { opacity: 0; transition: opacity 200ms ease; }
body.vt-find-own #bar .item.tab.active { visibility: hidden; }
body.vt-find-cooldown #bar .item.active .reload { pointer-events: none; }
body.element-fullscreen #layer-find, body.element-fullscreen #layer-find-ring { display: none; }

body.theme-light #layer-find {
  --vf-focus: linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.40));
  --vf-text: #16181d; --vf-icon: rgba(22,24,29,0.78); --vf-icon-dis: rgba(22,24,29,0.28);
  --vf-placeholder: rgba(22,24,29,0.45); --vf-caret: #005fb8; --vf-divider: rgba(22,24,29,0.12);
  --vf-count: rgba(22,24,29,0.55); --vf-none: #c42b1c; --vf-text-shadow: none;
  --vf-hover: rgba(22,24,29,0.06); --vf-press: rgba(22,24,29,0.10);
  --vf-case-bg: rgba(0,95,184,0.12); --vf-case-ring: inset 0 0 0 1px rgba(0,95,184,0.35); --vf-case-on: #005fb8;
}
body.theme-dark #layer-find {
  --vf-focus: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)), rgba(16,16,20,0.46);
  --vf-text: #ffffff; --vf-icon: rgba(255,255,255,0.85); --vf-icon-dis: rgba(255,255,255,0.3);
  --vf-placeholder: rgba(255,255,255,0.45); --vf-caret: #4cc2ff; --vf-divider: rgba(255,255,255,0.12);
  --vf-count: rgba(255,255,255,0.6); --vf-none: #ff99a4; --vf-text-shadow: none;
  --vf-hover: rgba(255,255,255,0.10); --vf-press: rgba(255,255,255,0.16);
  --vf-case-bg: rgba(76,194,255,0.24); --vf-case-ring: inset 0 0 0 1px rgba(76,194,255,0.45); --vf-case-on: #9fe3ff;
}
body.theme-clear #layer-find {
  --vf-focus: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)), rgba(16,16,20,0.30);
  --vf-text: #ffffff; --vf-icon: rgba(255,255,255,0.9); --vf-icon-dis: rgba(255,255,255,0.32);
  --vf-placeholder: rgba(255,255,255,0.5); --vf-caret: #4cc2ff; --vf-divider: rgba(255,255,255,0.12);
  --vf-count: rgba(255,255,255,0.7); --vf-none: #ff99a4; --vf-text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  --vf-hover: rgba(255,255,255,0.10); --vf-press: rgba(255,255,255,0.16);
  --vf-case-bg: rgba(76,194,255,0.24); --vf-case-ring: inset 0 0 0 1px rgba(76,194,255,0.45); --vf-case-on: #9fe3ff;
}

#layer-find .vf-face {
  left: 0; top: 12px; width: 480px; height: ${PILL_H}px;
  color: var(--vf-text); text-shadow: var(--vf-text-shadow);
  font: 13.5px var(--font);
  transition: left 420ms var(--spring), width 420ms var(--spring), transform ${DROP_MS}ms var(--spring), opacity 160ms ease;
}
#layer-find .vf-face[hidden] { display: none; }
#layer-find .vf-face:not(.vf-own) { box-shadow: none; }
#layer-find .vf-face:not(.vf-own) > .lens, #layer-find .vf-face:not(.vf-own) > .rim,
#layer-find .vf-face:not(.vf-own) > .vf-base { display: none; }
#layer-find .vf-face.vf-raised { transform: translateY(-56px); }
#layer-find .vf-face.vf-faded { opacity: 0; }
#layer-find .vf-snap, #layer-find .vf-snap * { transition: none !important; }

.vf-face .vf-tint { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.vf-face .vf-base { background: var(--g-tint); opacity: 1; transition: opacity 160ms ease; }
.vf-face .vf-hi { background: var(--vf-focus); opacity: 0; transition: opacity 160ms ease; }
.vf-face.vf-find.vf-focused:not(.vf-under) .vf-base { opacity: 0; transition: opacity 200ms ease; }
.vf-face.vf-find.vf-focused:not(.vf-under) .vf-hi { opacity: 1; transition: opacity 200ms ease; }

/* The address face, drawn only so the pill can morph. */
.vf-face .vf-navs { position: absolute; inset: 0; pointer-events: none; transition: opacity 120ms ease 80ms, transform 120ms var(--spring) 80ms; }
.vf-face.vf-find .vf-navs { opacity: 0; transform: translateX(-6px); transition: opacity 100ms ease, transform 100ms ease; }
.vf-face .vf-nav, .vf-face .vf-reload { position: absolute; top: 8px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: var(--vf-icon); pointer-events: none; }
.vf-face .vf-nav.dis { color: var(--vf-icon-dis); }
.vf-face .vf-reload { transition: opacity 120ms ease 80ms, transform 120ms var(--spring) 80ms; }
.vf-face.vf-find .vf-reload { opacity: 0; transform: rotate(-90deg); transition: opacity 120ms ease, transform 120ms ease; }
.vf-face .vf-domain {
  position: absolute; left: 42px; top: 0; height: ${PILL_H}px; line-height: ${PILL_H}px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; font-weight: 500; pointer-events: none;
  transform: translateX(var(--vf-dom-dx, 0px)); transition: transform 200ms var(--spring), opacity 120ms ease 60ms;
}
.vf-face.vf-find .vf-domain { opacity: 0; transform: none; transition: transform ${OPEN_MS}ms var(--spring), opacity 120ms ease 60ms; }

.vf-face .vf-fav {
  position: absolute; left: 16px; top: 14px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;
  color: var(--vf-text); transform: translateX(var(--vf-fav-dx, 0px)); transition: transform 200ms var(--spring);
}
.vf-face.vf-find .vf-fav { transform: none; transition: transform ${OPEN_MS}ms var(--spring); }
.vf-face .vf-fav img, .vf-face .vf-fav svg { width: 16px; height: 16px; border-radius: 3px; display: block; }

.vf-face .vf-input {
  position: absolute; left: 42px; top: 0; width: 160px; height: ${PILL_H}px; margin: 0; padding: 0; border: 0; outline: none;
  background: transparent; color: var(--vf-text); font: 13.5px var(--font); text-shadow: inherit;
  caret-color: var(--vf-caret); user-select: text; opacity: 0; transition: opacity 80ms ease;
}
.vf-face.vf-find .vf-input { opacity: 1; transition: opacity 120ms ease 60ms; }
.vf-face.vf-find:not(.vf-focused) .vf-input { opacity: 0.85; caret-color: transparent; }
.vf-face .vf-input:focus-visible { outline: none; }
.vf-face .vf-input::placeholder { color: var(--vf-placeholder); opacity: 1; }
.vf-face .vf-input::selection { background: rgba(76,194,255,0.42); }
.vf-face.vf-overflow .vf-input { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 12px), transparent); }

/* Counter, chevrons, divider and Aa slide in as one group. */
.vf-face .vf-grp { position: absolute; inset: 0; pointer-events: none; opacity: 0; transform: translateX(8px); transition: opacity 90ms ease, transform 90ms ease; }
.vf-face.vf-find .vf-grp { opacity: 1; transform: none; transition: opacity 180ms ease 60ms, transform 180ms var(--spring) 60ms; }
.vf-face.vf-find .vf-grp > button { pointer-events: auto; }
.vf-face .vf-count {
  position: absolute; right: 156px; top: 0; height: ${PILL_H}px; max-width: 112px; overflow: hidden;
  display: flex; align-items: center; white-space: nowrap; font-size: 12.5px; line-height: 16px;
  font-variant-numeric: tabular-nums; color: var(--vf-count);
}
.vf-face .vf-count.none { color: var(--vf-none); }
.vf-face.vf-ime .vf-count { opacity: 0.5; }
.vf-face .vf-ordbox { position: relative; display: inline-block; height: 16px; overflow: hidden; }
.vf-face .vf-ord { display: inline-block; }
.vf-face .vf-ord-old { position: absolute; right: 0; top: 0; opacity: 0; }
.vf-face .vf-btn {
  position: absolute; top: 8px; width: 28px; height: 28px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center; color: var(--vf-icon);
  transition: background-color 100ms ease, transform 80ms ease, opacity 100ms ease;
}
.vf-face .vf-btn:hover { background: var(--vf-hover); }
.vf-face .vf-btn:active, .vf-face .vf-btn.vf-echo { background: var(--vf-press); transform: scale(0.94); }
.vf-face .vf-btn[aria-disabled="true"] { opacity: 0.28; background: transparent; transform: none; }
.vf-face .vf-prev { right: 118px; }
.vf-face .vf-next { right: 88px; }
.vf-face .vf-div { position: absolute; right: 78px; top: 14px; width: 1px; height: 16px; background: var(--vf-divider); }
.vf-face .vf-case { right: 42px; font: 600 13px/28px var(--font); color: var(--vf-text); opacity: 0.7; }
.vf-face .vf-case[aria-pressed="true"] { opacity: 1; background: var(--vf-case-bg); box-shadow: var(--vf-case-ring); color: var(--vf-case-on); }
.vf-face.vf-narrow .vf-case, .vf-face.vf-narrow .vf-div { display: none; }
.vf-face.vf-narrow .vf-prev { right: 72px; }
.vf-face.vf-narrow .vf-next { right: 42px; }
.vf-face.vf-narrow .vf-count { right: 110px; }

.vf-face .vf-close { right: 10px; opacity: 0; pointer-events: none; transition: background-color 100ms ease, transform 80ms ease, opacity 100ms ease; }
.vf-face.vf-find .vf-close { opacity: 1; pointer-events: auto; transition: background-color 100ms ease, transform 80ms ease, opacity 160ms ease 60ms; }
.vf-face .vf-close svg { transform: rotate(45deg); transition: transform 100ms ease; }
.vf-face.vf-find .vf-close svg { transform: none; transition: transform 160ms var(--spring) 60ms; }

.vf-face .vf-load { position: absolute; left: 22px; right: 22px; bottom: 0; height: 2px; border-radius: 1px; background: var(--accent); transform-origin: left; transform: scaleX(0); opacity: 0; pointer-events: none; }
.vf-face.vf-loading .vf-load { animation: vt-load 1.6s var(--expand) infinite; opacity: 1; }
.vf-face .vf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

#layer-find .vf-tip {
  position: absolute; top: 64px; max-width: min(640px, calc(100vw - 32px)); height: 26px; padding: 0 10px; border-radius: 8px;
  display: flex; align-items: center; gap: 8px; white-space: nowrap; background: rgba(28,28,32,0.88); color: #fff;
  font: 12px var(--font); text-shadow: none; box-shadow: 0 6px 16px rgba(0,0,0,0.2);
  pointer-events: none; opacity: 0; transition: opacity 120ms ease;
}
#layer-find .vf-tip[hidden] { display: none; }
#layer-find .vf-tip.on { opacity: 1; }
#layer-find .vf-tip .t { overflow: hidden; text-overflow: ellipsis; }
#layer-find .vf-tip .k { flex: none; color: rgba(255,255,255,0.6); }

#layer-find-ring .vf-ring { position: absolute; pointer-events: none; }
#layer-find-ring .vf-ring-edge { position: absolute; inset: -5px; border: 2px solid #4cc2ff; border-radius: 8px; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); opacity: 0; }
body.theme-light #layer-find-ring .vf-ring-edge { border-color: #005fb8; box-shadow: none; }

@media (prefers-reduced-motion: reduce) {
  #layer-find .vf-face, #layer-find .vf-face *, #layer-find .vf-tip {
    transition-property: opacity !important; transition-duration: 150ms !important; transition-delay: 0ms !important;
  }
  #layer-find .vf-face.vf-loading .vf-load { animation: none; transform: scaleX(0.6); }
}
@media (forced-colors: active) {
  #layer-find .vf-face { background: Canvas; color: CanvasText; box-shadow: none; text-shadow: none; outline: 1px solid CanvasText; outline-offset: -1px; }
  #layer-find .vf-face > .lens, #layer-find .vf-face > .rim, #layer-find .vf-face > .vf-tint { display: none; }
  #layer-find .vf-face .vf-btn { color: CanvasText; }
  #layer-find .vf-face .vf-btn[aria-disabled="true"] { color: GrayText; opacity: 1; }
  #layer-find .vf-face .vf-case[aria-pressed="true"] { forced-color-adjust: none; background: Highlight; color: HighlightText; box-shadow: none; }
  #layer-find .vf-face .vf-div { background: CanvasText; }
  #layer-find .vf-face .vf-count, #layer-find .vf-face .vf-count.none { color: CanvasText; }
  #layer-find-ring .vf-ring-edge { border-color: Highlight; box-shadow: none; }
}
`;

const FACE_HTML = `
  <div class="lens"></div><div class="vf-tint vf-base"></div><div class="vf-tint vf-hi"></div><div class="rim"></div>
  <div class="vf-navs" aria-hidden="true"><span class="vf-nav vf-back"></span><span class="vf-nav vf-fwd"></span></div>
  <span class="vf-domain" aria-hidden="true"></span>
  <span class="vf-reload" aria-hidden="true"></span>
  <span class="vf-fav" aria-hidden="true" data-tip-delay="500"></span>
  <input class="vf-input" id="find-input" type="text" spellcheck="false" autocomplete="off" placeholder="Find on page"
    aria-label="Find on page" aria-describedby="find-count">
  <div class="vf-grp">
    <div class="vf-count" id="find-count" aria-live="polite" aria-atomic="true"></div>
    <button type="button" class="vf-btn vf-prev" aria-label="Previous match" aria-keyshortcuts="Shift+Enter" data-tip="Previous match" data-key="Shift+Enter">${ICON.up}</button>
    <button type="button" class="vf-btn vf-next" aria-label="Next match" aria-keyshortcuts="Enter" data-tip="Next match" data-key="Enter">${ICON.down}</button>
    <span class="vf-div" aria-hidden="true"></span>
    <button type="button" class="vf-btn vf-case" id="find-case" aria-label="Match case" aria-pressed="false" aria-keyshortcuts="Alt+C" data-tip="Match case" data-key="Alt+C">Aa</button>
  </div>
  <button type="button" class="vf-btn vf-close" aria-label="Close find" aria-keyshortcuts="Escape" data-tip="Close" data-key="Esc">${ICON.close}</button>
  <div class="vf-load"></div>
  <div class="vf-sr" role="status"></div>`;

// ---------------------------------------------------------------------------------------------
// The face: DOM, morph, counter and tooltips. It knows nothing about Chromium.
// ---------------------------------------------------------------------------------------------

interface FaceHandlers {
  input(): void;
  key(e: KeyboardEvent): void;
  step(dir: Dir): void;
  toggleCase(): void;
  close(): void;
  focusChanged(): void;
  compose(on: boolean): void;
}

type FaceMode = 'hidden' | 'open' | 'closing';

class FindFace {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  mode: FaceMode = 'hidden';
  /** The tab whose find the face shows (null when hidden). */
  tabId: number | null = null;
  private q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
  private lensEl: HTMLElement;
  private count: HTMLElement;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private caseBtn: HTMLButtonElement;
  private fav: HTMLElement;
  private sr: HTMLElement;
  private tip: HTMLElement;
  private seq = 0;
  private rect = { x: 0, w: 0 };
  private lensW = 0;
  private morphTimer = 0;
  private tipTimer = 0;
  private favSrc = '';
  private url = '';

  constructor(private b: Browser, layer: HTMLElement, private h: FaceHandlers) {
    this.el = document.createElement('div');
    this.el.className = 'vf-face glass';
    this.el.setAttribute('role', 'search');
    this.el.setAttribute('aria-label', 'Find on page');
    this.el.hidden = true;
    this.el.innerHTML = FACE_HTML;
    this.tip = document.createElement('div');
    this.tip.className = 'vf-tip';
    this.tip.hidden = true;
    this.tip.setAttribute('aria-hidden', 'true');
    layer.append(this.el, this.tip);

    this.input = this.q<HTMLInputElement>('.vf-input');
    this.lensEl = this.q('.lens');
    this.count = this.q('.vf-count');
    this.prev = this.q<HTMLButtonElement>('.vf-prev');
    this.next = this.q<HTMLButtonElement>('.vf-next');
    this.caseBtn = this.q<HTMLButtonElement>('.vf-case');
    this.fav = this.q('.vf-fav');
    this.sr = this.q('.vf-sr');
    this.wire();
  }

  private wire(): void {
    const { input, h } = this;
    input.addEventListener('input', () => {
      this.updateOverflow();
      h.input();
    });
    input.addEventListener('keydown', (e) => h.key(e));
    input.addEventListener('compositionstart', () => h.compose(true));
    input.addEventListener('compositionend', () => h.compose(false));
    // Menus can toggle match case from the field menu with this event.
    input.addEventListener('find:match-case', () => h.toggleCase());
    this.prev.addEventListener('click', () => h.step(-1));
    this.next.addEventListener('click', () => h.step(1));
    this.caseBtn.addEventListener('click', () => h.toggleCase());
    this.q('.vf-close').addEventListener('click', () => h.close());
    this.el.addEventListener('keydown', (e) => this.cycleFocus(e));
    this.el.addEventListener('focusin', () => h.focusChanged());
    this.el.addEventListener('focusout', () => setTimeout(() => h.focusChanged(), 0));
    // A mousedown never takes focus from the field; a press on the glass itself puts focus in it.
    this.el.addEventListener('mousedown', (e) => {
      this.hideTip();
      // A closing face never takes focus: a second click on × would leave focus nowhere.
      if (this.mode !== 'open') {
        e.preventDefault();
        return;
      }
      const target = e.target as HTMLElement;
      if (target === input) return;
      e.preventDefault();
      if (!target.closest('button') && e.button === 0) this.focusField(false);
    });
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-tip], .vf-fav')) {
      el.addEventListener('mouseenter', () => this.scheduleTip(el));
      el.addEventListener('mouseleave', () => this.hideTip());
    }
  }

  // ---- show / hide and the morph ----

  /**
   * Show the find face for a tab. 'open' morphs from the address face (or drops in when the bar
   * is hidden); 'restore' appears for a tab switch, following the pill as the bar re-flows.
   */
  show(t: Tab, how: 'open' | 'restore', barHidden: boolean): void {
    const seq = ++this.seq;
    const wasClosing = this.mode === 'closing' && this.tabId === t.id;
    this.mode = 'open';
    this.tabId = t.id;
    this.url = t.url;
    this.el.hidden = false;
    this.el.classList.remove('vf-faded', 'vf-under');
    document.body.classList.add('vt-find-face');
    document.body.classList.remove('vt-find-cooldown');
    this.syncTab(t);

    if (wasClosing) {
      // Reopened mid-close: the transitions simply turn around.
      this.el.classList.remove('vf-raised');
      this.el.classList.add('vf-find');
      this.paintTint();
      return;
    }
    const target = this.b.bar.layout.pillRect;
    if (how === 'restore') {
      // The real pill grows from its circle; the face follows it and fades in.
      this.snap(() => {
        this.setOwnGlass(barHidden);
        this.el.classList.add('vf-find', 'vf-faded');
        this.el.classList.remove('vf-raised');
        const now = this.pillNow(t.id) ?? target;
        if (now) this.place(now.x, now.width, true);
      });
      requestAnimationFrame(() => {
        if (seq !== this.seq) return;
        this.el.classList.remove('vf-faded');
        if (target) this.place(target.x, target.width, false);
      });
      this.paintTint();
      return;
    }
    this.snap(() => {
      this.setOwnGlass(barHidden);
      if (target) this.place(target.x, target.width, true);
      if (barHidden) {
        // Bar hidden: only the pill drops in, already in its find face (reduced motion: fades in).
        this.el.classList.add('vf-find', reducedMotion() ? 'vf-faded' : 'vf-raised');
      } else {
        this.measureAddress(t.id);
        this.el.classList.remove('vf-find', 'vf-raised');
      }
    });
    this.el.classList.add('vf-find');
    this.el.classList.remove('vf-raised', 'vf-faded');
    this.paintTint();
  }

  /**
   * Over a visible bar the real pill's own glass carries the face; with the bar hidden (full
   * screen) the face brings its own glass and stays pinned.
   */
  setOwnGlass(on: boolean): void {
    if (this.mode === 'hidden') return;
    this.el.classList.toggle('vf-own', on);
    document.body.classList.toggle('vt-find-own', on);
    if (on && this.rect.w) this.setLens(this.rect.w);
  }

  /** The focused tint replaces the pill's own while the field has focus. */
  private paintTint(): void {
    const c = this.el.classList;
    const on = this.mode === 'open' && c.contains('vf-find') && c.contains('vf-focused') && !c.contains('vf-under');
    document.body.classList.toggle('vt-find-focused', on);
  }

  /** 'morph' plays the close (200 ms); 'fade' cross-fades out (Ctrl+L); 'instant' is a tab switch. */
  hide(how: 'morph' | 'fade' | 'instant', barHidden = false): void {
    if (this.mode === 'hidden') return;
    const seq = ++this.seq;
    this.hideTip();
    if (how === 'instant' || (how === 'fade' && reducedMotion())) {
      this.finishHide(how === 'instant' ? 0 : COOLDOWN_MS);
      return;
    }
    this.mode = 'closing';
    if (how === 'fade') {
      this.el.classList.add('vf-faded');
      window.setTimeout(() => seq === this.seq && this.finishHide(0), 160);
      return;
    }
    if (this.tabId !== null) this.measureAddress(this.tabId);
    this.el.classList.remove('vf-find');
    this.paintTint();
    if (!barHidden) {
      window.setTimeout(() => seq === this.seq && this.finishHide(COOLDOWN_MS), CLOSE_MS);
      return;
    }
    // Bar hidden: the address face shows for 400 ms, then rises (reduced motion: fades out).
    window.setTimeout(() => {
      if (seq !== this.seq) return;
      this.el.classList.add(reducedMotion() ? 'vf-faded' : 'vf-raised');
      window.setTimeout(() => seq === this.seq && this.finishHide(0), DROP_MS);
    }, CLOSE_MS + HOLD_HIDDEN_BAR_MS);
  }

  private finishHide(cooldown: number): void {
    const seq = this.seq;
    this.mode = 'hidden';
    this.tabId = null;
    this.el.hidden = true;
    this.el.classList.remove('vf-find', 'vf-focused', 'vf-raised', 'vf-faded', 'vf-under', 'vf-ime', 'vf-own');
    document.body.classList.remove('vt-find-face', 'vt-find-own', 'vt-find-focused');
    if (!cooldown) return;
    // The reload slot ignores clicks for a moment, so a second click on × doesn't reload.
    document.body.classList.add('vt-find-cooldown');
    window.setTimeout(() => seq === this.seq && document.body.classList.remove('vt-find-cooldown'), cooldown);
  }

  /** Run fn with every transition off, then commit the styles. */
  private snap(fn: () => void): void {
    this.el.classList.add('vf-snap');
    fn();
    void this.el.offsetWidth;
    this.el.classList.remove('vf-snap');
  }

  /** The real pill element for a tab, and where it is right now (mid-transition included). */
  private realPill(tabId: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(`#bar .item.tab[data-id="${tabId}"]`);
  }

  private pillNow(tabId: number): DOMRect | null {
    const r = this.realPill(tabId)?.getBoundingClientRect();
    return r && r.width > 0 ? r : null;
  }

  /** Copy the real pill's address face (positions, icons, domain) so the morph starts or ends on it. */
  private measureAddress(tabId: number): void {
    const item = this.realPill(tabId);
    if (!item) return;
    const box = item.getBoundingClientRect();
    const part = (sel: string) => item.querySelector<HTMLElement>(sel);
    const copy = (sel: string, into: string) => {
      const src = part(sel);
      const dst = this.q(into);
      if (!src) return;
      dst.innerHTML = src.innerHTML;
      dst.style.left = `${src.getBoundingClientRect().x - box.x}px`;
      dst.style.visibility = src.style.visibility || '';
      dst.classList.toggle('dis', src.getAttribute('aria-disabled') === 'true');
    };
    copy('.back', '.vf-back');
    copy('.forward', '.vf-fwd');
    copy('.reload', '.vf-reload');
    const fav = part('.address .fav')?.getBoundingClientRect();
    if (fav) this.el.style.setProperty('--vf-fav-dx', `${fav.x + fav.width / 2 - 8 - box.x - 16}px`);
    const host = part('.host');
    const domain = this.q('.vf-domain');
    if (host) {
      const r = host.getBoundingClientRect();
      domain.textContent = host.textContent;
      domain.style.width = `${Math.ceil(r.width) + 1}px`;
      this.el.style.setProperty('--vf-dom-dx', `${r.x - box.x - 42}px`);
    }
  }

  /** Lay the face over the pill. Width changes use frost until the lens for the new size is in. */
  place(x: number, w: number, snap: boolean): void {
    x = Math.round(x);
    w = Math.round(w);
    if (x === this.rect.x && w === this.rect.w) return;
    const resized = w !== this.rect.w;
    this.rect = { x, w };
    this.el.style.left = `${x}px`;
    this.el.style.width = `${w}px`;
    this.el.classList.toggle('vf-narrow', w < NARROW);
    if (!resized) return;
    window.clearTimeout(this.morphTimer);
    if (snap) {
      this.setLens(w);
    } else {
      this.el.classList.add('morphing');
      this.morphTimer = window.setTimeout(() => {
        this.el.classList.remove('morphing');
        this.setLens(w);
      }, 440);
    }
    this.layoutField();
  }

  private setLens(w: number): void {
    if (w === this.lensW) return;
    this.lensW = w;
    this.lensEl.style.backdropFilter = lens(w, PILL_H, { blur: 2.4 });
  }

  /** Stay on the pill's slot as the bar re-flows (tabs opening and closing, window resizes). */
  follow(): void {
    const target = this.b.bar.layout.pillRect;
    if (target && this.mode !== 'hidden') this.place(target.x, target.width, this.lensW === 0);
  }

  /** Favicon, address and loading line from the tab. */
  syncTab(t: Tab): void {
    this.el.classList.toggle('vf-loading', t.loading);
    this.url = t.url;
    const src = this.realPill(t.id)?.querySelector<HTMLElement>('.address .fav');
    const key = src?.dataset.src ?? '';
    if (src && key !== this.favSrc) {
      this.favSrc = key;
      this.fav.innerHTML = src.innerHTML;
      this.fav.querySelector('img')?.addEventListener('error', () => {
        this.favSrc = '';
      });
    }
  }

  // ---- state shown in the face ----

  setFocused(on: boolean): void {
    this.el.classList.toggle('vf-focused', on);
    this.paintTint();
  }

  /** The active match sits under the pill on fixed content: the pill takes its parked tint. */
  setUnder(on: boolean): void {
    this.el.classList.toggle('vf-under', on);
    this.paintTint();
  }

  setComposing(on: boolean): void {
    this.el.classList.toggle('vf-ime', on);
  }

  hasFocus(): boolean {
    return this.mode !== 'hidden' && this.el.contains(document.activeElement);
  }

  focusField(selectAll: boolean): void {
    this.input.focus();
    if (selectAll) this.input.select();
  }

  setQuery(text: string): void {
    if (this.input.value !== text) this.input.value = text;
    this.updateOverflow();
  }

  setCase(on: boolean): void {
    this.caseBtn.setAttribute('aria-pressed', String(on));
    this.input.dataset.matchCase = String(on);
  }

  /** The counter: "3 of 7", "1 of 4,812+" while counting, "No matches", or blank. */
  setCount(s: FindState, loading: boolean, roll: 'up' | 'down' | null): void {
    const c = this.count;
    const none = s.searched && s.total === 0 && s.final && !loading && !!s.query;
    const showCount = !!s.query && s.searched && s.total > 0 && s.ord > 0;
    c.classList.toggle('none', none);
    if (none) {
      c.textContent = 'No matches';
    } else if (!showCount) {
      if (!s.query || !s.searched || s.total === 0) c.textContent = '';
    } else {
      const ord = fmt(s.ord);
      let box = c.querySelector<HTMLElement>('.vf-ordbox');
      if (!box) {
        c.innerHTML = '<span class="vf-ordbox"><span class="vf-ord"></span><span class="vf-ord-old" aria-hidden="true"></span></span><span class="vf-total"></span>';
        box = c.querySelector<HTMLElement>('.vf-ordbox') as HTMLElement;
      }
      const cur = box.querySelector('.vf-ord') as HTMLElement;
      const old = box.querySelector('.vf-ord-old') as HTMLElement;
      const previous = cur.textContent ?? '';
      cur.textContent = ord;
      (c.querySelector('.vf-total') as HTMLElement).textContent = `\u00a0of ${fmt(s.total)}${s.final ? '' : '+'}`;
      if (roll && previous && previous !== ord && !reducedMotion()) this.roll(cur, old, previous, roll);
      else if (previous !== ord) old.textContent = '';
    }
    const off = !s.query || (s.searched && s.total === 0 && s.final);
    this.prev.setAttribute('aria-disabled', String(off));
    this.next.setAttribute('aria-disabled', String(off));
    this.layoutField();
  }

  /** The ordinal rolls: old number out 6 px (120 ms), new one in from the other side (160 ms, spring). */
  private roll(cur: HTMLElement, old: HTMLElement, previous: string, dir: 'up' | 'down'): void {
    const d = dir === 'up' ? 6 : -6;
    old.textContent = previous;
    cur.getAnimations().forEach((a) => a.cancel());
    old.getAnimations().forEach((a) => a.cancel());
    cur.animate([{ transform: `translateY(${d}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 160, easing: SPRING });
    const out = old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${-d}px)`, opacity: 0 }], { duration: 120, easing: 'ease' });
    out.onfinish = () => {
      old.textContent = '';
    };
  }

  /** No matches: Enter pulses the counter once. */
  pulse(): void {
    if (!reducedMotion()) this.count.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 160, easing: 'ease' });
  }

  /** Keyboard steps light the matching chevron for 100 ms. */
  echo(dir: Dir): void {
    const btn = dir > 0 ? this.next : this.prev;
    btn.classList.add('vf-echo');
    window.setTimeout(() => btn.classList.remove('vf-echo'), 100);
  }

  announce(text: string): void {
    this.sr.textContent = '';
    window.setTimeout(() => {
      this.sr.textContent = text;
    }, 30);
  }

  /** The field runs from x 42 to 10 px left of the counter (on the narrowest pills, at least 24 px). */
  private layoutField(): void {
    const right = this.el.classList.contains('vf-narrow') ? 110 : 156;
    const w = this.rect.w - right - this.count.offsetWidth - (this.count.offsetWidth ? 10 : 0) - 42;
    this.input.style.width = `${Math.max(24, w)}px`;
    this.updateOverflow();
  }

  private updateOverflow(): void {
    this.el.classList.toggle('vf-overflow', this.input.scrollWidth > this.input.clientWidth + 1);
  }

  /** Tab cycles field → previous → next → Aa → × and wraps. */
  private cycleFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const stops = [this.input, this.prev, this.next, this.caseBtn, this.q<HTMLElement>('.vf-close')].filter((el) => el.offsetParent !== null);
    const i = stops.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
  }

  // ---- tooltips: plain text with a dim key, 600 ms (the favicon's full URL after 500 ms) ----

  private scheduleTip(el: HTMLElement): void {
    window.clearTimeout(this.tipTimer);
    if (this.mode !== 'open') return;
    const delay = Number(el.dataset.tipDelay ?? 600);
    this.tipTimer = window.setTimeout(() => this.showTip(el), delay);
  }

  private showTip(el: HTMLElement): void {
    if (this.mode !== 'open') return;
    const label = el === this.fav ? this.url : el.dataset.tip ?? '';
    if (!label) return;
    const key = el.dataset.key;
    this.tip.innerHTML = `<span class="t">${esc(label)}</span>${key ? `<span class="k">${esc(key)}</span>` : ''}`;
    this.tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - 8 - w, r.x + r.width / 2 - w / 2));
    this.tip.style.left = `${Math.round(x)}px`;
    requestAnimationFrame(() => this.tip.classList.add('on'));
  }

  hideTip(): void {
    window.clearTimeout(this.tipTimer);
    this.tip.classList.remove('on');
    this.tip.hidden = true;
  }
}

// ---------------------------------------------------------------------------------------------
// The landing ring: 2 px, 3 px outside the active match; closes in from 16 px out (280 ms, spring),
// holds 260 ms, fades 240 ms. Click-through, in a layer under the bar.
// ---------------------------------------------------------------------------------------------

class LandingRing {
  private el: HTMLElement | null = null;
  shownAt = 0;

  constructor(private layer: HTMLElement) {}

  show(r: Rect): void {
    this.cancel();
    const ring = document.createElement('div');
    ring.className = 'vf-ring';
    ring.setAttribute('aria-hidden', 'true');
    Object.assign(ring.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    const edge = document.createElement('div');
    edge.className = 'vf-ring-edge';
    ring.append(edge);
    this.layer.append(ring);
    this.el = ring;
    this.shownAt = performance.now();
    const frames: Keyframe[] = reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.27 }, { opacity: 1, offset: 0.73 }, { opacity: 0 }]
      : [
          { inset: '-21px', opacity: 0, easing: SPRING },
          { inset: '-5px', opacity: 1, offset: 0.36, easing: SPRING },
          { inset: '-5px', opacity: 1, offset: 0.69, easing: SPRING },
          { inset: '-5px', opacity: 0 },
        ];
    const anim = edge.animate(frames, { duration: reducedMotion() ? 560 : 780, fill: 'both' });
    anim.onfinish = () => {
      if (this.el === ring) this.cancel();
    };
  }

  cancel(): void {
    this.el?.remove();
    this.el = null;
  }

  get visible(): boolean {
    return this.el !== null;
  }
}

// ---------------------------------------------------------------------------------------------
// The controller: per-tab state, Chromium requests, keys and the Esc ladder.
// ---------------------------------------------------------------------------------------------

class FindController {
  private states = new Map<number, FindState>();
  /** This window's last query, for tabs that have none. */
  private windowQuery = '';
  private face: FindFace;
  private ring: LandingRing;
  private waiters = new Map<number, (...args: unknown[]) => void>();
  private seq = 0;
  private lastStepAt = 0;
  /** What the next answer for the face's tab does: guard the match and land the ring, or only guard it. */
  private landNext: Landing | null = null;
  private typedSinceOpen = false;
  private composing = false;
  private searchRaf = 0;
  private pauseTimer = 0;
  private glassTimer = 0;

  constructor(private b: Browser) {
    b.css('find', CSS);
    this.ring = new LandingRing(b.layer('find-ring', 9));
    this.face = new FindFace(b, b.layer('find', 12), {
      input: () => this.onInput(),
      key: (e) => this.onKey(e),
      step: (dir) => this.withActive((t) => this.step(t, dir, false)),
      toggleCase: () => this.withActive((t) => this.toggleCase(t)),
      close: () => this.withActive((t) => this.close(t, 'keepSelection', { focusPage: true })),
      focusChanged: () => this.face.setFocused(this.face.hasFocus()),
      compose: (on) => this.onCompose(on),
    });

    b.registerAction('find', () => this.find());
    b.registerAction('findNext', () => this.findAgain(1));
    b.registerAction('findPrev', () => this.findAgain(-1));
    b.registerAction('focusAddress', () => {
      if (!this.f6()) b.editAddress();
    });
    // Esc ladder: the focused find field closes find (70); parked find closes after the page (90).
    b.addEscLayer(70, () => this.escape(true));
    b.addEscLayer(90, () => this.escape(false));

    b.on('webview-created', (t: Tab, wv: WebviewTag) => this.wire(t, wv));
    b.on('tab-closed', (t: Tab) => this.states.delete(t.id));
    b.on('tab-activated', () => this.syncActive());
    b.on('render', () => this.syncActive());
    window.addEventListener('resize', () => this.ring.cancel());
    // Ctrl+L, a click on another tab's address, anything that opens the address field: find steps aside.
    new MutationObserver(() => {
      this.syncGlass();
      if (!document.body.classList.contains('omni-open')) return;
      this.withActive((t) => {
        if (this.state(t).open) this.close(t, 'clearSelection', { focusPage: false, fade: true });
      });
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /** F11 while finding: the face takes its own glass at once, and gives it back once the bar is in. */
  private syncGlass(): void {
    window.clearTimeout(this.glassTimer);
    if (this.face.mode !== 'open') return;
    if (this.barHidden()) this.face.setOwnGlass(true);
    else this.glassTimer = window.setTimeout(() => this.face.setOwnGlass(this.barHidden()), 340);
  }

  // ---- helpers ----

  private state(t: Tab): FindState {
    let s = this.states.get(t.id);
    if (!s) {
      s = {
        open: false, query: '', matchCase: false, ord: 0, total: 0, final: true, searched: false, requestId: 0,
        session: null, sessionAt: 0, inFlight: false, queued: 0, flightTimer: 0, staleBelow: 0, sessionId: 0, retryEmpty: false,
        stepDir: 0, rapid: false, stepped: false, rerun: false, lastResultAt: 0, rect: null, ringKey: '', url: t.url, anchor: null,
      };
      this.states.set(t.id, s);
    }
    return s;
  }

  private withActive(fn: (t: Tab) => void): void {
    const t = this.b.active();
    if (t) fn(t);
  }

  private webview(t: Tab): WebviewTag | null {
    return t.kind === 'web' && t.webview && t.ready ? t.webview : null;
  }

  private send(t: Tab, channel: string, ...args: unknown[]): void {
    try {
      this.webview(t)?.send(channel, ...args);
    } catch {
      /* the page is gone or not attached yet */
    }
  }

  /** Ask the page something; its reply carries the same id. Resolves with the fallback after `timeout`. */
  private ask<T extends unknown[]>(t: Tab, channel: string, timeout: number, fallback: T, ...args: unknown[]): Promise<T> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      const done = (...reply: unknown[]) => {
        window.clearTimeout(timer);
        this.waiters.delete(id);
        resolve(reply as T);
      };
      const timer = window.setTimeout(() => done(...fallback), timeout);
      this.waiters.set(id, done);
      if (!this.webview(t)) done(...fallback);
      else this.send(t, channel, id, ...args);
    });
  }

  private barHidden(): boolean {
    const bar = document.getElementById('bar');
    if (!bar || document.body.classList.contains('fullscreen')) return true;
    return Number(getComputedStyle(bar).opacity) < 0.5;
  }

  private loadingFor(t: Tab): boolean {
    return t.loading && t.kind === 'web';
  }

  // ---- wiring each page ----

  private wire(t: Tab, wv: WebviewTag): void {
    wv.addEventListener('found-in-page', (e) => this.onFound(t, e.result));
    wv.addEventListener('ipc-message', (e) => this.onPageMessage(t, e.channel, e.args));
    wv.addEventListener('dom-ready', () => {
      const s = this.state(t);
      if (s.open) this.send(t, 'find:armed', true);
    });
    wv.addEventListener('did-start-loading', () => {
      this.state(t).stepped = false;
    });
    wv.addEventListener('did-stop-loading', () => this.onLoaded(t));
    wv.addEventListener('did-navigate', (e) => this.onNavigate(t, e.url));
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) this.state(t).url = e.url;
    });
  }

  private onPageMessage(t: Tab, channel: string, args: unknown[]): void {
    if (REPLIES.has(channel)) {
      const [id, ...rest] = args as [number, ...unknown[]];
      this.waiters.get(id)?.(...rest);
    } else if (channel === 'find:page-event') {
      this.onPageEvent(t, args[0] as 'scroll' | 'wheel' | 'menu');
    }
  }

  /** Scrolling, the wheel or a right-click send the ring away; Chromium's own jump doesn't. */
  private onPageEvent(t: Tab, kind: 'scroll' | 'wheel' | 'menu'): void {
    const s = this.state(t);
    const now = performance.now();
    const ours = kind === 'scroll' && now - s.lastResultAt < 300;
    if (!ours) s.stepped = true;
    if (t.id !== this.b.activeId) return;
    if (kind !== 'scroll' || now - this.ring.shownAt > 150) this.ring.cancel();
    if (!ours) this.face.setUnder(false);
  }

  private onNavigate(t: Tab, url: string): void {
    const s = this.state(t);
    const reload = url.split('#')[0] === s.url.split('#')[0];
    s.url = url;
    if (s.session) {
      // Chromium carries a live session over to the new document (highlighting it) and answers for
      // it under the old request id. Stop it now and ignore what it has already sent. After this
      // stop Chromium can answer the next new session with 0 of 0 (seen after a tab switch), so
      // that session is asked once more if it finds nothing.
      this.stop(t, 'clearSelection');
      s.staleBelow = s.requestId + 1;
      s.retryEmpty = true;
    }
    s.session = null;
    s.ord = s.total = 0;
    s.searched = false;
    s.rect = null;
    if (!s.open) return;
    if (reload) {
      // Reload keeps the query and runs it again once the page has loaded.
      s.rerun = true;
      this.refreshCount(t, null);
      return;
    }
    // Another document: find closes (its session is already stopped) and keeps the query.
    this.close(t, 'clearSelection', { focusPage: this.face.hasFocus(), stop: false });
  }

  /** One re-run when loading stops, unless the user has stepped or scrolled meanwhile. */
  private onLoaded(t: Tab): void {
    const s = this.state(t);
    const rerun = s.rerun && s.open && !!s.query && !s.stepped;
    s.rerun = false;
    if (rerun) this.search(t);
    else this.refreshCount(t, null);
  }

  private stop(t: Tab, action: StopAction): void {
    try {
      this.webview(t)?.stopFindInPage(action);
    } catch {
      /* not attached */
    }
  }

  // ---- actions ----

  private find(): void {
    const t = this.b.active();
    if (!t) return;
    // Element full screen passes Ctrl+F to the page; Home has no page, so it opens the address field.
    if (document.body.classList.contains('element-fullscreen')) return;
    if (t.kind === 'home') {
      this.b.editAddress();
      return;
    }
    if (this.b.omni.open) this.b.omni.close();
    const s = this.state(t);
    if (s.open && this.face.mode === 'open' && this.face.tabId === t.id) {
      const parked = !this.face.hasFocus();
      this.face.focusField(true); // again: select all, no motion
      // From the page, a selection made there since takes over the field, as when opening.
      if (parked) void this.refill(t, s);
      return;
    }
    void this.open(t, { parked: false });
  }

  /** F3, Shift+F3, Ctrl+G, Ctrl+Shift+G: step; with find closed, reopen it parked and step. */
  private findAgain(dir: Dir): void {
    const t = this.b.active();
    if (!t || t.kind !== 'web' || document.body.classList.contains('element-fullscreen')) return;
    const s = this.state(t);
    if (s.open) {
      this.step(t, dir, true);
      return;
    }
    if (!s.query && !this.windowQuery) {
      void this.open(t, { parked: false });
      return;
    }
    void this.open(t, { parked: true, step: dir });
  }

  private async open(t: Tab, opts: { parked: boolean; step?: Dir }): Promise<void> {
    if (!t.webview) return;
    const s = this.state(t);
    s.open = true;
    s.query = s.query || this.windowQuery;
    this.typedSinceOpen = false;
    this.face.setQuery(s.query);
    this.face.setCase(s.matchCase);
    this.face.setCount(s, this.loadingFor(t), null);
    this.face.show(t, 'open', this.barHidden());
    // The field has focus from the first frame, so typing never waits.
    if (!opts.parked) this.face.focusField(true);
    this.face.setFocused(this.face.hasFocus());
    this.send(t, 'find:armed', true);

    const [picked, sel] = await this.askSelection(t);
    if (!s.open || this.typedSinceOpen || this.b.activeId !== t.id) return;
    if (!opts.parked && picked && picked !== s.query) this.prefill(s, picked);
    if (s.query) this.windowQuery = s.query;
    this.search(t, this.anchorFor(t, s, sel));
    if (opts.step && s.query) {
      // Step once the new session has found its first match.
      s.inFlight = true;
      s.queued = opts.step;
      this.armFlightTimer(s, t);
    }
  }

  /** Ctrl+F with find parked: a selection made in the page since find last closed replaces the query. */
  private async refill(t: Tab, s: FindState): Promise<void> {
    this.typedSinceOpen = false;
    const [picked, sel] = await this.askSelection(t);
    if (!s.open || this.typedSinceOpen || this.b.activeId !== t.id || !picked || picked === s.query) return;
    this.prefill(s, picked);
    this.windowQuery = picked;
    this.search(t, this.anchorFor(t, s, sel));
  }

  /** The page's pre-fill (a fresh one-line selection) and where its current selection is. */
  private askSelection(t: Tab): Promise<[string | null, Anchor | null]> {
    return this.ask<[string | null, Anchor | null]>(t, 'find:selection-request', 120, [null, null]);
  }

  private prefill(s: FindState, text: string): void {
    s.query = text;
    this.face.setQuery(text);
    if (this.face.hasFocus()) this.face.focusField(true);
  }

  /** A selected match (the pre-fill, or the match Esc left selected) becomes the active one. */
  private anchorFor(t: Tab, s: FindState, sel: Anchor | null): Rect | null {
    if (!sel || !s.query) return null;
    const same = s.matchCase ? sel.text === s.query : sel.text.toLowerCase() === s.query.toLowerCase();
    return same ? this.pageToWindow(t, sel) : null;
  }

  /** opts.stop false: the session is already stopped (navigation; see onNavigate). */
  private close(t: Tab, action: StopAction, opts: { focusPage: boolean; fade?: boolean; stop?: boolean }): void {
    const s = this.state(t);
    if (!s.open) return;
    s.open = false;
    if (s.query) this.windowQuery = s.query;
    // The typing timers and the ring belong to the tab in the face; another tab closing leaves them.
    if (this.face.tabId === t.id) {
      this.cancelTimers();
      this.ring.cancel();
    }
    window.clearTimeout(s.flightTimer);
    s.inFlight = false;
    s.queued = 0;
    const active = t.id === this.b.activeId;
    if (opts.focusPage && active) this.b.focusPage();
    if (opts.stop !== false) {
      // Chromium clicks the match only if the page has focus by then, so wait for the page to say so.
      if (action === 'activateSelection') void this.ask(t, 'find:focus-request', 300, []).then(() => this.stop(t, action));
      else this.stop(t, action);
    }
    this.send(t, 'find:closed');
    s.session = null;
    s.ord = s.total = 0;
    s.searched = false;
    s.rect = null;
    s.ringKey = '';
    if (this.face.tabId === t.id) this.face.hide(opts.fade ? 'fade' : 'morph', this.barHidden());
  }

  /**
   * Ctrl+Q in the field: close find keeping the match selected, then peek the link that holds it.
   * The page answers once it has focus and Chromium has turned the match into the selection.
   */
  async closeAndPeek(): Promise<void> {
    const t = this.b.active();
    if (!t || !this.state(t).open || this.face.tabId !== t.id) return;
    this.close(t, 'keepSelection', { focusPage: true });
    await this.ask(t, 'find:focus-request', 300, []);
    let [link] = await this.ask<[PageLink | null]>(t, 'find:selected-link', 200, [null]);
    if (!link) {
      await new Promise((r) => window.setTimeout(r, 60));
      [link] = await this.ask<[PageLink | null]>(t, 'find:selected-link', 200, [null]);
    }
    if (link && t.id === this.b.activeId) window.vitrePeek?.open(link.href, this.pageToWindow(t, link));
  }

  private escape(fieldLayer: boolean): boolean {
    const t = this.b.active();
    if (!t || !this.state(t).open || this.face.tabId !== t.id) return false;
    if (this.face.hasFocus() !== fieldLayer) return false;
    this.close(t, 'keepSelection', { focusPage: true });
    return true;
  }

  /**
   * F6 moves between the find field and the page while find is open. Ctrl+L and Alt+D share the
   * focusAddress action, so tell them apart by the event being dispatched: a chrome keydown says
   * which key; a page-first key arrives as the webview's ipc-message; F6 from a page comes from the
   * main process with no DOM event at all.
   */
  private f6(): boolean {
    const t = this.b.active();
    if (!t || !this.state(t).open || this.face.mode !== 'open' || this.face.tabId !== t.id) return false;
    const ev = window.event;
    const isF6 = ev instanceof KeyboardEvent ? ev.key === 'F6' : ev === undefined;
    if (!isF6) return false;
    if (this.face.hasFocus()) this.b.focusPage();
    else this.face.focusField(true);
    return true;
  }

  private toggleCase(t: Tab): void {
    const s = this.state(t);
    if (!s.open) return;
    s.matchCase = !s.matchCase;
    this.face.setCase(s.matchCase);
    if (s.query) this.search(t);
  }

  // ---- typing ----

  private onInput(): void {
    const t = this.b.active();
    if (!t || this.face.tabId !== t.id) return;
    const s = this.state(t);
    this.typedSinceOpen = true;
    s.query = this.face.input.value;
    if (s.query) this.windowQuery = s.query;
    if (this.composing) return; // searches when the composition ends
    this.scheduleSearch(t);
  }

  private onCompose(on: boolean): void {
    this.composing = on;
    this.face.setComposing(on);
    // The composition's final text: search it now (an input event may or may not follow).
    if (!on) this.onInput();
  }

  /**
   * One request per frame. Short queries need no hold of our own: Chromium already holds queries
   * under four characters for about 400 ms before it searches.
   */
  private scheduleSearch(t: Tab): void {
    const s = this.state(t);
    window.cancelAnimationFrame(this.searchRaf);
    window.clearTimeout(this.pauseTimer);
    if (!s.query) {
      this.search(t);
      return;
    }
    this.searchRaf = window.requestAnimationFrame(() => this.search(t));
    // Once typing pauses, the ring lands if the active match changed (when the answer is in).
    this.pauseTimer = window.setTimeout(() => {
      if (!s.open) return;
      if (!s.searched) this.landNext = 'ring';
      else if (s.ord > 0 && s.rect && this.ringKey(s) !== s.ringKey) void this.land(t, 'ring');
    }, TYPE_PAUSE_MS);
  }

  private cancelTimers(): void {
    window.cancelAnimationFrame(this.searchRaf);
    window.clearTimeout(this.pauseTimer);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    const t = this.b.active();
    if (!t) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (!e.repeat) this.close(t, 'activateSelection', { focusPage: true });
      } else if (plain) {
        this.step(t, e.shiftKey ? -1 : 1, true);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!e.repeat && plain && !e.shiftKey) this.b.escape();
    } else if (this.isAltC(e)) {
      e.preventDefault();
      if (!e.repeat) this.toggleCase(t);
    } else if (plain && !e.shiftKey && SCROLL_KEYS[e.key]) {
      e.preventDefault();
      this.send(t, 'find:scroll', SCROLL_KEYS[e.key]);
    }
  }

  /** Alt+C, never with Ctrl or AltGr, so AltGr+C still types. Letters follow the key's label. */
  private isAltC(e: KeyboardEvent): boolean {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.getModifierState('AltGraph')) return false;
    return /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() === 'c' : e.code === 'KeyC';
  }

  // ---- Chromium requests ----

  /** A new find session for the current query (or clear everything for an empty field). */
  private search(t: Tab, anchor: Rect | null = null): void {
    const s = this.state(t);
    const shown = this.face.tabId === t.id;
    window.clearTimeout(s.flightTimer);
    s.inFlight = false;
    s.queued = 0;
    s.stepDir = 0;
    s.anchor = anchor;
    // The pending keystroke search, the landing and the ring belong to the tab in the face.
    if (shown) {
      window.cancelAnimationFrame(this.searchRaf);
      this.landNext = null;
      this.face.setUnder(false);
    }
    const wv = this.webview(t);
    if (!s.query) {
      if (s.session) this.stop(t, 'clearSelection');
      s.session = null;
      s.ord = s.total = 0;
      s.searched = false;
      s.rect = null;
      if (shown) this.ring.cancel();
      this.refreshCount(t, null);
      return;
    }
    if (!wv) {
      s.rerun = true; // the page isn't attached yet: search once it has loaded
      return;
    }
    try {
      this.request(t, wv, s, { findNext: true });
      s.session = sessionKey(s);
      s.sessionId = s.requestId;
      s.sessionAt = performance.now();
      if (this.loadingFor(t)) s.rerun = true;
      // Until this session answers, nothing is known about it (the counter keeps its last text).
      s.searched = false;
    } catch {
      /* not attached */
    }
  }

  private step(t: Tab, dir: Dir, fromKeys: boolean): void {
    const s = this.state(t);
    if (!s.open || !s.query) return;
    const shown = this.face.tabId === t.id;
    if (fromKeys && shown) this.face.echo(dir);
    if (s.session !== sessionKey(s)) {
      // Enter before the typed query went out: search now and land on its first match.
      this.search(t);
      if (shown) this.landNext = 'ring';
      return;
    }
    if (!s.searched) {
      // The session hasn't answered yet (Chromium holds short queries for ~400 ms), and Chromium
      // drops a step sent meanwhile: land on the first match when it comes. Restart a lost session.
      if (performance.now() - s.sessionAt > 1000) this.search(t);
      if (shown) this.landNext = 'ring';
      return;
    }
    if (s.final && s.total === 0) {
      if (shown) this.face.pulse();
      return;
    }
    if (s.inFlight) {
      s.queued = dir;
      return;
    }
    const wv = this.webview(t);
    if (!wv) return;
    const now = performance.now();
    s.rapid = now - this.lastStepAt < RAPID_MS;
    this.lastStepAt = now;
    s.stepDir = dir;
    s.stepped = true;
    if (shown) {
      // Key repeat still keeps the match clear of the glass, but the ring waits for a pause.
      this.landNext = s.rapid ? 'guard' : 'ring';
      this.ring.cancel();
      this.face.setUnder(false);
    }
    try {
      this.request(t, wv, s, { findNext: false, forward: dir > 0 });
      s.inFlight = true;
      this.armFlightTimer(s, t);
    } catch {
      /* not attached */
    }
  }

  /**
   * Every find request goes out here. The page first marks its scroll position: Chromium reports a
   * match it jumps to where it was before the jump, and land() asks the page how far it moved.
   */
  private request(t: Tab, wv: WebviewTag, s: FindState, opts: { findNext: boolean; forward?: boolean }): void {
    this.send(t, 'find:baseline');
    s.requestId = wv.findInPage(s.query, { ...opts, matchCase: s.matchCase });
  }

  /** Never wait forever for a step's reply. */
  private armFlightTimer(s: FindState, t: Tab): void {
    window.clearTimeout(s.flightTimer);
    s.flightTimer = window.setTimeout(() => this.settle(s, t), 700);
  }

  private settle(s: FindState, t: Tab): void {
    if (!s.inFlight) return;
    s.inFlight = false;
    window.clearTimeout(s.flightTimer);
    const next = s.queued;
    s.queued = 0;
    if (next && s.open) this.step(t, next, false);
  }

  private onFound(t: Tab, r: Electron.FoundInPageResult): void {
    const s = this.state(t);
    if (!s.open || r.requestId < s.requestId || r.requestId < s.staleBelow) return;
    if (s.retryEmpty && r.requestId === s.sessionId) {
      s.retryEmpty = false;
      if (r.matches <= 0 && this.retrySession(t, s)) return;
    }
    s.lastResultAt = performance.now();
    const prevOrd = s.ord;
    s.total = Math.max(0, r.matches);
    if (r.activeMatchOrdinal > 0) s.ord = r.activeMatchOrdinal;
    else if (s.total === 0) s.ord = 0;
    s.final = r.finalUpdate;
    s.searched = true;
    const a = r.selectionArea;
    if (a && a.width > 0 && a.height > 0) s.rect = this.toWindow(t, a);
    if (s.total === 0) s.rect = null;
    if (s.anchor && (r.finalUpdate || r.activeMatchOrdinal > 0)) {
      const anchor = s.anchor;
      s.anchor = null;
      if (s.rect && r.activeMatchOrdinal > 0 && !near(s.rect, anchor)) {
        this.correct(t, s);
        return;
      }
    }

    let roll: 'up' | 'down' | null = null;
    if (s.stepDir && prevOrd > 0 && s.ord !== prevOrd && r.activeMatchOrdinal > 0) {
      roll = s.rapid ? null : s.ord > prevOrd ? 'up' : 'down';
      this.announceWrap(t, s, prevOrd);
    }
    this.refreshCount(t, roll);
    if (r.activeMatchOrdinal > 0 || r.finalUpdate) {
      s.stepDir = 0;
      if (s.inFlight) this.settle(s, t);
    }
    // A queued step just went out: the ring waits for its answer, not this in-between match.
    if (s.inFlight) return;
    const landing = this.landNext;
    if (landing && s.rect && r.activeMatchOrdinal > 0 && t.id === this.b.activeId && this.face.tabId === t.id) {
      this.landNext = null;
      void this.land(t, landing);
    }
  }

  /** Ask the current session's opening request again, leaving everything waiting on it in place. */
  private retrySession(t: Tab, s: FindState): boolean {
    const wv = this.webview(t);
    if (!wv || !s.query) return false;
    try {
      this.request(t, wv, s, { findNext: true });
      s.sessionId = s.requestId;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Chromium starts a new session after the selection while the page isn't focused (the field has
   * focus), so the selected match is one step back: take it quietly, with no roll and no ring.
   */
  private correct(t: Tab, s: FindState): void {
    const wv = this.webview(t);
    if (!wv) return;
    try {
      this.request(t, wv, s, { findNext: false, forward: false });
      s.inFlight = true;
      this.armFlightTimer(s, t);
    } catch {
      /* not attached */
    }
  }

  private announceWrap(t: Tab, s: FindState, prevOrd: number): void {
    if (this.face.tabId !== t.id) return;
    if (s.stepDir > 0 && s.ord < prevOrd) this.face.announce('Wrapped to first match');
    else if (s.stepDir < 0 && s.ord > prevOrd) this.face.announce('Wrapped to last match');
  }

  private refreshCount(t: Tab, roll: 'up' | 'down' | null): void {
    if (this.face.tabId === t.id) this.face.setCount(this.state(t), this.loadingFor(t), roll);
  }

  /** selectionArea is in the page's viewport, in DIPs with page zoom applied. */
  private toWindow(t: Tab, a: Rect): Rect {
    const box = t.webview?.getBoundingClientRect();
    return { x: a.x + (box?.x ?? 0), y: a.y + (box?.y ?? 0), width: a.width, height: a.height };
  }

  /** A rectangle the page measured, in CSS pixels. */
  private pageToWindow(t: Tab, r: Rect): Rect {
    const z = t.zoom || 1;
    return this.toWindow(t, { x: r.x * z, y: r.y * z, width: r.width * z, height: r.height * z });
  }

  /** The match lies wholly inside the page's view (Chromium never jumps to such a match). */
  private inView(t: Tab, r: Rect): boolean {
    const box = t.webview?.getBoundingClientRect();
    if (!box) return false;
    return r.x >= box.left - 1 && r.y >= box.top - 1 && r.x + r.width <= box.right + 1 && r.y + r.height <= box.bottom + 1;
  }

  private ringKey(s: FindState): string {
    return s.rect ? `${s.ord}:${Math.round(s.rect.x)},${Math.round(s.rect.y)}` : '';
  }

  // ---- the landing ring and the scroll guard ----

  /** Where the visible chrome covers the page, inflated 12 px. */
  private chromeZones(): Rect[] {
    const zones: Rect[] = [];
    if (!this.barHidden()) {
      const l = this.b.bar.layout;
      zones.push({ x: l.left - 12, y: 0, width: l.right - l.left + 24, height: 12 + PILL_H + 12 });
      const ctl = document.getElementById('winctl')?.getBoundingClientRect();
      if (ctl) zones.push({ x: ctl.x - 12, y: 0, width: ctl.width + 24, height: ctl.bottom + 12 });
    } else if (this.face.mode === 'open') {
      const f = this.face.el.getBoundingClientRect();
      zones.push({ x: f.x - 12, y: 0, width: f.width + 24, height: f.bottom + 12 });
    }
    return zones;
  }

  /**
   * After a step: if the match is under the glass, scroll it clear (its top to y 92); on fixed or
   * sticky content the pill drops to its parked tint instead. Then the ring lands ('ring' only).
   */
  private async land(t: Tab, how: Landing): Promise<void> {
    const s = this.state(t);
    let r = s.rect;
    if (!r || t.id !== this.b.activeId) return;
    if (!this.inView(t, r)) {
      // Chromium jumped to an off-screen match and reported where it was before: follow the page.
      const zoom = t.zoom || 1;
      const [dx, dy] = await this.ask<[number, number]>(t, 'find:delta', 400, [0, 0]);
      if (!s.open || s.rect !== r || t.id !== this.b.activeId) return;
      r = { ...r, x: r.x - (Number(dx) || 0) * zoom, y: r.y - (Number(dy) || 0) * zoom };
      s.rect = r;
      // Still out of view: it was scrolled inside a box of its own. No guard, no ring.
      if (!this.inView(t, r)) return;
    }
    const hit = this.chromeZones().some((z) => r!.x < z.x + z.width && r!.x + r!.width > z.x && r!.y < z.y + z.height && r!.y + r!.height > z.y);
    if (hit) {
      const box = t.webview?.getBoundingClientRect();
      const zoom = t.zoom || 1;
      const cx = (r.x + r.width / 2 - (box?.x ?? 0)) / zoom;
      const cy = (r.y + r.height / 2 - (box?.y ?? 0)) / zoom;
      const dy = (r.y - GUARD_Y) / zoom;
      const [moved, pinned] = await this.ask<[number, boolean]>(t, 'find:guard', 200, [0, false], cx, cy, dy, s.query, s.matchCase);
      if (!s.open || s.rect !== r || t.id !== this.b.activeId) return;
      if (pinned) this.face.setUnder(true);
      r = { ...r, y: r.y - (Number(moved) || 0) * zoom };
      s.rect = r;
    }
    if (how !== 'ring') return;
    s.ringKey = this.ringKey(s);
    this.ring.show(r);
  }

  // ---- the active tab ----

  /** Keep the face on the active tab's pill, or away when that tab isn't finding. */
  private syncActive(): void {
    const t = this.b.active();
    const s = t ? this.states.get(t.id) : undefined;
    const open = !!(t && s?.open && t.kind === 'web');
    if (this.face.tabId !== (t?.id ?? null)) {
      if (this.face.mode !== 'hidden') {
        // The ring and a pending landing were for the tab leaving the front (its last keystroke's
        // search still goes out next frame).
        this.ring.cancel();
        window.clearTimeout(this.pauseTimer);
        this.landNext = null;
        this.face.hide('instant');
      }
      if (open && t && s) this.restore(t, s);
      return;
    }
    if (t && this.face.mode !== 'hidden') {
      this.face.follow();
      this.face.syncTab(t);
      if (s) this.face.setCount(s, this.loadingFor(t), null);
    }
  }

  /** A tab that was finding comes back to the front: its face returns, parked. */
  private restore(t: Tab, s: FindState): void {
    this.face.setQuery(s.query);
    this.face.setCase(s.matchCase);
    this.face.setComposing(false);
    this.face.setCount(s, this.loadingFor(t), null);
    this.face.show(t, 'restore', this.barHidden());
    this.face.setFocused(this.face.hasFocus());
  }
}

const SCROLL_KEYS: Record<string, 'up' | 'down' | 'pageUp' | 'pageDown'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
};

let controller: FindController | null = null;

// Ctrl+Q in the find field closes find and peeks the match's link. The Browser's own key handler
// (capture, on window) would hand Ctrl+Q to Peek first, with whatever link the page had, so this
// listener is added as the bundle loads, ahead of it. An open menu keeps its keys.
window.addEventListener(
  'keydown',
  (e) => {
    if (!controller || e.target !== document.getElementById('find-input') || document.querySelector('[role="menu"]')) return;
    const composing = e.isComposing || e.keyCode === 229;
    const binding = match({ key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, repeat: false, composing });
    if (binding?.action !== 'peekLink') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) void controller.closeAndPeek();
  },
  true,
);

export function install(b: Browser): void {
  controller = new FindController(b);
}
