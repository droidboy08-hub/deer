// Renderer feature modules, discovered by build.mjs (see _generated.ts). Each exports install(browser).
import type { Browser } from '../app';
import { discovered } from './_generated';

export function installModules(b: Browser): void {
  for (const m of discovered as { name: string; install?: (b: Browser) => void }[]) {
    try {
      m.install?.(b);
    } catch (err) {
      console.error(`module ${m.name} failed to install`, err);
    }
  }
}
