// The key router: one per browser window. Firefox's own shortcuts are made inert and only Deer's
// map (src/shared/shortcuts.ts, from design/keymap.json) runs.
// Recipe: spikes/keys/RESULT.md with the verifier's corrections; prototype verify/vitre-keys-fixed.js.
//
// How one keydown travels
//   1. Guards: nothing fires during IME composition, with AltGraph, with Ctrl+Alt together, or with
//      the Windows key. Letters match by virtual key, digits by physical key (shortcuts.ts).
//   2. Browser-first bindings are taken in the chrome capture phase: preventDefault() there also
//      stops the key from being sent to the page, so the page sees neither keydown nor keyup.
//   3. Page-first bindings do nothing on keydown. On keypress the router asks Gecko for the event
//      back once the page is done (event.requestReplyFromRemoteContent()); the reply comes with
//      defaultPrevented set when the page, or a default action in the page (editing, scrolling,
//      Tab, an accesskey), used the key. Only an unused key runs Deer's action. A page that calls
//      preventDefault() on keydown gets no keypress at all, so no reply comes and nothing runs.
//      The binding and the decision are remembered per physical key until its next keydown,
//      because the reply arrives after the keyup, and a keypress has no virtual key to match again.
//   4. Focus in Deer's own UI or an in-process page (Home, about: pages): page-first bindings run
//      from a system-group keypress listener, after the focused widget and the editor had the key.
//      A Deer widget that handles a bound key itself must preventDefault() it on keydown.
//   5. Under keyboard lock (element full screen with keyboardLock: 'browser') browser-first keys go
//      to the page first too: reply requested on keydown, keypress stopped in chrome, action on the
//      keydown reply. F11 stays browser-first; holding Esc to leave is Gecko's own.
//   6. Firefox: every <key> is parked (extension command keysets stay), and keys that
//      ShortcutUtils reads as a tab action (also with the Windows key held) are hidden from the
//      system group, where tabbox and tabbrowser listen.
//
// For feature modules (b.keys)
//   b.keys.addHook(fn)     fn(binding | null, event) runs on every keydown that passed the guards,
//                          before the router acts. Return
//                            'browser' / 'page'   this press takes that priority (F11 while full
//                                                 screen, the second Esc on a peek);
//                            'pass'               the router leaves the key completely alone: your
//                                                 own listener on the focused element handles it;
//                            'swallow'            the key goes nowhere (you handled it in the hook:
//                                                 a menu or the latched switcher taking global keys);
//                            undefined            no opinion.
//                          The first hook with an opinion wins. Returns a remover.
//                          Hooks run in the order they were added (module install order), except
//                          b.keys.addHook(fn, { first: true }): before every hook added without it,
//                          for a surface that takes every key while it is up (an open menu: its
//                          F6 must not reach find's or Peek's F6 hook underneath it).
//   b.keys.current         while an action runs from a key: { action, arg, spec, how, repeat,
//                          browser } where browser is the focused <browser> (tab or peek), or null.
//   b.keys.ctrlHeld        Ctrl is down.
//   [data-key-capture]     while focus is inside an element with this attribute the router does
//                          nothing at all (Settings' shortcut capture field reads raw keys).
//   Events                 Ctrl released (or the window deactivated): b.commitMru(), then 'ctrl-up'
//                          with the reason: 'key' (the Control keyup) or 'blur' (the window lost
//                          focus, so no keyup will come: the switcher cancels instead of committing).
//   Esc                    runs b.escape() (the ladder) when the page did not use it. A page <dialog>,
//                          popover, alert() prompt or an open native panel takes that press instead;
//                          a tab prompt (alert, print preview) does not take an Esc pressed in
//                          Deer's own layer drawn over it (a Settings panel opened over an alert).
//                          The prompts of the topmost page count: the selected tab's, and those of
//                          an open peek (window.vitrePeek.browser()), whose prompts show in its sheet.
//   Hardware keys         Browser Back/Forward/Refresh/Stop/Search/Home keys and the mouse side
//                          buttons arrive as AppCommand events and run the same actions.
//   b.keys.bindings()      the map as it is now, rebinds applied: [{ action, arg, spec, priority,
//                          repeat }] (Settings > Keyboard shortcuts lists it).
//   b.keys.log             the last routed keys, for tests and diagnostics.
//   b.keys.closePanels()   hide Firefox's open panels (not menus). A browser-first action does this
//                          itself: the app menu must not stay hanging over the new tab's field.
//   Late replies           a page-first key is answered by the page it was pressed in. The reply is
//                          dropped ("stale reply dropped" in the log) when the user moved on before a
//                          slow (hung) page answered: another tab or page is the topmost one, keyboard
//                          focus left that page (a Deer panel, field or the switcher took it), or the
//                          answer comes more than STALE_REPLY_MS after the key went down. The key
//                          never acts on whatever the user opened in the meantime.
import { BINDINGS, find, keyInput, specOf, type ActionId, type Binding, type Priority } from '../shared/shortcuts';
import { HOME_URL } from '../shared/url';
import type { Browser } from './browser';
import * as fx from './firefox';

export type KeyVerdict = Priority | 'pass' | 'swallow' | undefined | void;
export type KeyHook = (binding: Binding | null, event: KeyboardEvent) => KeyVerdict;
export type KeyHow = 'browser-first' | 'page-first/reply' | 'page-first/local' | 'lock/reply' | 'app-command';

export interface KeyRoute {
  action: ActionId;
  arg?: number;
  /** "Ctrl+Shift+T", or the AppCommand name. */
  spec: string;
  how: KeyHow;
  repeat: boolean;
  /** The focused page element (a tab's or a peek's <browser>), or null when focus is in Deer's UI. */
  browser: XULBrowser | null;
}

type Mode = 'browser' | 'page' | 'lock' | 'swallow';

/** Hardware browser keys and mouse side buttons (AppCommand event.command) -> action. */
const APP_COMMANDS: Record<string, ActionId | null> = {
  Back: 'back',
  Forward: 'forward',
  Reload: 'reload',
  Stop: 'stop',
  Search: 'focusAddress',
  Home: 'goHome',
  New: 'newTab',
  Close: 'closeTab',
  Find: 'find',
  Print: 'print',
  Save: 'savePage',
  // Firefox would open its bookmarks sidebar, help site, file dialog or mail client: not Deer's.
  Bookmarks: null,
  Help: null,
  Open: null,
  SendMail: null,
};

/** A page's answer to a page-first key later than this (it was hung) acts on nothing. */
const STALE_REPLY_MS = 2000;
const codeOf = (e: KeyboardEvent): string => e.code || e.key;
const isRemote = (e: Event): boolean => (e.target as any)?.isRemoteBrowser === true;
const asBrowser = (target: EventTarget | null): XULBrowser | null => ((target as Element | null)?.localName === 'browser' ? (target as XULBrowser) : null);
const inCaptureField = (e: Event): boolean => !!(e.target as Element | null)?.closest?.('[data-key-capture]');

export class Keys {
  current: KeyRoute | null = null;
  ctrlHeld = false;
  /** <key> elements parked in this window at install. */
  parked = 0;
  readonly log: string[] = [];

  private hooks: KeyHook[] = [];
  /** Per physical key, set on its keydown: the binding and how this press is routed. */
  private bind = new Map<string, Binding>();
  private mode = new Map<string, Mode>();
  private downAt = new Map<string, number>();
  /** When each page-first key last went down, key repeats included (the stale-reply guard). */
  private lastDown = new Map<string, number>();
  /** Keys whose keydown never reached the page: their keyup must not either. */
  private swallowUp = new Set<string>();
  /** Events Firefox's system-group listeners must not see. */
  private hidden = new WeakSet<Event>();
  /** When a page last reported that Esc landed on one of its own layers (dialog, popover). */
  private pageLayer = new WeakMap<XULBrowser, number>();
  /** Native popups that are showing: menus own the keyboard, a panel owns Esc. */
  private popups = new Set<any>();

  constructor(private b: Browser) {}

  bindings(): { action: ActionId; arg?: number; spec: string; priority: Priority; repeat: boolean }[] {
    return BINDINGS.map((x) => ({ action: x.action, arg: x.arg, spec: specOf(x), priority: x.priority, repeat: !!x.repeat }));
  }

  addHook(fn: KeyHook, opts: { first?: boolean } = {}): () => void {
    if (opts.first) this.hooks.unshift(fn);
    else this.hooks.push(fn);
    return () => {
      this.hooks = this.hooks.filter((h) => h !== fn);
    };
  }

  install(): void {
    const b = this.b;
    this.parked = fx.parkKeysets();

    // Default group, capture, on the window: before every other listener of the chrome document and
    // before the key is sent to a remote page.
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('keypress', (e) => this.onKeyPress(e), true);
    window.addEventListener('keyup', (e) => this.onKeyUp(e), true);
    // System group, capture: before Firefox's own system-group handlers (tabbrowser, tabbox, the XUL
    // <key> listener that still serves extension commands). Stopping here does not stop the key
    // from going to the page and does not affect the reply.
    for (const type of ['keydown', 'keypress', 'keyup']) {
      window.addEventListener(type, (e) => this.onSystemCapture(e as KeyboardEvent), { capture: true, mozSystemGroup: true } as AddEventListenerOptions);
    }
    // System group, bubble: after the focused widget and the editor had their turn.
    window.addEventListener('keypress', (e) => this.onKeyPressLocal(e), { mozSystemGroup: true } as AddEventListenerOptions);

    // If Ctrl is released while another application has focus no keyup arrives.
    window.addEventListener('deactivate', () => {
      this.reset();
      this.ctrlHeld = false;
      this.release('blur');
    });

    // Registered before Firefox adds its own handler (browser-init.js, at load), so this one runs
    // first and stops it; delayed() removes Firefox's as well.
    window.addEventListener('AppCommand', (e) => this.onAppCommand(e as Event & { command?: string }), true);

    for (const type of ['popupshown', 'popuphidden']) {
      window.addEventListener(
        type,
        (e) => {
          const popup = e.target as any;
          if (popup?.localName !== 'menupopup' && popup?.localName !== 'panel') return;
          if (type === 'popupshown') this.popups.add(popup);
          else this.popups.delete(popup);
        },
        true
      );
    }

    b.on('page-message', (_tab, name, _data, from) => {
      if (name === 'keys:esc-layer') this.pageLayer.set(from.browser, performance.now());
    });
  }

  /** Firefox's delayed startup has run: its own AppCommand handler exists now. */
  delayed(): void {
    fx.dropAppCommandHandler();
    this.parked += fx.parkKeysets();
  }

  // ---- state ----

  private reset(): void {
    this.bind.clear();
    this.mode.clear();
    this.downAt.clear();
    this.lastDown.clear();
    this.swallowUp.clear();
  }

  private forget(code: string): void {
    this.bind.delete(code);
    this.mode.delete(code);
  }

  private release(reason: 'key' | 'blur'): void {
    this.b.commitMru();
    this.b.emit('ctrl-up', reason);
  }

  private note(text: string): void {
    this.log.push(text);
    if (this.log.length > 200) this.log.splice(0, 100);
  }

  /** chrome preventDefault also stops the key from being sent to the content process. */
  private take(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.hidden.add(e);
  }

  private popupOpen(kind: 'menupopup' | 'panel'): boolean {
    for (const p of this.popups) {
      if (!p.isConnected || (p.state !== 'open' && p.state !== 'showing')) {
        this.popups.delete(p);
        continue;
      }
      if (p.localName === kind) return true;
    }
    return false;
  }

  /**
   * Hide every open native panel (app menu, site information, bookmark editor...); menus are left
   * alone, and so is the permission doorhanger (#notification-popup): PopupNotifications answers a
   * raw hidePopup() on it by dismissing and showing its persistent prompt again
   * (PopupNotifications.sys.mjs _onPopupHidden -> _update). The doorhanger is suppressed while the
   * address field is open (fx.suppressDoorhangersWhile) and hidden on a tab switch by Firefox itself.
   */
  closePanels(): void {
    for (const p of [...this.popups]) {
      if (p.localName !== 'panel' || p.id === fx.DOORHANGER_ID) continue;
      try {
        if (p.isConnected && (p.state === 'open' || p.state === 'showing')) p.hidePopup();
      } catch {
        /* already going */
      }
      this.popups.delete(p);
    }
  }

  /**
   * A reply from the page for a page-first key belongs to the page it was pressed in. When that page
   * answers late (it was hung) and the user has moved on, the reply must not act on what is in front
   * now. True when the event's browser is the one page actions would act on, it still has keyboard
   * focus (nothing of Deer's took it: a panel, a field, the switcher), and the answer is not older
   * than STALE_REPLY_MS.
   */
  private replyIsCurrent(e: KeyboardEvent, code: string): boolean {
    const browser = asBrowser(e.target);
    if (!browser) return true; // Deer's own UI or an in-process page: the event never left the window
    const at = this.lastDown.get(code);
    if (at !== undefined && performance.now() - at > STALE_REPLY_MS) return false;
    const focused = document.activeElement;
    if (focused && focused !== browser && focused !== document.body && focused !== document.documentElement) return false;
    try {
      if (browser === fx.selectedBrowser()) return true;
    } catch {
      /* no selected browser */
    }
    const peek = window.vitrePeek?.browser?.() ?? null;
    return !!peek && browser === peek;
  }

  /** Esc belongs to something else at this step of the ladder: a prompt, a native panel, a page layer. */
  private escTaken(e: KeyboardEvent): boolean {
    // A tab prompt under Deer's layer (a panel over an alert) does not own an Esc pressed in that layer.
    const inVitre = this.b.root.contains(e.target as Node | null);
    // A peek's tab prompt (alert, print preview) shows in its sheet: it owns the Esc as a tab's does.
    const peek = window.vitrePeek?.browser?.() ?? null;
    const peekPrompt = !!peek && fx.browserDialogShowing(peek);
    if (((fx.dialogShowing() || peekPrompt) && !inVitre) || this.popupOpen('panel')) return true;
    // An in-process page (Home, about: pages): look at its document directly.
    const doc = (e.target as Node | null)?.ownerDocument;
    if (doc && doc !== document) {
      try {
        return !!doc.querySelector(':modal, :popover-open');
      } catch {
        return false;
      }
    }
    return false;
  }

  private verdict(binding: Binding | null, e: KeyboardEvent): KeyVerdict {
    for (const hook of [...this.hooks]) {
      try {
        const v = hook(binding, e);
        if (v) return v;
      } catch (err) {
        console.error('Deer: key hook failed', err);
      }
    }
    return undefined;
  }

  private run(binding: Binding, e: KeyboardEvent, how: KeyHow): void {
    if (e.repeat && !binding.repeat) return; // anything that closes, opens or toggles ignores repeat
    this.dispatch({ action: binding.action, arg: binding.arg, spec: specOf(binding), how, repeat: e.repeat, browser: asBrowser(e.target) });
  }

  private dispatch(route: KeyRoute): void {
    this.note(`ACTION ${route.action}${route.arg !== undefined ? `(${route.arg})` : ''} via ${route.spec} [${route.how}]${route.repeat ? ' repeat' : ''}`);
    // A browser-first key moves on (new tab, tab switch, window): an open panel is about the old state.
    if (route.how === 'browser-first' || route.how === 'app-command') this.closePanels();
    this.current = route;
    try {
      this.b.run(route.action, route.arg);
    } catch (err) {
      console.error(`Deer: action ${route.action} failed`, err);
    } finally {
      this.current = null;
    }
  }

  // ---- listeners ----

  private onKeyDown(e: KeyboardEvent): void {
    if (!e.isTrusted) return;
    if (e.key === 'Control') this.ctrlHeld = true;
    if (inCaptureField(e)) return;
    const code = codeOf(e);
    if ((e as any).isReplyEventFromRemoteContent) {
      this.onLockReply(e, code);
      return;
    }
    // A window-modal dialog or an open native menu owns the keyboard.
    if (fx.windowModalOpen() || this.popupOpen('menupopup')) {
      this.forget(code);
      return;
    }
    const binding = find({ ...keyInput(e), repeat: false });
    let mode = e.repeat ? this.mode.get(code) : undefined;
    if (!mode || mode === 'swallow' || this.bind.get(code) !== binding) {
      const verdict = this.verdict(binding, e);
      if (verdict === 'pass') {
        this.forget(code);
        return;
      }
      if (verdict === 'swallow') {
        this.take(e);
        this.swallowUp.add(code);
        this.forget(code);
        this.mode.set(code, 'swallow');
        return;
      }
      if (!binding) {
        this.forget(code);
        this.typeOnHome(e);
        return;
      }
      if (binding.key === 'Escape' && this.escTaken(e)) {
        this.forget(code);
        return;
      }
      // F11 can be kept by a page when it enters full screen, never when it leaves.
      const priority: Priority = verdict ?? (binding.action === 'fullscreen' && fx.inFullScreen() ? 'browser' : binding.priority);
      // Only keyboard lock hands browser-first keys to the page first.
      const locked = priority === 'browser' && !verdict && binding.priority === 'browser' && isRemote(e) && fx.keyboardLocked();
      mode = locked ? 'lock' : priority;
    }
    this.bind.set(code, binding as Binding);
    this.mode.set(code, mode);
    if (mode === 'browser') {
      this.take(e);
      this.swallowUp.add(code);
      this.run(binding as Binding, e, 'browser-first');
      return;
    }
    if (!e.repeat) this.downAt.set(code, performance.now());
    this.lastDown.set(code, performance.now());
    if (mode === 'lock') (e as any).requestReplyFromRemoteContent();
    // Nothing else happens on keydown. Firefox's own keydown handlers and extension <key>s must not
    // act on this first pass, before the page had the key.
    this.hidden.add(e);
  }

  /** Keyboard lock: the page had the keydown of a browser-first key and gave it back. */
  private onLockReply(e: KeyboardEvent, code: string): void {
    const binding = this.bind.get(code);
    if (!binding || this.mode.get(code) !== 'lock') return;
    if (e.defaultPrevented) {
      this.note(`page kept ${specOf(binding)}`);
      this.hidden.add(e);
      return;
    }
    if (!this.replyIsCurrent(e, code)) {
      this.note(`stale reply dropped ${specOf(binding)}`);
      this.hidden.add(e);
      this.forget(code);
      return;
    }
    this.take(e);
    this.run(binding, e, 'lock/reply');
  }

  private onKeyPress(e: KeyboardEvent): void {
    if (!e.isTrusted || inCaptureField(e)) return;
    const code = codeOf(e);
    const mode = this.mode.get(code);
    if (!mode) return;
    if (mode === 'swallow' || mode === 'browser') {
      this.take(e); // (a prevented keydown has no keypress; belt and braces)
      return;
    }
    const binding = this.bind.get(code);
    if (!binding) return;
    if (mode === 'lock') {
      // The page keeps its keydown; Gecko's own default for the keypress (Ctrl+Tab and F6 move
      // focus) must not run, and the action waits for the keydown reply.
      if (!(e as any).isReplyEventFromRemoteContent) this.take(e);
      return;
    }
    if (!isRemote(e)) return; // decided in onKeyPressLocal
    if (!(e as any).isReplyEventFromRemoteContent) {
      (e as any).requestReplyFromRemoteContent();
      this.hidden.add(e);
      return;
    }
    // Second pass: the page and its default actions had the key.
    if (e.defaultPrevented || this.pageLayerTook(binding, e, code)) {
      this.note(`page kept ${specOf(binding)}`);
      this.hidden.add(e);
      return;
    }
    // The page answered after the user moved to another tab: the key was for the old page only.
    if (!this.replyIsCurrent(e, code)) {
      this.note(`stale reply dropped ${specOf(binding)}`);
      this.hidden.add(e);
      this.forget(code);
      return;
    }
    this.take(e);
    this.run(binding, e, 'page-first/reply');
  }

  /** Esc closed a page's own dialog or popover: that press is used, whatever the reply says. */
  private pageLayerTook(binding: Binding, e: KeyboardEvent, code: string): boolean {
    if (binding.key !== 'Escape') return false;
    const browser = asBrowser(e.target);
    const at = browser ? this.pageLayer.get(browser) : undefined;
    return at !== undefined && at >= (this.downAt.get(code) ?? Infinity);
  }

  private onKeyPressLocal(e: KeyboardEvent): void {
    if (!e.isTrusted || e.defaultPrevented || isRemote(e) || inCaptureField(e)) return;
    const code = codeOf(e);
    const binding = this.bind.get(code);
    if (!binding || this.mode.get(code) !== 'page') return;
    e.preventDefault();
    this.run(binding, e, 'page-first/local');
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (!e.isTrusted) return;
    // bind / mode are NOT cleared here: the reply from the page can arrive after the keyup.
    if (this.swallowUp.delete(codeOf(e))) this.take(e);
    if (e.key === 'Control') {
      this.ctrlHeld = false;
      this.release('key');
    }
  }

  private onSystemCapture(e: KeyboardEvent): void {
    if (this.hidden.has(e)) {
      e.stopPropagation();
      return;
    }
    // Tab keys Firefox would act on by itself. The router takes the ones in Deer's map; this
    // also covers the same chords with the Windows key held, which the guards refuse to match.
    if (e.type !== 'keyup' && fx.systemAction(e) != null) e.stopPropagation();
  }

  private onAppCommand(e: Event & { command?: string }): void {
    const command = String(e.command ?? '');
    e.preventDefault();
    e.stopImmediatePropagation();
    const action = APP_COMMANDS[command];
    if (!action) {
      this.note(`app-command ${command} ignored`);
      return;
    }
    this.dispatch({ action, spec: command, how: 'app-command', repeat: false, browser: asBrowser(document.activeElement) });
  }

  /**
   * Typing on Home starts a search: the address field opens and takes focus during the keydown, so
   * the character itself lands in the field (dead keys and Shift included). Home has nothing else
   * to type into. Follows the typeToSearch setting.
   */
  private typeOnHome(e: KeyboardEvent): void {
    const b = this.b;
    if (!b.settings.typeToSearch || b.omni.open || e.repeat) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.key.length !== 1 || e.key === ' ') return;
    const t = b.active();
    if (!t || t.url !== HOME_URL) return;
    const doc = (e.target as Node | null)?.ownerDocument;
    let home: Document | null = null;
    try {
      home = t.browser.contentDocument ?? null;
    } catch {
      home = null;
    }
    if (!doc || doc !== home) return;
    b.editAddress('');
  }
}

export function installKeys(b: Browser): Keys {
  const keys = new Keys(b);
  keys.install();
  return keys;
}
