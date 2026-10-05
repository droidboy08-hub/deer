// Design-fidelity review, probe G: Firefox-owned surfaces that show inside the window (an alert,
// a certificate error), and the pill's centring measured against the board.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const port = Services.env.get("VITRE_TEST_PORT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const cs = (el) => window.getComputedStyle(el);
  const R = (el) => { const r = el.getBoundingClientRect(); return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]; };
  const dump = (name, obj) => log("DUMP " + name + " " + JSON.stringify(obj));
  const settled = async (win = window) => { await waitFor(() => win.vitre.bar.state.settled, { timeout: 9000, what: "settle" }); await sleep(150); };
  const inner = async (w, h, win = window) => {
    win.resizeTo(w + (win.outerWidth - win.innerWidth), h + (win.outerHeight - win.innerHeight));
    win.moveTo(30, 30);
    await sleep(600);
  };
  const go = async (url, t = b.active(), wait = 30000) => {
    b.navigate(t, url);
    await waitFor(() => !t.loading && t.url !== "about:blank", { timeout: wait, what: "load " + url }).catch((e) => log("NOTE " + e));
    await sleep(900);
    await settled();
  };

  await inner(1440, 900);
  await spike.activate();
  await go(site("fieldnotes", "/article"));

  // centring of the pill's label, one tab
  const pill = document.querySelector("#vitre-bar .item.active");
  const pr = R(pill);
  const fav = R(pill.querySelector(".address .fav").firstElementChild);
  const host = R(pill.querySelector(".host"));
  dump("centring", { pill: pr, pillCentre: pr[0] + pr[2] / 2, labelFrom: fav[0], labelTo: host[0] + host[2], labelCentre: (fav[0] + host[0] + host[2]) / 2, address: R(pill.querySelector(".address")), reloadRightInset: pr[0] + pr[2] - (R(pill.querySelector(".reload"))[0] + 28), markSlot: "dl-mark would sit at pill x " + (R(pill.querySelector(".reload"))[0] - 28 - pr[0]) });

  // an alert()
  const page = "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>Alert</title><body style='margin:0;background:#f3eee4;font:16px Segoe UI'><p style='margin:140px 40px'>A page that calls alert().</p><script>setTimeout(()=>alert('Saved your changes.'),600)</scr" + "ipt>");
  b.navigate(b.active(), page);
  await sleep(2500);
  const box = document.querySelector(".content-prompt-dialog .dialogBox, .dialogStack .dialogBox");
  dump("alert", { found: !!box, rect: box ? R(box) : null });
  await spike.capture("g1-alert");
  spike.press("Escape");
  await sleep(600);

  // a certificate error page (self-signed.badssl.com needs the network; skip quietly if offline)
  await go("https://self-signed.badssl.com/", b.active(), 20000);
  await sleep(1500);
  dump("certerror", { uri: b.active().browser.documentURI?.spec.slice(0, 60), title: document.title });
  await spike.capture("g2-certerror");
});
