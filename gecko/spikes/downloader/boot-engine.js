// Spike 2: pause/resume, retry, speed limit, no-Range servers, refused connections, redirects,
// cookies/referrer per container and private state. All in engine/TestEngine.sys.mjs (system scope).
/* global spike, ChromeUtils */
spike.main(async () => {
  const { run } = ChromeUtils.importESModule("resource://vitre-boot/engine/TestEngine.sys.mjs");
  await run();
});
