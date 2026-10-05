// VERIFY: the spike's whole engine suite (redirect, pause/resume, retry, speed limit, no-Range,
// refused connections, cookie jars, Referer) with every connection on its own lane and the
// per-host pref untouched. Run with --env VITRE_V_LANES=1.
/* global spike, ChromeUtils */
spike.main(async () => {
  const { run } = ChromeUtils.importESModule("resource://vitre-boot/engine/TestEngine.sys.mjs");
  await run();
});
