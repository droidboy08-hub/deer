// Built-in page module: tells the window when the pixels under the bar may have changed, and answers
// a ping. The Browser re-samples the glass theme on these; the switcher refreshes thumbnails.
//
// Messages to the window (top document only):
//   core:ready      { url }                 DOMContentLoaded
//   core:pageshow   { url, persisted }      pageshow (persisted = restored from the back/forward cache)
//   core:scroll     { x, y }                at most one per animation frame while scrolling
//   core:paint      {}                      the page repainted (main thread): at most one per
//                                           250 ms, trailing. Compositor animations (transforms,
//                                           video) paint nothing here. The invalidated area is
//                                           checked against the band under the bar, but WebRender
//                                           reports every paint as the whole viewport, so in
//                                           practice every main-thread paint counts. On a page with
//                                           a running compositor animation the window's own
//                                           drawSnapshot() causes one such paint (on a static page
//                                           it causes none), so the window damps paint-driven
//                                           sampling by its result (browser.ts sample()).
// Queries from the window:
//   core:ping         -> { url, remoteType, pid, isTop, echo }
//   core:scroll       -> { x, y, zoom }
//   core:paint-stats  -> { seen, sent, last, requests } (paints in this document; for tests)
// Throttling follows spikes/switcher/RESULT.md (verifier): scroll once per frame here and a
// leading+trailing throttle in the window; paint needs its own cap because animations repaint
// every frame.
import type { PageContext } from '../page-api';

const PAINT_INTERVAL = 250;
/** The band under the tab bar (68 px) plus a little, in CSS px of the page's viewport. */
const PAINT_BAND = 80;

/**
 * Whether a paint touched the band under the bar. NotifyPaintEvent.boundingClientRect is the
 * invalidated area in CSS px of the viewport (dom/webidl/NotifyPaintEvent.webidl); an empty rect
 * means the event carries no geometry, which counts as "unknown": sample.
 */
function paintReachesBar(event: Event): boolean {
  try {
    const rect = (event as Event & { boundingClientRect?: DOMRect }).boundingClientRect;
    if (!rect || (!rect.width && !rect.height)) return true;
    return rect.top < PAINT_BAND;
  } catch {
    return true;
  }
}

export const events = {
  DOMContentLoaded: {},
  pageshow: {},
  // Scroll does not bubble out of scrollable elements: capture sees those too.
  scroll: { capture: true, passive: true, createActor: false },
  MozAfterPaint: { capture: true, createActor: false },
};

export function onEvent(ctx: PageContext, event: Event): void {
  if (!ctx.isTop) return;
  const win = ctx.window;
  const s = ctx.state;
  if (!win) return;
  switch (event.type) {
    case 'scroll':
      if (s.scrollPending) return;
      s.scrollPending = true;
      win.requestAnimationFrame(() => {
        s.scrollPending = false;
        const w = ctx.window;
        if (w) ctx.send('core:scroll', { x: w.scrollX, y: w.scrollY });
      });
      break;
    case 'DOMContentLoaded':
      if (event.target === ctx.document) ctx.send('core:ready', { url: ctx.document?.documentURI });
      break;
    case 'pageshow':
      if (event.target === ctx.document) {
        ctx.send('core:pageshow', { url: ctx.document?.documentURI, persisted: !!(event as PageTransitionEvent).persisted });
      }
      break;
    case 'MozAfterPaint': {
      s.paintsSeen = (s.paintsSeen ?? 0) + 1;
      try {
        const e = event as Event & { boundingClientRect?: DOMRect; paintRequests?: ArrayLike<{ clientRect: DOMRect; reason?: string }> };
        const r = e.boundingClientRect;
        s.lastPaintRect = r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null;
        s.lastPaintRequests = Array.from(e.paintRequests ?? [], (p) => [Math.round(p.clientRect.x), Math.round(p.clientRect.y), Math.round(p.clientRect.width), Math.round(p.clientRect.height), p.reason ?? '']).slice(0, 6);
      } catch {
        s.lastPaintRect = null;
      }
      if (s.paintTimer || !paintReachesBar(event)) return;
      s.paintsSent = (s.paintsSent ?? 0) + 1;
      const wait = Math.max(0, PAINT_INTERVAL - (Date.now() - (s.lastPaint ?? 0)));
      s.paintTimer = win.setTimeout(() => {
        s.paintTimer = 0;
        s.lastPaint = Date.now();
        ctx.send('core:paint', {});
      }, wait);
      break;
    }
  }
}

export function onMessage(ctx: PageContext, name: string, data: unknown): unknown {
  const win = ctx.window;
  switch (name) {
    case 'core:ping':
      return {
        url: ctx.document?.documentURI ?? '',
        // "" in the parent process, "web", "webIsolated=https://example.com", "privilegedabout"...
        remoteType: Services.appinfo.remoteType ?? '',
        pid: Services.appinfo.processID,
        isTop: ctx.isTop,
        echo: data,
      };
    case 'core:scroll':
      return win ? { x: win.scrollX, y: win.scrollY, zoom: ctx.actor.browsingContext?.fullZoom ?? 1 } : null;
    case 'core:paint-stats':
      // For tests: paints seen in this document, how many were worth a core:paint, the last rect.
      return { seen: ctx.state.paintsSeen ?? 0, sent: ctx.state.paintsSent ?? 0, last: ctx.state.lastPaintRect ?? null, requests: ctx.state.lastPaintRequests ?? null };
  }
  return undefined;
}

export function onDestroy(ctx: PageContext): void {
  try {
    if (ctx.state.paintTimer) ctx.window?.clearTimeout(ctx.state.paintTimer);
  } catch {
    /* window already gone */
  }
}
