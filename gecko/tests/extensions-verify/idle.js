// Idle cost with and without extensions: parent-process CPU over 10 s with no input, first with no
// add-on, then with nine pinned (five drawn, four hidden for room), then with the extensions panel's
// worth of work done once. The pinned cluster itself must add nothing measurable.
//   python tests/extensions/runx.py --test tests/extensions-verify/idle.js --name extensions-verify-idle --app build-extensions-verify-all --out tests/extensions-verify/out/idle
/* global spike, Services, ChromeUtils, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  await xt.nav(xt.page());
  spike.click(640, 600, { type: "mousemove" });
  // Firefox does start-up work on a fresh profile for a while: take the quietest of five 4 s windows.
  const measure = async (label) => {
    await sleep(3000);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const c0 = (await ChromeUtils.requestProcInfo()).cpuTime;
      await sleep(4000);
      samples.push(Math.round(((await ChromeUtils.requestProcInfo()).cpuTime - c0) / 1e6 / 4));
    }
    log(label, "parent CPU ms per s, five windows", samples);
    return Math.min(...samples);
  };
  const none = await measure("no extensions:");
  for (const name of ["popup", "blocker", "badge", "dnr", "menus", "command", "pin1", "pin2", "panelonly"]) await xt.install(name);
  await xt.waitFor(() => xt.pinnedInPill().length === 8, 8000);
  await xt.nav(xt.page() + "?idle");
  spike.click(640, 600, { type: "mousemove" });
  const nine = await measure("nine extensions:");
  check("idle: nine extensions in the pill add under 1% of a core to the parent process", nine - none < 10, { none, nine });
  log("vitre errors", vx.errors());
});
