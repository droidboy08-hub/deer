// VERIFY: per-connection network partitions ("lanes"). Runs verify/engine/VerifyLanes.sys.mjs.
// resource://vitre-boot/ is this folder (verify/), whose engine/ is a patched copy of the spike's.
/* global spike, ChromeUtils */
spike.main(async () => {
  const { run } = ChromeUtils.importESModule("resource://vitre-boot/engine/VerifyLanes.sys.mjs");
  await run();
});
