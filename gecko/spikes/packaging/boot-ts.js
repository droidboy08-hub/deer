// Loads the esbuild output of ts-proof/ (TypeScript -> .sys.mjs and -> window bundle).
// Build first: sh spikes/packaging/ts-proof/build.sh
spike.main(async () => {
  await spike.loaded();
  const check = (name, ok, detail) => spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + JSON.stringify(detail) : ""));
  const { TsProbe } = ChromeUtils.importESModule("chrome://vitre/content/modules/generated/TsProbe.sys.mjs");
  TsProbe.add("https://example.com/a.zip", 100);
  TsProbe.add("https://example.com/b.zip", 23);
  check("TS1 .sys.ts -> esbuild -> .sys.mjs loads as a system module and imports another module by chrome:// URL", TsProbe.total() === 123 && TsProbe.sharesSingleton());
  Services.scriptloader.loadSubScript("chrome://vitre/content/chrome/generated/window.bundle.js", window);
  check("TS2 window.ts + bar.ts -> esbuild IIFE bundle -> loadSubScript", window.VitreTsWindow?.bar === "bar for 1 tab", window.VitreTsWindow);
});
