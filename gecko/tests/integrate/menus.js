// Right-click flows from the menus module into the other modules, all real (full build, no
// stand-ins): Peek link opens a peek growing from the link; Download linked file and Save image as…
// reach Vitre's downloader (the file lands in the downloads folder; Save as goes through the save
// dialog, answered here by a stand-in nsIFilePicker so no native dialog opens); Find selection opens
// find seeded with the words; Settings on Home's menu and on the + circle opens the Settings panel;
// Show downloads opens the Downloads panel listing both files. The native context menu never shows.
// Captures: menus-1-link-menu, menus-2-peek, menus-3-download, menus-4-save-image, menus-5-find,
// menus-6-home-settings, menus-7-plus-downloads.
/* global spike, Services, I, Cc, Ci, ChromeUtils, Components, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = I;
  const { check, log, sleep, waitFor, capture } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const peek = b.service("peek");
  const find = b.service("find");
  const settings = b.service("settings");
  const downloads = b.service("downloads");
  const engine = b.sys("VitreDownloads");
  const isDone = (d) => d.state === "completed";

  // ---- a stand-in Save dialog (no native dialog opens) ----
  const picker = I.mockFilePicker((req) => PathUtils.join(I.dlDir, "saved-" + (req.name || "file")));
  const savedAs = picker.asked;

  try {
    const tab = await I.load(I.page("article.html"), 700);

    // ---- Peek link ----
    check("link menu opens", await I.menuOn("#peeklink"), I.labels());
    const st = I.describeMenu("LINK");
    check("link menu: Open link in new tab, Peek link [Shift+click], Open link in new window, Copy link address, Download linked file", st.rows[0]?.label === "Open link in new tab" && st.rows[1]?.label === "Peek link" && st.rows[1]?.key === "Shift+click" && I.labels().includes("Download linked file"), I.labels());
    await capture("menus-1-link-menu");
    await I.pick("Peek link");
    const peeked = await waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec.includes("counter.html"), { timeout: 8000, what: "peek open" }).catch(() => false);
    await sleep(700);
    const hr = peek.headerRect();
    check("Peek link opens a peek of the link, its sheet's header under the bar", !!peeked && !!hr && hr.top >= 68, { header: hr && [hr.left, hr.top, hr.width, hr.height] });
    await capture("menus-2-peek");
    peek.close();
    await waitFor(() => !peek.isOpen(), { timeout: 4000, what: "peek closed" }).catch(() => null);
    await sleep(600);

    // ---- Download linked file ----
    // Every request the engine makes for notes.zip: its principals and the Referer it carries (the
    // page's own Save Link As: the page loads and triggers it, its referrer policy decides).
    const zipRequests = [];
    const zipWatch = {
      observe(subject) {
        try {
          const ch = subject.QueryInterface(Ci.nsIHttpChannel);
          if (!/notes\.zip/.test(ch.URI.spec)) return;
          const li = ch.loadInfo;
          let referer = "";
          try {
            referer = ch.getRequestHeader("Referer");
          } catch {
            referer = "";
          }
          zipRequests.push({ url: ch.URI.spec, loading: li.loadingPrincipal?.isSystemPrincipal ? "system" : (li.loadingPrincipal?.origin ?? ""), triggering: li.triggeringPrincipal?.isSystemPrincipal ? "system" : (li.triggeringPrincipal?.origin ?? ""), referer });
        } catch {
          /* not http */
        }
      },
    };
    Services.obs.addObserver(zipWatch, "http-on-modify-request");
    const pageOrigin = Services.io.newURI(I.page("article.html")).prePath;
    check("file link menu opens", await I.menuOn("#zip"), I.labels());
    I.describeMenu("FILE LINK");
    check("a file link's menu starts with Download linked file", I.labels()[0] === "Download linked file", I.labels());
    const before = engine.list().length;
    await I.pick("Download linked file");
    const got = await waitFor(() => engine.list().find((d) => /notes\.zip/.test(d.url) || /notes/.test(d.filename)), { timeout: 8000, what: "download listed" }).catch(() => null);
    await sleep(300);
    await capture("menus-3-download");
    const done = await waitFor(async () => (await I.downloaded()).includes("notes.zip") && engine.list().some((d) => /notes/.test(d.filename) && isDone(d)), { timeout: 15000, what: "notes.zip saved" }).catch(() => false);
    log("downloads", engine.list().map((d) => ({ name: d.filename, state: d.state, path: d.path })), "folder", await I.downloaded());
    check("Download linked file: Vitre's downloader saves notes.zip into the downloads folder", engine.list().length > before && !!got && !!done, { files: await I.downloaded() });
    const plain = zipRequests.filter((r) => !/noref/.test(r.url));
    log("notes.zip requests", plain);
    check("Download linked file: the page loads and triggers every request (never the system principal)", plain.length > 0 && plain.every((r) => r.loading === pageOrigin && r.triggering === pageOrigin), { plain, pageOrigin });
    check("Download linked file: the Referer is the page (same origin, the default policy)", plain.length > 0 && plain.every((r) => r.referer === I.page("article.html")), plain.map((r) => r.referer));
    // A rel=noreferrer link: no Referer on any of Vitre's requests.
    await I.inContent(tab.browser, (content) => {
      const a = content.document.createElement("a");
      a.id = "zipnoref";
      a.rel = "noreferrer";
      a.href = "files/notes.zip?noref=1";
      a.textContent = "the data set, no referrer";
      a.style.cssText = "position:fixed;left:40px;top:140px;font:18px sans-serif;z-index:9;background:#fff";
      content.document.body.append(a);
      return true;
    });
    await sleep(200);
    check("noreferrer link menu opens", await I.menuOn("#zipnoref"), I.labels());
    await I.pick("Download linked file");
    await waitFor(() => engine.list().some((d) => /noref/.test(d.url) && isDone(d)), { timeout: 15000, what: "noref download" }).catch(() => null);
    const noref = zipRequests.filter((r) => /noref/.test(r.url));
    log("noreferrer requests", noref);
    check("Download linked file on a rel=noreferrer link: no Referer is sent", noref.length > 0 && noref.every((r) => r.referer === ""), noref);
    Services.obs.removeObserver(zipWatch, "http-on-modify-request");
    await I.inContent(tab.browser, (content) => {
      content.document.getElementById("zipnoref")?.remove();
      return true;
    });

    // ---- Save image as… ----
    check("image menu opens", await I.menuOn("#img1"), I.labels());
    I.describeMenu("IMAGE");
    await I.pick("Save image as…");
    const saved = await waitFor(async () => (await I.downloaded()).some((f) => f.startsWith("saved-")) && engine.list().some((d) => /saved-/.test(d.path || d.filename) && isDone(d)), { timeout: 15000, what: "image saved" }).catch(() => false);
    log("save as", savedAs, "folder", await I.downloaded());
    check("Save image as…: the Save dialog was asked (once) and the image saved where it said", !!saved && savedAs.length === 1 && /photo/.test(savedAs[0].name), savedAs);
    await capture("menus-4-save-image");

    // ---- Find selection ----
    await I.inContent(tab.browser, (content) => {
      content.scrollTo(0, 0);
      const t = content.document.getElementById("p1").firstChild;
      const i = t.data.indexOf("surface tension");
      const range = content.document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + 15);
      content.getSelection().removeAllRanges();
      content.getSelection().addRange(range);
    });
    await sleep(250);
    const sel = await I.inContent(tab.browser, (content) => {
      const r = content.getSelection().getRangeAt(0).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const box = tab.browser.getBoundingClientRect();
    I.rightClick(box.left + sel.x, box.top + sel.y);
    await I.waitMenu();
    I.describeMenu("SELECTION");
    const findRow = I.labels().find((l) => l.startsWith("Find "));
    check("selection menu offers Find “surface tension” on page", findRow === "Find “surface tension” on page", I.labels());
    await I.pick(findRow);
    await waitFor(() => find.isOpen(), { timeout: 4000, what: "find open" }).catch(() => null);
    await sleep(900);
    const input = document.querySelector("#layer-find .vf-input");
    const counter = document.querySelector("#layer-find .vf-count")?.textContent ?? "";
    const fopen = find.isOpen();
    check("Find selection: find opens on the pill, seeded with the words, the first match counted", fopen && input?.value === "surface tension" && /^1\s+of\s+1$/.test(counter.trim()), { open: fopen, value: input?.value, counter, face: window.vitreFind?.face?.mode, capsule: window.vitreFind?.capsule?.mode, inspect: window.vitreFind?.inspect?.() });
    await capture("menus-5-find");
    find.close();
    await sleep(500);

    // ---- Settings from Home's menu ----
    const home = b.newTab();
    await waitFor(() => b.active() === home && home.kind === "home" && !home.loading, { timeout: 8000, what: "Home" });
    await sleep(900);
    if (b.omni.open) b.omni.close();
    await sleep(400);
    const hb = home.browser.getBoundingClientRect();
    I.rightClick(hb.left + hb.width * 0.25, hb.top + hb.height * 0.7);
    await I.waitMenu();
    I.describeMenu("HOME");
    check("Home's menu has Settings (Ctrl+,)", I.labels().includes("Settings"), I.labels());
    await I.pick("Settings");
    await waitFor(() => settings.isOpen(), { timeout: 4000, what: "settings open" }).catch(() => null);
    await sleep(700);
    check("Settings from Home's menu opens the Settings panel", settings.isOpen() && b.root.classList.contains("settings-open"), b.root.className);
    await capture("menus-6-home-settings");
    I.key("KEY_Escape");
    await waitFor(() => !settings.isOpen(), { timeout: 3000, what: "settings closed" }).catch(() => null);
    await sleep(500);

    // ---- the + circle: Settings, Show downloads ----
    const plus = document.querySelector("#vitre-bar .item.plus");
    let pr = plus.getBoundingClientRect();
    I.rightClick(pr.left + 22, pr.top + 22);
    await I.waitMenu();
    I.describeMenu("PLUS");
    await I.pick("Settings");
    await sleep(700);
    check("Settings on the + circle opens the Settings panel", settings.isOpen(), b.root.className);
    I.key("KEY_Escape");
    await sleep(600);
    pr = plus.getBoundingClientRect();
    I.rightClick(pr.left + 22, pr.top + 22);
    await I.waitMenu();
    await I.pick("Show downloads");
    await waitFor(() => downloads.isPanelOpen(), { timeout: 4000, what: "downloads panel" }).catch(() => null);
    await sleep(800);
    const rows = [...document.querySelectorAll("#vitre-root .vd-panel .vd-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim().slice(0, 60));
    log("downloads panel rows", rows);
    check("Show downloads opens the Downloads panel, listing the two files", downloads.isPanelOpen() && rows.some((r) => /notes\.zip/.test(r)) && rows.some((r) => /saved-/.test(r)), rows);
    await capture("menus-7-plus-downloads");
    // A Vitre text field with no menu of its own (Downloads' search): only the glass menu, never
    // Firefox's native textbox menu as well (editMenuOverlay.js listens on the window).
    const search = document.querySelector("#vitre-root .vd-panel .vd-search input");
    const native = () => document.getElementById("textbox-contextmenu");
    if (search) {
      const sr = search.getBoundingClientRect();
      I.rightClick(sr.left + 30, sr.top + sr.height / 2);
      await I.waitMenu();
      await sleep(300);
      const nativeState = native()?.state ?? "none";
      I.describeMenu("DOWNLOADS SEARCH FIELD");
      check("a Vitre field without its own menu (Downloads' search) gets the glass edit menu and no native textbox menu", I.menuOpen() && I.labels().includes("Paste") && nativeState !== "open" && nativeState !== "showing", { glass: I.labels(), native: nativeState });
      await capture("menus-8-field-menu");
      try {
        native()?.hidePopup?.();
      } catch {
        /* not open */
      }
      I.key("KEY_Escape");
      await I.waitMenuClosed();
    } else check("the Downloads panel has its search field", false);
    I.key("KEY_Escape");
    await sleep(500);
    check("the native context menu never showed", window.vitreMenus.last.nativeShown === 0, window.vitreMenus.last.nativeShown);
  } finally {
    picker.restore();
  }
});
