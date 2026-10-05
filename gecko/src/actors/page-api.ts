// Contract for page-side modules: code that runs next to web pages, in their content process.
// (The Gecko counterpart of the Electron build's preload page-modules.)
//
// Where: one file per feature in src/actors/page/<name>.ts (or <name>/index.ts). tools/build.mjs
// discovers them and bundles all of them into the one VitrePageChild.sys.mjs; nothing to register.
//
// What a module exports (all optional, as named exports):
//   export const events = { scroll: { capture: true }, pageshow: {} };
//       DOM events to receive, with listener options (capture, mozSystemGroup, wantUntrusted,
//       passive, createActor). They are part of the actor registration, which happens once per
//       process start: adding an event needs a restart.
//   export function onEvent(ctx, event) {}
//       Called for the events this module listed.
//   export function onMessage(ctx, name, data) {}
//       Called for b.page(tab).send(name, data) and b.page(tab).query(name, data) from the window.
//       Every module sees every message: return undefined for names that are not yours. For a query
//       the first value (or promise) that is not undefined is the answer.
//   export function onDestroy(ctx) {}
//       The frame's document is going away: clear timers.
//
// Naming: prefix message names with the module name ("find:rects", "core:ping").
// To the window: ctx.send(name, data) arrives as b.on('page-message', (tab, name, data, from) => ...).
// Data crosses processes by structured clone: plain objects only, no DOM nodes or functions.
//
// Rules:
//   - One actor instance exists per frame document (allFrames), in whatever process hosts that frame
//     (web content, privileged about:, or the parent for in-process pages). Keep per-document state in
//     ctx.state, never in module-level variables: a module is shared by every tab of its process.
//   - Check ctx.isTop when only the tab's top document matters.
//   - The code has system privileges and sees the page through Xray wrappers. Never eval page
//     strings, never hand page objects privileged ones, and treat everything read from the page as
//     untrusted when it reaches the window.
//   - No top-level side effects: the parent process also imports this bundle to read `events`.
//
// Settings: read the module's own setting from its vitre.* pref in the content process
// (Services.prefs.getBoolPref(settingPref(key), default), settingPref from src/shared/settings.ts) and
// observe it per document with Services.prefs.addObserver, removed in onDestroy. See ./page/README.

export interface PageContext {
  /** Send a message to the window that owns this page. */
  send(name: string, data?: unknown): void;
  /** The frame's window and document (null while the frame is being torn down). */
  readonly window: (Window & typeof globalThis) | null;
  readonly document: Document | null;
  /** True for the tab's top-level document, false for iframes. */
  readonly isTop: boolean;
  /** This module's own state for this frame document. */
  readonly state: Record<string, any>;
  /** The JSWindowActorChild, for docShell / browsingContext access. */
  readonly actor: JSWindowActorChild;
}

export interface PageModule {
  events?: Record<string, object>;
  onEvent?(ctx: PageContext, event: Event): void;
  onMessage?(ctx: PageContext, name: string, data: any): unknown;
  onDestroy?(ctx: PageContext): void;
}

/** Wire names of the two actor messages (the feature-level name travels inside). */
export const TO_PAGE = 'Vitre:ToPage';
export const FROM_PAGE = 'Vitre:FromPage';

export interface PageEnvelope {
  name: string;
  data: unknown;
}
