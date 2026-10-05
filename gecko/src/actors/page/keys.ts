// Page module for the key router (src/window/keys.ts).
//
// Esc is a page-first key: Deer runs its own Esc step only when the page did not use the press.
// Gecko's "did the page use it" answer misses the layers a page closes with Esc by default: a modal
// <dialog>, a popover. Closing one does not mark the key as consumed, so one press would close the
// page's layer AND run Deer's step (close a peek, stop loading). This module looks at the keydown
// before the page does and tells the window when such a layer is open:
//   keys:esc-layer {}      sent on a fresh Esc keydown while this frame (or a frame above it in the
//                          same process) shows a modal dialog or an open popover.
// The message travels on the same channel as the key's reply and is sent first, so the router has
// it when the reply arrives (spikes/keys/RESULT.md, recipe correction 6).
import type { PageContext } from '../page-api';

export const events = {
  // Capture on the frame's chrome event handler: runs before any listener of the page itself.
  keydown: { capture: true },
};

export function onEvent(ctx: PageContext, event: Event): void {
  if (event.type !== 'keydown' || !event.isTrusted) return;
  const e = event as KeyboardEvent;
  if (e.key !== 'Escape' || e.repeat || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
  let win: Window | null = ctx.window;
  for (let depth = 0; win && depth < 8; depth++) {
    try {
      if (win.document.querySelector(':modal, :popover-open')) {
        ctx.send('keys:esc-layer', {});
        return;
      }
      if (win.parent === win) return;
      win = win.parent;
    } catch {
      return; // a frame of another process: its own actor looks at its own document
    }
  }
}
