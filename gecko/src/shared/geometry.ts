// The bar's vertical geometry, shared by the window (src/window/bar.ts) and the page side
// (src/actors/page/inset.ts). Pure constants: safe to import from any bundle.
// The design (board HomeBrowse): items 44 px tall, 12 px from the top of the window, and the same
// 12 px of air below them. skin/bar.css (#vitre-bar height) and skin/pdf.css carry the same 68 px:
// CSS cannot import this file, so change them together.
// These are the Windows bar's (a pill floating over the page). On macOS the bar is the One row
// (src/window/onerow.ts: ROW_H 52, CAP_TOP 8, CAP_H 36), which floats over the page too: window code
// picks with oneRow(), e.g. `oneRow() ? ROW_H : BAR_AREA` (splitlift.ts) or `oneRow() ? CAP_TOP +
// CAP_H : BAR_TOP + BAR_ITEM` (menus), and the page side takes ROW_AREA below. This file imports
// nothing, so page bundles stay as they are.

/** Distance of the bar's items from the top of the window. */
export const BAR_TOP = 12;
/** Height of the pill and of a full-size circle. */
export const BAR_ITEM = 44;
/** The band the glass bar floats over: 12 + 44 + 12 = 68 CSS px of the window. */
export const BAR_AREA = BAR_TOP + BAR_ITEM + BAR_TOP;

/**
 * macOS: the One row floats over the page (the owner, 2026-11-15: as on Windows), so the page's top
 * strip (src/actors/page/inset.ts) and the PDF viewer's offset (src/actors/page/pdf.ts) take this
 * instead of BAR_AREA: the row's 52 px (src/window/onerow.ts ROW_H; this file imports nothing, change
 * them together) and BAR_TOP of air, page content at 64. In window full screen the row hides, as the
 * Windows bar in F11, and pages get neither (src/window/pagearea.ts).
 */
export const ROW_AREA = 52 + BAR_TOP;

/**
 * Per-browser off switch for the page top inset (src/actors/page/inset.ts, "Per-browser off
 * switch"): the shared-data entry (Services.ppmm.sharedData) that lists the browserIds whose pages
 * do not sit under the bar (a peek's sheet has its own header below the bar).
 */
export const INSET_OFF_KEY = 'vitre:inset-off';

/**
 * Pages under a hidden bar (src/window/pagearea.ts, src/actors/page/inset.ts "Hidden bar"): the
 * shared-data entry that lists the browserIds of every page in a window whose bar is in hiding mode
 * (the barAutoHide setting, F11 full screen: src/window/reveal.ts). The bar keeps no band there, so
 * those pages get no top strip and the PDF viewer no offset. A reveal of the hidden bar (pointer at
 * the top, a hold) does not change it: the bar slides in over the page and nothing reflows.
 */
export const INSET_BAR_HIDDEN_KEY = 'vitre:inset-bar-hidden';
