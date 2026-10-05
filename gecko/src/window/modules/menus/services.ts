// The other modules' services as the menus module uses them. They are typed by the providers' own
// declarations (VitreServices: peek/index.ts, find/index.ts, downloads/index.ts, settings/index.ts),
// so a change of contract fails tsc here, and read at the moment of use: a build may leave a
// provider out (b.service answers undefined), and a row that needs a missing service is left out.
import type { Browser } from '../../browser';

export const peekService = (b: Browser): VitreServices['peek'] | null => b.service('peek') ?? null;
export const findService = (b: Browser): VitreServices['find'] | null => b.service('find') ?? null;
export const downloadsService = (b: Browser): VitreServices['downloads'] | null => b.service('downloads') ?? null;
export const settingsService = (b: Browser): VitreServices['settings'] | null => b.service('settings') ?? null;

/** The browser of the open peek, from the service or the core's hook (window.vitrePeek). */
export function peekBrowser(b: Browser): XULBrowser | null {
  try {
    return peekService(b)?.browser() ?? window.vitrePeek?.browser?.() ?? null;
  } catch {
    return null;
  }
}
