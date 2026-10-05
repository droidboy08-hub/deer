// Main-process feature modules, discovered by build.mjs (see _generated.ts). Each exports register(ctx).
import type { MainContext } from '../context';
import { discovered } from './_generated';

export function registerModules(ctx: MainContext): void {
  for (const m of discovered as { name: string; register?: (ctx: MainContext) => void }[]) {
    try {
      m.register?.(ctx);
    } catch (err) {
      console.error(`module ${m.name} failed to register`, err);
    }
  }
}
