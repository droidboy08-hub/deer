// Reviewer's probe (review2-code; not a product test): evidence for the code/security review.
//   python tests/review2-code/run.py
// Blocks log "R2 <id> ..." lines; nothing here is a product assertion.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const base = Services.env.get("R2_BASE");
  const xsite = Services.env.get("R2_XSITE");
  const engine = b.sys("VitreDownloads");
  await spike.resize(1280, 800);
  await spike.activate();
  await engine.ready;

  const section = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      log("R2 " + name + " THREW " + e + " " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" / ") : ""));
    }
  };
  const frame = (browser, fn, args = []) =>
    new Promise((resolve) => {
      const mm = browser.messageManager;
      const name = "r2-" + Date.now() + "-" + Math.round(Math.random() * 1e9);
      const timer = setTimeout(() => resolve({ error: "timeout" }), 10000);
      mm.addMessageListener(name, function on(m) {
        mm.removeMessageListener(name, on);
        clearTimeout(timer);
        resolve(m.data);
      });
      const body = `(() => { let out; try { out = (${fn.toString()})(...${JSON.stringify(args)}); } catch (e) { out = { error: String(e) }; } sendAsyncMessage(${JSON.stringify(name)}, out); })()`;
      mm.loadFrameScript("data:application/javascript," + encodeURIComponent(body), false);
    });
  const serverLog = async () => (await fetch(base + "log")).json();

  // Requests the engine makes for /file: their principals and Referer as Necko sees them.
  const seen = [];
  const observer = {
    observe(subject) {
      try {
        const ch = subject.QueryInterface(Ci.nsIHttpChannel);
        const url = ch.URI.spec;
        if (!url.includes("/file?")) return;
        const li = ch.loadInfo;
        let referer = "";
        try {
          referer = ch.getRequestHeader("Referer");
        } catch {
          referer = "(none)";
        }
        seen.push({
          url: url.replace(/^https?:\/\/[^/]+/, ""),
          triggeringSystem: !!li.triggeringPrincipal?.isSystemPrincipal,
          loading: li.loadingPrincipal ? (li.loadingPrincipal.isSystemPrincipal ? "system" : li.loadingPrincipal.origin) : "(none)",
          policyType: li.externalContentPolicyType,
          referer,
        });
      } catch {
        /* not http */
      }
    },
  };
  Services.obs.addObserver(observer, "http-on-modify-request");

  const tab = b.active();
  b.navigate(tab, base + "page.html");
  await waitFor(() => tab.url === base + "page.html" && !tab.loading, { timeout: 15000, what: "page" });
  await sleep(500);
  const dl = b.service("downloads");
  const finished = async (tag, ms = 20000) => {
    const v = await waitFor(() => engine.list(false).find((x) => x.url.includes("tag=" + tag) && ["completed", "failed", "cancelled"].includes(x.state)), { timeout: ms, what: "download " + tag });
    return v;
  };

  // ---- A. File names: Vitre's sanitize vs Firefox's validateFileNameForSaving ----
  await section("A", async () => {
    const mime = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
    const names = ["evil.scf", "doc.lnk", "site.url", "inv‮fdp.exe", "desktop.ini"];
    for (const [i, name] of names.entries()) {
      let ff = "";
      try {
        ff = mime.validateFileNameForSaving(name, "application/octet-stream", 0);
      } catch (e) {
        ff = "threw " + e;
      }
      dl.download(base + "file?name=" + encodeURIComponent(name) + "&tag=fn" + i, { browser: tab.browser });
      const v = await finished("fn" + i);
      log("R2 A name " + JSON.stringify(name) + " -> Vitre saved " + JSON.stringify(v.filename) + " (" + v.state + ") | Firefox validateFileNameForSaving -> " + JSON.stringify(ff));
    }
  });

  // ---- B. A Firefox download taken over: Firefox's chosen name vs the name Vitre saves ----
  await section("B", async () => {
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    const list = await Downloads.getList(Downloads.ALL);
    let ffTarget = "";
    const view = { onDownloadAdded: (d) => (ffTarget = d.target?.path ? PathUtils.filename(d.target.path) : "") };
    await list.addView(view);
    const before = engine.takeovers.length;
    await frame(tab.browser, (href) => {
      const a = content.document.createElement("a");
      a.id = "to";
      a.href = href;
      a.textContent = "take-over link";
      content.document.body.prepend(a);
      const r = a.getBoundingClientRect();
      for (const type of ["mousedown", "mouseup"]) content.synthesizeMouseEvent(type, r.left + 5, r.top + r.height / 2, { button: 0, clickCount: 1 }, {});
      return true;
    }, [base + "file?name=" + encodeURIComponent("evil2.scf") + "&tag=to"]);
    const taken = await waitFor(() => engine.takeovers.length > before && engine.takeovers[engine.takeovers.length - 1], { timeout: 20000, what: "take-over" });
    const v = await finished("to");
    await list.removeView(view);
    log("R2 B take-over: Firefox's own target leaf " + JSON.stringify(ffTarget) + " | action " + taken.action + " | Vitre saved " + JSON.stringify(v.filename));
  });

  // ---- C. Principal and Referer of Vitre's engine requests for page-derived URLs ----
  await section("C", async () => {
    // C1: the downloads service with the page's principal and a no-referrer ReferrerInfo, as the menus pass them.
    const pagePrincipal = tab.browser.contentPrincipal;
    const ri = Cc["@mozilla.org/referrer-info;1"].createInstance(Ci.nsIReferrerInfo);
    ri.init(Ci.nsIReferrerInfo.NO_REFERRER, false, Services.io.newURI(base + "page.html"));
    dl.download(xsite + "file?name=c1.bin&tag=c1", { browser: tab.browser, triggeringPrincipal: pagePrincipal, referrerInfo: ri });
    await finished("c1");
    // C2: the real menu row "Download linked file" on a rel=noreferrer cross-site link.
    const r = await frame(tab.browser, () => {
      const el = content.document.querySelector("#noref");
      const q = el.getBoundingClientRect();
      return { x: q.left + 10, y: q.top + q.height / 2 };
    });
    const br = tab.browser.getBoundingClientRect();
    const x = br.left + r.x;
    const y = br.top + r.y;
    const EU = spike.EU;
    EU.synthesizeMouseAtPoint(x, y, { type: "mousemove" }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mousedown", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "mouseup", button: 2 }, window);
    EU.synthesizeMouseAtPoint(x, y, { type: "contextmenu", button: 2 }, window);
    await waitFor(() => window.vitreMenus?.state().open, { timeout: 5000, what: "menu" });
    await sleep(300);
    const st = window.vitreMenus.state();
    log("R2 C2 menu rows", st.rows.map((x) => x.label));
    const i = st.rows.findIndex((x) => x.label === "Download linked file");
    const row = window.vitreMenus.view.rowElement(i).getBoundingClientRect();
    EU.synthesizeMouseAtPoint(row.left + 40, row.top + row.height / 2, { type: "mousemove" }, window);
    await sleep(60);
    EU.synthesizeMouseAtPoint(row.left + 40, row.top + row.height / 2, { type: "mousedown", button: 0 }, window);
    EU.synthesizeMouseAtPoint(row.left + 40, row.top + row.height / 2, { type: "mouseup", button: 0 }, window);
    await finished("noref");
    for (const s of seen.filter((s) => /tag=(c1|noref|plain)/.test(s.url))) log("R2 C request " + JSON.stringify(s));
    const srv = (await serverLog()).filter((e) => /tag=(c1|noref)/.test(e.path));
    for (const e of srv) log("R2 C server saw " + JSON.stringify(e));
  });

  // ---- D. Alt+click on a link inside a peek ----
  await section("D", async () => {
    const peek = b.service("peek");
    peek.open(base + "page.html");
    await waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec === base + "page.html" && !peek.browser().webProgress?.isLoadingDocument, { timeout: 15000, what: "peek loaded" });
    await sleep(1200);
    const pb = peek.browser();
    const count = engine.list(false).length;
    const before = (await serverLog()).length;
    const click = await frame(pb, () => {
      const el = content.document.querySelector("#alt");
      const r = el.getBoundingClientRect();
      let trusted = null;
      let prevented = null;
      el.addEventListener("click", (e) => {
        trusted = e.isTrusted;
        content.setTimeout(() => (prevented = e.defaultPrevented), 0);
      }, { once: true });
      for (const type of ["mousedown", "mouseup"]) content.synthesizeMouseEvent(type, r.left + 5, r.top + r.height / 2, { button: 0, clickCount: 1, modifiers: Ci.nsIDOMWindowUtils.MODIFIER_ALT }, {});
      return { trusted };
    });
    await sleep(2500);
    const after = (await serverLog()).slice(before).map((e) => e.path);
    const prevented = await frame(pb, () => content.location.href);
    log("R2 D Alt+click in the peek: click", JSON.stringify(click), "| peek still on", prevented, "| new downloads", engine.list(false).length - count, "| server requests after the click", JSON.stringify(after));
    // Control: the same Alt+click in the tab itself.
    peek.close();
    await sleep(800);
    const count2 = engine.list(false).length;
    await frame(tab.browser, () => {
      const el = content.document.querySelector("#alt");
      const r = el.getBoundingClientRect();
      for (const type of ["mousedown", "mouseup"]) content.synthesizeMouseEvent(type, r.left + 5, r.top + r.height / 2, { button: 0, clickCount: 1, modifiers: Ci.nsIDOMWindowUtils.MODIFIER_ALT }, {});
      return true;
    });
    await sleep(2500);
    log("R2 D control, Alt+click in the tab: new downloads", engine.list(false).length - count2, "| tab on", tab.browser.currentURI.spec);
  });

  Services.obs.removeObserver(observer, "http-on-modify-request");
  await sleep(300);
});
