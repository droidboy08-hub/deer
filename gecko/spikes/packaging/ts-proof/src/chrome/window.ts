// Per-window UI entry point in TypeScript. Bundled (with ./bar) into ONE classic script that
// VitreStartup loads into each browser window with loadSubScript.
import { describeBar } from "./bar";

declare const gBrowser: { tabs: unknown[] };
(window as any).VitreTsWindow = { bar: describeBar(gBrowser.tabs.length), builtWith: "esbuild" };
