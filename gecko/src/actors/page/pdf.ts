// Built-in page module: Firefox's PDF viewer (pdf.js) under Deer's floating bar.
//
// pdf.js lays its toolbar out at the very top of the viewport (resource://pdf.js/web/viewer.html,
// gre/chrome/pdfjs/content/web/viewer.css: #mainContainer { inset: 0 }, the .toolbar first in it,
// #viewerContainer at inset-block-start: var(--toolbar-height)), where Deer's pill and window
// controls float over it. This module pushes the whole viewer 68 px down (skin/pdf.css, loaded as an
// additional author sheet with !important so it outranks the viewer's own rules) when the viewer's
// document is ready. Presentation mode makes #viewerContainer itself full screen, so the offset
// does not matter there.
// A <browser> that is not under the bar (a peek's sheet, below its own header) is listed in the
// inset module's per-browser off switch (./inset.ts header, INSET_OFF_KEY): its viewer gets no
// offset, and an inset:check message from the window (sent after the list changed, when the peek
// becomes a tab) puts the offset in or takes it out to match. A page under a hidden bar (the bar in
// hiding mode: auto-hide, F11; INSET_BAR_HIDDEN_KEY, ./inset.ts "Hidden bar") gets no offset either:
// the bar keeps no band there, and the viewer's toolbar goes to the top of the window.
// The viewer document keeps the PDF's own URL (file:, https:) as documentURI: PdfStreamConverter
// streams viewer.html into the PDF's channel (gre/modules/PdfStreamConverter.sys.mjs). What
// identifies it is its principal, resource://pdf.js/web/viewer.html.
//
// For the Find stage: pdf.js does not take browser.finder like a web page; Ctrl+F on a PDF must go
// through Firefox's PdfjsParent / FinderParent ("updatematchescount" protocol of
// gre/moz-src/toolkit/components/pdfjs/content/PdfjsParent.sys.mjs).
import type { PageContext } from '../page-api';
import { INSET_BAR_HIDDEN_KEY, INSET_OFF_KEY } from '../../shared/geometry';

const VIEWER = 'resource://pdf.js/web/viewer.html';
const SHEET = 'chrome://vitre/content/skin/pdf.css';

export const events = {
  DOMContentLoaded: {},
};

/** The pdf.js viewer: a document whose principal is the viewer's resource URL. */
function isViewer(doc: Document): boolean {
  try {
    const spec: string = (doc as any).nodePrincipal?.spec ?? '';
    return spec.startsWith(VIEWER);
  } catch {
    return false;
  }
}

/**
 * The window listed this document's <browser> in the inset off switch (./inset.ts browserOff), or
 * as under a hidden bar (./inset.ts barHidden).
 */
function browserOff(ctx: PageContext): boolean {
  return listed(ctx, INSET_OFF_KEY) || listed(ctx, INSET_BAR_HIDDEN_KEY);
}

function listed(ctx: PageContext, key: string): boolean {
  try {
    const list = Services.cpmm.sharedData.get(key) as unknown;
    if (!Array.isArray(list) || !list.length) return false;
    const id = ctx.actor.browsingContext?.browserId;
    return id !== undefined && list.includes(Number(id));
  } catch {
    return false;
  }
}

/** Put the offset sheet in, or take it out, to match the off switch. */
function apply(ctx: PageContext): void {
  const win = ctx.window;
  if (!win) return;
  const want = !browserOff(ctx);
  if (want === !!ctx.state.sheet) return;
  try {
    const utils = (win as any).windowUtils;
    if (want) utils.loadSheetUsingURIString(SHEET, utils.AUTHOR_SHEET);
    else utils.removeSheetUsingURIString(SHEET, utils.AUTHOR_SHEET);
    ctx.state.sheet = want;
  } catch (e) {
    console.error('Deer pdf: could not change the viewer sheet', e);
  }
}

export function onEvent(ctx: PageContext, event: Event): void {
  if (event.type !== 'DOMContentLoaded' || !ctx.isTop) return;
  const doc = ctx.document;
  const win = ctx.window;
  if (!doc || !win || event.target !== doc) return;
  if (!isViewer(doc) || ctx.state.viewer) return;
  ctx.state.viewer = true;
  apply(ctx);
}

export function onMessage(ctx: PageContext, name: string): unknown {
  // The off switch changed (the inset module answers the query; this only follows it).
  if (name === 'inset:check') {
    if (ctx.isTop && ctx.state.viewer) apply(ctx);
    return undefined;
  }
  // For tests: is this frame the PDF viewer, and did the sheet go in?
  if (name === 'pdf:state') {
    const doc = ctx.document;
    let principal = '';
    try {
      principal = (doc as any)?.nodePrincipal?.spec ?? '';
    } catch {
      principal = '';
    }
    return { viewer: !!doc && isViewer(doc), sheet: !!ctx.state.sheet, principal, uri: doc?.documentURI ?? '' };
  }
  return undefined;
}
