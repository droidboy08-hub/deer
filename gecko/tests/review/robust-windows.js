// Robustness review: several windows, private windows, popup windows, tear-off, window leaks.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-windows.js --name review-robust-windows --timeout 240
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")];
  const newWindow = async (known) => {
    const win = await waitFor(() => browsers().find((w) => !known.has(w)), { timeout: 15000, what: "a new browser window" });
    await waitFor(() => win.vitre?.ready, { timeout: 15000, what: "Vitre ready in the new window" });
    return win;
  };

  await R.load(R.page("First", "<h1 style='margin:120px 60px'>First window</h1>"));
  const t1 = b.active();

  // ---- 1. second and third window ----
  const w2 = await spike.openWindow();
  const w3 = await spike.openWindow();
  await w2.spike.resize(1000, 640);
  await w3.spike.resize(900, 600);
  check("three windows each have their own Browser", w2.vitre && w3.vitre && new Set([b, w2.vitre, w3.vitre]).size === 3 && Shell.windows.size === 3, Shell.windows.size);
  await R.load(R.page("Second win page"), w2.vitre.active(), w2);
  await R.load(R.page("Third win page"), w3.vitre.active(), w3);
  check("a new window opens on Home with one tab", w2.vitre.tabs.length === 1 && w3.vitre.tabs.length === 1);
  // Tab ids are per window: the address field's "Switch to tab" must reach the right window's tab.
  b.editAddress();
  spike.type("Third win");
  await sleep(500);
  const rows = [...document.querySelectorAll("#vitre-omni-list .omni-item")].map((r) => r.textContent);
  check("address field offers a tab of another window", rows.some((r) => r.includes("Third win page") && r.includes("Switch to tab")), rows);
  spike.press("Down");
  await sleep(100);
  const cur = b.omni.current();
  spike.press("Enter");
  await sleep(600);
  check("Enter on it leaves this window's tab alone and closes the field", !b.omni.open && b.active() === t1 && t1.title === "First", [cur, b.active().title]);
  check("consistency after cross-window switch", R.consistent().length === 0 && R.consistent(w3).length === 0, [R.consistent(), R.consistent(w3)]);

  // Settings reach all three; the Home theme reaches all three.
  const heard = [0, 0, 0];
  const offs = [b, w2.vitre, w3.vitre].map((x, i) => x.on("settings", () => heard[i]++));
  b.sys("VitreSettings").set({ closeButton: "always" });
  await waitFor(() => heard.every((n) => n === 1), { what: "settings in three windows" }).catch(() => {});
  check("one settings change is heard once in each of three windows", heard.join() === "1,1,1", heard);
  b.sys("VitreSettings").reset();
  await sleep(200);
  offs.forEach((off) => off());

  // ---- 2. tear a tab off into its own window, then move it back ----
  const tearUrl = R.page("Torn tab", "<h1 style='margin:120px 60px'>Torn tab</h1>", "#101014");
  const torn = b.newTab(tearUrl, { background: true });
  await waitFor(() => torn.title === "Torn tab" && !torn.loading, { what: "tab to tear" });
  b.newTab(R.page("Stays"), { background: true });
  await sleep(300);
  let known = new Set(browsers());
  const closedIds = [];
  const offClosed = b.on("tab-closed", (t) => closedIds.push(t.id));
  gBrowser.replaceTabWithWindow(torn.node);
  const w4 = await newWindow(known);
  await waitFor(() => w4.vitre.tabs.length === 1 && w4.vitre.tabs[0].title === "Torn tab", { timeout: 10000, what: "torn tab adopted" }).catch(() => {});
  await sleep(1200);
  const a4 = w4.vitre.active();
  check("tear-off: the new window shows the tab (title, URL, one tab)", !!a4 && a4.title === "Torn tab" && a4.url === tearUrl && w4.vitre.tabs.length === 1, a4 && [a4.title, a4.url.slice(0, 40), w4.vitre.tabs.length]);
  const host4 = w4.document.querySelector("#vitre-bar .item.active .host")?.textContent;
  check("tear-off: its pill shows the page, not Home", !!host4 && host4 !== "Search or enter address" && !w4.document.querySelector("#vitre-bar .item.active").classList.contains("home"), host4);
  check("tear-off: the old window lost the tab and says so", !b.tabs.includes(torn) && closedIds.includes(torn.id) && R.consistent().length === 0, R.consistent());
  await waitFor(() => a4.theme === "dark", { timeout: 4000, what: "theme of the adopted page" }).catch(() => {});
  check("tear-off: the glass theme follows the adopted page (dark page)", a4.theme === "dark" && w4.vitre.root.classList.contains("theme-dark"), a4.theme);
  const ping = await w4.vitre.page(a4).query("core:ping", 1).catch((e) => String(e));
  check("tear-off: the page actor answers in the new window", ping && ping.echo === 1, ping);
  let pm = 0;
  const offPm = w4.vitre.on("page-message", () => pm++);
  await R.inPage("function(w, d){ d.body.style.height = '4000px'; w.scrollTo(0, 500); return 1; }", a4.browser);
  await sleep(500);
  check("tear-off: page messages reach the new window's Browser", pm > 0, pm);
  offPm();
  check("tear-off: consistency in the new window", R.consistent(w4).length === 0, R.consistent(w4));
  await w4.spike.resize(900, 560);
  await w4.spike.capture("windows-tearoff");
  // ...and back into the first window.
  const adopted = gBrowser.adoptTab(a4.node, { tabIndex: 1, selectTab: true });
  await sleep(1200);
  const back = b.tabs.find((t) => t.node === adopted);
  check("adoptTab back: the tab is in this window's model with its title and URL", !!back && back.title === "Torn tab" && back.url === tearUrl && b.activeId === back.id, back && [back.title, b.activeId, back.id]);
  check("adoptTab back: the emptied window closed", w4.closed || !browsers().includes(w4));
  check("adoptTab back: consistency", R.consistent().length === 0, R.consistent());
  offClosed();

  // ---- 3. window.open and target=_blank from a page ----
  const opener = R.page("Opener", `<button id=a style='position:fixed;left:100px;top:200px;width:200px;height:80px' onclick="window.open('https://example.com/?popped','n','width=420,height=320')">open</button>
    <a id=l target=_blank href="https://example.com/?blank" style='position:fixed;left:400px;top:200px;width:200px;height:80px;background:#ccc'>link</a>`);
  await R.load(opener, back);
  const openerTab = b.active();
  let n = b.tabs.length;
  spike.click(200, 240);
  await waitFor(() => b.tabs.length === n + 1, { timeout: 5000, what: "window.open with features as a tab" }).catch(() => {});
  await sleep(600);
  const popped = b.active();
  check("window.open with features opens a tab (product default) next to its opener, selected", b.tabs.length === n + 1 && popped !== openerTab && b.tabs.indexOf(popped) === b.tabs.indexOf(openerTab) + 1, [b.tabs.length, n, b.tabs.indexOf(popped), b.tabs.indexOf(openerTab)]);
  await waitFor(() => popped.title === "Example Domain", { timeout: 8000 }).catch(() => {});
  check("...and the model has its title and URL", popped.title === "Example Domain" && popped.url.endsWith("?popped"), [popped.title, popped.url]);
  if (popped !== openerTab) b.closeTab(popped);
  await sleep(300);
  check("closing it returns to the opener", b.active() === openerTab, b.active()?.title);
  n = b.tabs.length;
  spike.click(500, 240);
  await waitFor(() => b.tabs.length === n + 1, { timeout: 5000, what: "target=_blank as a tab" }).catch(() => {});
  await sleep(500);
  check("target=_blank opens a tab next to its opener", b.tabs.length === n + 1 && b.tabs.indexOf(b.active()) === b.tabs.indexOf(openerTab) + 1, [b.tabs.length, b.tabs.indexOf(b.active())]);
  if (b.active() !== openerTab) b.closeTab(b.active());
  await sleep(300);

  // A real popup window (the user or an extension turned the restriction on: restriction=2 is Firefox's default).
  Services.prefs.setIntPref("browser.link.open_newwindow.restriction", 2);
  b.activate(openerTab);
  await sleep(300);
  known = new Set(browsers());
  spike.click(200, 240);
  const pop = await newWindow(known).catch((e) => (log("no popup window: " + e), null));
  if (pop) {
    await waitFor(() => pop.vitre.tabs.length === 1 && pop.vitre.tabs[0].title === "Example Domain", { timeout: 8000, what: "popup content" }).catch(() => {});
    await sleep(800);
    const pd = pop.document;
    const items = [...pd.querySelectorAll("#vitre-bar .item:not(.leaving)")];
    log("page popup:", { isPopup: pop.vitre.isPopup, attr: pd.documentElement.hasAttribute("popup-window"), inner: [pop.innerWidth, pop.innerHeight], items: items.map((i) => [i.className, R.rect(i)]), winctl: R.rect(pd.getElementById("vitre-winctl")), customtitlebar: pd.documentElement.hasAttribute("customtitlebar") });
    check("page popup (window.open with features): Vitre knows it is a popup", pop.vitre.isPopup === true && pop.vitre.root.classList.contains("popup"));
    check("page popup: one read-only pill, no + circle", items.length === 1 && items[0].classList.contains("active") && !pd.querySelector("#vitre-bar .plus"), items.map((i) => i.className));
    const pill = R.rect(items[0]);
    const ctl = R.rect(pd.getElementById("vitre-winctl"));
    check("page popup: the pill and the window controls fit a 420 px window without overlapping", pill.x >= 0 && pill.x + pill.w <= ctl.x && ctl.x + ctl.w <= pop.innerWidth, { pill, ctl, inner: pop.innerWidth });
    check("page popup: no native caption", pd.documentElement.hasAttribute("customtitlebar"));
    // Keys in a popup: Ctrl+T must not add a tab to a popup window's hidden tab strip, Ctrl+L must not open a field.
    await pop.spike.activate();
    pop.gBrowser.selectedBrowser.focus();
    await sleep(200);
    const tabsBefore = pop.vitre.tabs.length;
    const mainBefore = b.tabs.length;
    pop.spike.press("Ctrl+T");
    await sleep(700);
    log("popup Ctrl+T:", { popupTabs: pop.vitre.tabs.length, mainTabs: b.tabs.length, shown: pop.vitre.bar.state.shown, omni: pop.vitre.omni.open });
    check("page popup: Ctrl+T does not leave the popup with a second, invisible tab", pop.vitre.tabs.length === tabsBefore || pop.vitre.bar.state.shown === pop.vitre.tabs.length, { popupTabs: pop.vitre.tabs.length, drawn: pop.vitre.bar.state.shown, mainTabs: b.tabs.length - mainBefore });
    pop.spike.press("Ctrl+L");
    await sleep(600);
    check("page popup: Ctrl+L opens no address field", !pop.vitre.omni.open);
    await pop.spike.capture("windows-page-popup");
    while (pop.vitre.tabs.length > 1) pop.vitre.closeTab(pop.vitre.tabs[pop.vitre.tabs.length - 1]);
    pop.close();
  } else check("page popup window opened", false);
  Services.prefs.clearUserPref("browser.link.open_newwindow.restriction");
  await spike.activate();

  // ---- 4. private window ----
  const pw = await spike.openWindow({ private: true });
  await pw.spike.resize(1000, 640);
  await sleep(600);
  const p0 = pw.vitre.active();
  log("private window first tab:", { url: p0.url, kind: p0.kind, title: p0.title, theme: p0.theme });
  check("private window: first tab", pw.vitre.tabs.length === 1);
  await pw.spike.activate();
  pw.spike.press("Ctrl+T");
  await waitFor(() => pw.vitre.tabs.length === 2, { timeout: 4000, what: "Ctrl+T in the private window" }).catch(() => {});
  await sleep(500);
  check("private window: Ctrl+T opens Home with the field open", pw.vitre.tabs.length === 2 && pw.vitre.active().url === "about:vitre-home" && pw.vitre.omni.open, [pw.vitre.active().url, pw.vitre.omni.open]);
  pw.spike.press("Escape");
  await R.load(R.page("Secret page"), pw.vitre.active(), pw);
  // The normal window must not be offered the private tab.
  await spike.activate();
  b.editAddress();
  spike.type("Secret");
  await sleep(500);
  const rows2 = [...document.querySelectorAll("#vitre-omni-list .omni-item")].map((r) => r.textContent);
  check("a private tab is not offered to a normal window (tabs or history)", !rows2.some((r) => r.includes("Secret page")), rows2);
  b.omni.close();
  await pw.spike.capture("windows-private");
  check("private window: consistency", R.consistent(pw).length === 0, R.consistent(pw));

  // ---- 5. closing windows (the leak check is tests/review/robust-leaks.js) ----
  const destroyed = [];
  for (const [name, w] of [["w2", w2], ["w3", w3], ["pw", pw]]) {
    const v = w.vitre;
    const d = v.destroy.bind(v);
    v.destroy = () => { destroyed.push(name); d(); };
  }
  // Close the second window by closing its last tab (Ctrl+W on the only tab).
  await w2.spike.activate();
  w2.spike.press("Ctrl+W");
  await waitFor(() => !Shell.windows.has(w2), { timeout: 6000, what: "last tab closing its window" }).catch(() => {});
  check("Ctrl+W on a window's last tab closes that window", !Shell.windows.has(w2) && w2.closed);
  w3.vitre.run("closeWindow");
  pw.close();
  await waitFor(() => Shell.windows.size === 1, { timeout: 6000, what: "windows closing" }).catch(() => {});
  check("closed windows leave VitreShell.windows and were destroyed", Shell.windows.size === 1 && destroyed.sort().join() === "pw,w2,w3", [Shell.windows.size, destroyed]);
  await spike.activate();

  // Ctrl+Shift+T brings a closed window back with the shell.
  known = new Set(browsers());
  b.run("reopenClosed");
  const re = await newWindow(known).catch(() => null);
  check("reopenClosed brings back a closed window with the shell", !!re && !!re.vitre && re.document.documentElement.hasAttribute("vitre"));
  if (re) {
    await sleep(800);
    log("reopened window tabs:", re.vitre.tabs.map((t) => [t.title, t.url.slice(0, 30), t.deferred]));
    check("reopened window: consistency", R.consistent(re).length === 0, R.consistent(re));
    re.close();
  }

  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  check("final consistency", R.consistent().length === 0, R.consistent());
  R.consoleDump("windows");
});
