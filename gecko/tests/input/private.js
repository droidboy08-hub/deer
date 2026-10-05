// A private window: Ctrl+Shift+N and the + menu's "New private window" open one, with Vitre's shell,
// a private-browsing window (its own cookie jar, nothing in history), and Ctrl+N inside it opens
// another private one.
/* global spike, Services, ChromeUtils, PrivateBrowsingUtils */
spike.main(async () => {
  const { check, waitFor, sleep } = spike;
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  await spike.resize(1280, 800);
  await spike.activate();
  const b = window.vitre;
  const windows = () => [...Services.wm.getEnumerator("navigator:browser")];
  const newest = (n) => waitFor(() => windows().length > n && windows().find((w) => w !== window && !seen.has(w) && w.vitre?.ready), { timeout: 15000, what: "the new window" });
  const seen = new Set([window]);

  // ---- Ctrl+Shift+N ----
  check("Ctrl+Shift+N is bound to a private window", b.keys.bindings().some((k) => k.action === "newPrivateWindow" && /Ctrl\+Shift\+N/i.test(k.spec ?? k.keys ?? "")), b.keys.bindings().filter((k) => k.action === "newPrivateWindow"));
  let n = windows().length;
  spike.press("Ctrl+Shift+N");
  const w1 = await newest(n);
  seen.add(w1);
  check("Ctrl+Shift+N opens a private window", PrivateBrowsingUtils.isWindowPrivate(w1), w1.location.href);
  check("it has Vitre's shell", !!w1.vitre && w1.document.documentElement.hasAttribute("vitre") && w1.vitre.isPrivate === true);
  await sleep(600);
  await w1.spike.capture("private-1-window");

  // ---- Ctrl+N inside it stays private ----
  n = windows().length;
  w1.vitre.run("newWindow");
  const w2 = await newest(n);
  seen.add(w2);
  check("Ctrl+N in a private window opens another private window", PrivateBrowsingUtils.isWindowPrivate(w2));
  w2.close();
  w1.close();
  await waitFor(() => windows().length === 1, { what: "the windows to close" });

  // ---- the + menu ----
  const menus = await b.whenService("menus");
  check("the menus service is there", !!menus);
  n = windows().length;
  const plus = document.querySelector("#vitre-bar .item.plus");
  const at = (el, type, button) => {
    const r = el.getBoundingClientRect();
    spike.EU.synthesizeMouseAtPoint(r.left + Math.min(60, r.width / 2), r.top + r.height / 2, { type, button }, window);
  };
  for (const type of ["mousemove", "mousedown", "mouseup", "contextmenu"]) at(plus, type, 2);
  const row = await waitFor(() => [...b.root.querySelectorAll("[role=menuitem]")].find((r) => /New private window/.test(r.textContent)), { timeout: 5000, what: "the menu row" });
  await sleep(300);
  check("the + menu lists New private window with its key", /Ctrl\+Shift\+N/.test(row.textContent), row.textContent);
  await spike.capture("private-2-plus-menu");
  for (const type of ["mousemove", "mousedown", "mouseup"]) at(row, type, 0);
  const w3 = await newest(n);
  check("the menu row opens a private window", PrivateBrowsingUtils.isWindowPrivate(w3));
  w3.close();
});
