// Spike: HTTP/1.1 forcing against real HTTP/2 servers (engine/TestH2.sys.mjs).
/* global spike, ChromeUtils */
spike.main(async () => {
  const { run } = ChromeUtils.importESModule("resource://vitre-boot/engine/TestH2.sys.mjs");
  await run();
});
