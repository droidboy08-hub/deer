// Verifier: prints VitreStartup's timeline (run with --env VITRE_PAINT_PROBE=1) to see whether the
// stylesheet <link> appended in browser-window-before-show is applied before the first paint.
/* global spike, ChromeUtils */
spike.main(async () => {
  await spike.loaded();
  const { VitreStartup } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs");
  for (const [what, ms] of VitreStartup.timeline) {
    if (/paint-probe|browser-window-before-show|browser-delayed-startup-finished/.test(what)) spike.log(ms + " ms  " + what);
  }
});
