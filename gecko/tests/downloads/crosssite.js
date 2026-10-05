// A download a page starts on ANOTHER site: Vitre's engine takes it over with all its connections,
// but fetches it under that page's cross-site cookie rules, so the file's site's SameSite=Strict
// cookies (which Firefox would not send for that click either) never go out. The same file started
// from its own site keeps its first-party cookies.
/* global spike, Services, ChromeUtils, gBrowser, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { check, log, waitFor } = spike;
  await DL.init();
  await spike.resize(1280, 800);
  await spike.activate();
  const engine = DL.engine;

  // The site's own page sets its cookies first (sid, and strict with SameSite=Strict), as a visit would.
  await DL.open(DL.base + "/page.html?rate=0");
  const cross = DL.base.replace("127.0.0.1", "localhost") + "/cross.html";
  await DL.open(cross);
  log("page: " + gBrowser.selectedBrowser.currentURI.spec);
  check("the link page is on another site", gBrowser.selectedBrowser.currentURI.host === "localhost");
  await DL.reset();

  const before = engine.takeovers.length;
  const click = await DL.clickInPage("#x");
  check("the click on the cross-site link is trusted", click.found && click.trusted === true, click);
  const seen = await waitFor(() => engine.takeovers.length > before && engine.takeovers[engine.takeovers.length - 1], { timeout: 20000, what: "the download to be seen" });
  check("a download started by another site is taken over by Vitre's engine", seen.action === "taken over" && seen.crossSite === true, seen);
  const done = await DL.until(seen.id, ["completed", "failed"], { timeout: 60000 });
  check("it completes", done.state === "completed", done.error);

  const st = await DL.stats();
  const ranged = st.requests.filter((r) => r.path.startsWith("/blob/medium") && r.range && r.range !== "bytes=0-0" && r.status === 206);
  check("on several connections", ranged.length >= 2, ranged.map((r) => r.range));
  check("without the site's SameSite=Strict cookie", ranged.length > 0 && ranged.every((r) => !r.cookie.includes("vitre-strict")), ranged.map((r) => r.cookie).slice(0, 3));
  check("and with the other page as Referer", ranged.every((r) => (r.referer || "").includes("localhost")), ranged.map((r) => r.referer).slice(0, 2));
});
