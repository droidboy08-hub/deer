// Feature modules. Any .ts file (or folder with index.ts) next to this one is discovered by
// tools/build.mjs and must export install(b: Browser). They run at the window's DOMContentLoaded,
// in name order, after the core (tab model, bar, omnibox, keys, anchors) is up.
// One module failing does not stop the others; failures are in b.moduleErrors and the run log.
import type { Browser } from '../browser';
import { discovered } from './_generated';

export function installModules(b: Browser): void {
  for (const m of discovered) {
    try {
      m.install(b);
      b.modules.push(m.name);
    } catch (e) {
      b.moduleErrors.push({ name: m.name, error: String(e) });
      b.sys('VitreShell').report(`module "${m.name}" failed to install`, e);
    }
  }
}
