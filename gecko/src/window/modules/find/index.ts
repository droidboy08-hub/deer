// Find in page (feature module "find").
//
// Ctrl+F turns the active tab pill into its find face, in place (480x44, the pill's own glass; with
// the bar hidden only the pill drops in, with its own glass, and stays while find is open). In a
// peek the field is a 440x32 capsule in the sheet's header, over its domain and path. Home has no
// page: Ctrl+F opens the address field there (the core's built-in). Element full screen leaves
// Ctrl+F to the page.
//
// Design: DESIGN-NOTES "Find in page" and "Find and menu build notes"; boards FindPill, FindOpen,
// FindStates, FindContexts, FindMotion, FindSpec. Reference: app/src/renderer/modules/find.ts and
// app/src/preload/page-modules/find.ts. Gecko recipe: spikes/pagefeatures/RESULT.md (FIND and the
// verifier's corrections). Page side: src/actors/page/find.ts. Firefox internals: ./gecko.ts.
//
// Files: controller.ts (state, finder, keys, ring and guard), views.ts (pill face, peek capsule),
// ring.ts (landing ring), styles.ts (CSS), gecko.ts (Firefox internals).
//
// For other modules
//   b.service('find')        { open(opts?: { query?: string; browser?: XULBrowser }), close(), isOpen() }
//     open()                 as Ctrl+F on the topmost page (the open peek, else the active tab)
//     open({ query })        seed the field (the right-click menu's Find "x" on page): the search
//                            starts at the page's selection, so a selected occurrence is the first match
//     open({ browser })      only if that page is the topmost one (a peek's or the active tab's)
//     close()                as Esc: the match stays selected and takes focus
//     isOpen()               find is open on the topmost page
//   Actions                  find, findNext, findPrev (F3 / Ctrl+G with find closed reopen it parked
//                            with the last query and step)
//   Esc ladder               70: the focused find field closes find; 90: parked find (after the page)
//   Key hook                 F6 / Shift+F6 move between the find field and its page while find is open
//   Layers                   find (z 12: the face and the capsule), find-ring (z 9: the landing ring)
//   #vitre-root classes      find-face, find-focused, find-own, find-cooldown (styles.ts), find-in-peek
//   :root[vitre-find-in-peek] set while the capsule shows in a peek's header (a CSS hook; the peek
//                            module itself is told through headerSlot, below)
//   Uses (all optional)      'peek' service: isOpen(), browser(), headerRect(); headerSlot(on) (true
//                            hides the header's domain and path and returns the capsule's slot,
//                            false gives them back; without it the capsule sits 38 px into the
//                            header, as on the FindContexts board); open(request, { origin }) for
//                            Ctrl+Q in the field; the window event 'vitre:peek' re-syncs the capsule.
//                            'menus' service: show(items, at) for the field menu (Shift+F10, Menu key,
//                            right-click); without it the field keeps Firefox's default.
import type { Browser } from '../../browser';
import { FindController } from './controller';

export interface FindApi {
  open(opts?: { query?: string; browser?: XULBrowser }): void;
  close(): void;
  isOpen(): boolean;
}

declare global {
  interface VitreServices {
    find: FindApi;
  }
  interface Window {
    /** For tests: this window's find controller. */
    vitreFind?: FindController;
  }
}

export function install(b: Browser): void {
  const controller = new FindController(b);
  b.provide('find', controller.api());
  window.vitreFind = controller;
}
