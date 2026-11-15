// macOS only: Deer's own native menu bar in every browser window, in place of Firefox's (owner's
// decision D2 of the Mac port plan; the approved board MacMenuReference). Windows never builds it.
// items.ts has the menus and how Firefox 157 makes XUL menus native; keyattr.ts the key equivalents.
// The app menu (Deer › About Deer … Quit Deer) and the menu bar macOS shows with no Deer window in
// front belong to the hidden window, which VitreShell gives Deer's menus (items.ts installHiddenMenus).
//
// One <menubar id="vitre-menubar"> per window, built whole at install (the window's
// DOMContentLoaded) and put after Firefox's #main-menubar, which is marked nonnative (VitreShell has
// already done so before the window's first layout). Firefox makes a window's menu bar native only
// after its document has loaded and its L10n is ready (xpfe/appshell/AppWindow.cpp OnChromeLoaded ->
// LoadNativeMenus, the first menubar:not([nonnative])), so Deer's is the one macOS shows.
//
// A click runs the Deer action the item's key runs (b.run), or the item's verb (Zoom, Bring All to
// Front, Deer on GitHub: items.ts runVerb). Edit's standard items run Firefox's own commands.
//
// Keys. Each item shows its action's key from the key router (b.keys.chordFor, rebinds applied, set
// again when a rebind changes) through a <key> outside every <keyset>: to Gecko's key handling it is
// only a label (keyattr.ts). The router consumes every key it acts on (keys.ts, "Menu bar"), and
// macOS runs the key equivalent of a Gecko window only for a keypress nobody consumed:
//   - before the window sees the key, GeckoNSMenu performKeyEquivalent: (widget/cocoa/nsMenuBarX.mm)
//     only flashes the menu title when a Gecko window is key (gMenuItemsExecuteCommands = NO: every
//     item answers with a dummy action);
//   - after, nsCocoaWindow::PostHandleKeyEvent (widget/cocoa/nsCocoaWindow.mm) runs the item. It is
//     called on keypress from EventStateManager::PostHandleKeyboardEvent, which returns early when
//     the keypress was consumed (nsEventStatus_eConsumeNoDefault), and from
//     BrowserParent::RecvReplyKeyEvent only when the page's reply was not defaultPrevented. A
//     keydown the router prevents has no keypress at all.
// So a key Deer acts on never runs its item a second time. One guard more makes the menu inert for
// the router's keys altogether: a key equivalent runs its item synchronously, inside the task that is
// handling the key (the menu is not open, so nsMenuX::ActivateItemAfterClosing calls DoCommand at
// once). A command that arrives while this window is handling a keydown or keypress, with ⌘, ⌃ or ⌥
// held, for an item whose key is the router's, is that key coming back unconsumed: the router, a
// surface its hook passed the key to ('pass'), or Settings' shortcut capture field chose not to act
// on it, and the menu bar does not overrule them. Keys the router does not own are left to the menu
// (Edit's ⌘Z ⌘C…, whose commands are Firefox's). A click does not land inside a key task: macOS
// tracks the mouse in the open menu, and the command comes after the menu closes
// (nsMenuX::MenuClosedAsync), with the modifiers of that click.
//
// Dimmed, never removed (the board): Back and Forward with nothing behind or ahead, Stop while nothing
// loads, Recently Closed with nothing in it; set when their menu opens. View says Exit Full Screen in
// full screen. While a window-modal dialog is open Firefox dims every "menubar > menu" itself, Deer's
// included (browser/base/content/browser.js gDialogBox._updateMenuAndCommandState).
import { isMac } from '../../../shared/os';
import type { ActionId } from '../../../shared/shortcuts';
import type { Browser } from '../../browser';
import { BAR_ID, buildMenubar, fillRecent, HISTORY_ID, ITEMS, popupId, RECENT_ATTR, RECENT_ID, refreshKeys, reopenRecent, runVerb, VIEW_ID, type Item, type KeyFor } from './items';

export function install(b: Browser): void {
  if (!isMac || document.getElementById(BAR_ID)) return;
  const ff = document.getElementById('main-menubar');
  if (ff?.hasAttribute('native')) {
    // NativeMenuSupport::CreateNativeMenuBar marks the menu bar it took: the window was set up
    // before Deer's package (VitreShell.adopt), and a native menu bar cannot be swapped.
    console.warn('Deer: this window already has its native menu bar; Deer’s menus are not added');
    return;
  }

  /** Items whose key the router owns (from chordFor): the menu never runs those from a key. */
  const routerKeys = new Set<string>();
  const keyFor: KeyFor = (item: Item) => {
    if (item.fixed) return item.fixed;
    const spec = item.action ? b.keys.chordFor(item.action, item.arg) : null;
    if (spec) routerKeys.add(item.id);
    else routerKeys.delete(item.id);
    return spec;
  };

  ff?.setAttribute('nonnative', 'true');
  const { bar, keys } = buildMenubar(document, keyFor);
  if (ff) {
    ff.after(keys, bar);
  } else {
    // No Firefox menu bar to sit beside: a hidden box keeps Deer's from being drawn in the window
    // until it is native (xul.css menubar[native] hides it from then on).
    const box = (document as any).createXULElement('box') as Element;
    box.setAttribute('hidden', 'true');
    box.append(keys, bar);
    document.documentElement.append(box);
  }

  // The task of a key event (see the header): set by its keydown or keypress, cleared by the next task.
  let inKey = false;
  let keyTimer = 0;
  const keyTask = (): void => {
    inKey = true;
    window.clearTimeout(keyTimer);
    keyTimer = window.setTimeout(() => (inKey = false), 0);
  };
  window.addEventListener('keydown', keyTask, true);
  window.addEventListener('keypress', keyTask, true);

  bar.addEventListener('command', (e) => {
    const target = e.target as Element;
    const recent = target.getAttribute(RECENT_ATTR);
    if (recent) {
      e.stopPropagation();
      try {
        reopenRecent(recent, window);
      } catch (err) {
        console.error('Deer: reopen from the menu bar failed', err);
      }
      return;
    }
    const item = ITEMS.get(target.id);
    if (!item || (!item.action && !item.verb)) return;
    e.stopPropagation();
    // The command carries the modifiers of the event that chose the item (nsMenuUtilsX.mm
    // DispatchCommandTo, from NSApp.currentEvent): a key equivalent of the router's has ⌘, ⌃ or ⌥.
    const mods = e as Event & { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
    if (inKey && routerKeys.has(item.id) && (mods.metaKey || mods.ctrlKey || mods.altKey)) return;
    try {
      if (item.verb) runVerb(item.verb, window);
      else if (item.action) b.run(item.action as ActionId, item.arg);
    } catch (err) {
      console.error(`Deer: menu bar item ${item.id} failed`, err);
    }
  });

  bar.addEventListener('popupshowing', (e) => {
    const popup = e.target as Element;
    if (popup.id === popupId(VIEW_ID)) {
      dim('vitre-mb-stop', !b.active()?.loading);
      setLabel('vitre-mb-fullscreen', window.fullScreen ? 'Exit Full Screen' : 'Enter Full Screen');
    } else if (popup.id === popupId(HISTORY_ID)) {
      const page = pageTarget();
      dim('vitre-mb-back', !page.back);
      dim('vitre-mb-forward', !page.forward);
      const list = document.getElementById(popupId(RECENT_ID));
      if (list) dim(RECENT_ID, fillRecent(list, window) === 0);
    } else if (popup.id === popupId(RECENT_ID)) {
      fillRecent(popup, window);
    }
  });

  // A rebind changes the router's map ('settings' event; the router applies it first, so wait a turn).
  b.on('settings', (_s, changed) => {
    if (!changed.length || changed.includes('rebind')) window.setTimeout(() => refreshKeys(document, keyFor), 0);
  });

  /**
   * What Back and Forward would act on: a focused peek, else the active tab (browser.ts pageTarget).
   * Back on a peek's first page closes the peek, so it is never dimmed there.
   */
  function pageTarget(): { back: boolean; forward: boolean } {
    const peek = window.vitrePeek?.browser?.() ?? null;
    if (peek && document.activeElement === peek) return { back: true, forward: peek.canGoForward };
    const t = b.active();
    return { back: !!t?.canBack, forward: !!t?.canForward };
  }

  function dim(id: string, off: boolean): void {
    const el = document.getElementById(id);
    if (!el || el.hasAttribute('disabled') === off) return;
    if (off) el.setAttribute('disabled', 'true');
    else el.removeAttribute('disabled');
  }

  function setLabel(id: string, label: string): void {
    const el = document.getElementById(id);
    if (el && el.getAttribute('label') !== label) el.setAttribute('label', label);
  }
}
