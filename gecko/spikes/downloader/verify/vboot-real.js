// VERIFY: a real ranged download over TLS from an HTTP/2 CDN (verify/engine/VerifyReal.sys.mjs).
/* global spike, ChromeUtils */
spike.main(async () => {
  const { run } = ChromeUtils.importESModule("resource://vitre-boot/engine/VerifyReal.sys.mjs");
  await run();
});
