// VERIFY: failure paths (verify/engine/VerifyFaults.sys.mjs): a file that changes between pause
// and resume, and disk write errors in the middle of a download.
/* global spike, ChromeUtils */
spike.main(async () => {
  const { run } = ChromeUtils.importESModule("resource://vitre-boot/engine/VerifyFaults.sys.mjs");
  await run();
});
