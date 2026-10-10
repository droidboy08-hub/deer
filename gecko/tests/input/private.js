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

  // ---- it opens on Deer's Home, where typing goes to Deer's address field --------------------------
  // Not Firefox's private browsing page: its search box hands every key to Firefox's address bar,
  // which Deer hides, so nothing could be typed (owner's report, 2026-10-10).
  const pt = await waitFor(() => w1.vitre.active() && !w1.vitre.active().loading && w1.vitre.active(), { what: "the private window's tab" });
  const firstUrl = w1.gBrowser.selectedBrowser.currentURI.spec;
  check("a private window opens on Deer's Home, not Firefox's private browsing page", firstUrl === "about:vitre-home" && pt.kind === "home" && w1.gBrowser.tabs.length === 1, { firstUrl, kind: pt.kind, tabs: w1.gBrowser.tabs.length });
  await w1.spike.activate();
  if (w1.vitre.omni.open) w1.vitre.omni.close(false);
  await sleep(200);
  w1.focus();
  w1.vitre.focusPage();
  await sleep(200);
  w1.spike.type("float glass");
  await sleep(400);
  const typed = w1.vitre.omni.current?.();
  check("typing on the private Home goes into Deer's address field", w1.vitre.omni.open && w1.vitre.omni.input.value === "float glass", { open: w1.vitre.omni.open, value: w1.vitre.omni.input.value });
  check("…which searches with DuckDuckGo in a private window", typed?.url === "https://duckduckgo.com/?q=float%20glass", typed);
  w1.vitre.omni.close(false);
  b.editAddress("float glass");
  await sleep(300);
  check("a normal window keeps its own engine (Google)", b.omni.current?.()?.url === "https://www.google.com/search?q=float%20glass", b.omni.current?.());
  b.omni.close(false);
  // Settings › Search engine › Private windows changes the private windows' engine at once.
  b.sys("VitreSettings").set({ privateSearchEngine: "brave" });
  await sleep(300);
  w1.vitre.editAddress("float glass");
  await sleep(300);
  check("the private windows' engine follows its setting", w1.vitre.omni.current?.()?.url === "https://search.brave.com/search?q=float%20glass", w1.vitre.omni.current?.());
  w1.vitre.omni.close(false);
  b.sys("VitreSettings").reset("privateSearchEngine");
  const t2 = w1.vitre.newTab();
  await waitFor(() => t2.url === "about:vitre-home" && !t2.loading, { what: "a new tab in the private window" });
  check("a new tab in the private window is Home too", t2.kind === "home");

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
