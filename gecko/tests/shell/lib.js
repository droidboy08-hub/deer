// Helpers shared by the shell tests. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.T. Pixel checks are done afterwards by tests/shell/check.py from the MEASURE lines
// that T.measure() writes next to each capture (a window capture cannot be read back in-process).
/* global spike, Services, ChromeUtils, Ci */
window.T = (() => {
  const { log, sleep, waitFor } = spike;

  /** A data: page. `icon` is SVG markup for its favicon. */
  const page = (title, body, icon) =>
    "data:text/html;charset=utf-8," +
    encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title>${icon ? `<link rel=icon href="data:image/svg+xml,${encodeURIComponent(icon)}">` : ""}${body}`);
  /** A ring-shaped favicon in one flat colour (transparent around and inside). */
  const ring = (fill) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='${fill}' fill-rule='evenodd' d='M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z'/></svg>`;
  /** A favicon that fills its box (brings its own background). */
  const tile = (bg, fg) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3.5' fill='${bg}'/><path d='M4 11V5l4 4 4-4v6' fill='none' stroke='${fg}' stroke-width='1.6'/></svg>`;

  // Vertical stripes with a 6 px period: any horizontal blur shows as lost contrast, and the lens's
  // vertical bending leaves them unchanged, so "is the glass filtering here" is one number.
  const stripesBody = (a, b) => `<body style='margin:0;height:3000px;background:repeating-linear-gradient(90deg,${a} 0 3px,${b} 3px 6px)'>`;
  const pages = {
    wiki: "https://en.wikipedia.org/wiki/Stained_glass",
    white: page("White page", "<body style='margin:0;background:#fff;font:16px Segoe UI;color:#222'><p style='margin:120px 40px'>A white page.</p>", tile("#d9482b", "#fff")),
    dark: page("Dark page", "<body style='margin:0;background:#101014;font:16px Segoe UI;color:#ddd'><p style='margin:120px 40px'>A dark page.</p>", tile("#1d1f24", "#7df3d0")),
    stripes: page("Stripes", stripesBody("#111", "#eee"), tile("#0f8f8a", "#fff")),
    stripesLight: page("Light stripes", stripesBody("#9aa", "#fff"), tile("#0f8f8a", "#fff")),
    stripesDark: page("Dark stripes", stripesBody("#000", "#556"), tile("#0f8f8a", "#fff")),
  };
  /** Background tabs with assorted favicons: full tiles, flat light and flat dark shapes, none. */
  const filler = (i) => {
    const icons = [tile("#0f8f8a", "#fff"), ring("#ffffff"), tile("#f4f2ec", "#1b1d21"), ring("#141416"), tile("#3a6df0", "#fff"), ring("#e0532f"), null, tile("#1d1f24", "#7df3d0"), ring("#f1e9a0"), tile("#7b2fc9", "#fff"), ring("#222831")];
    return page(`Tab ${i + 2}`, `<body style='margin:0;background:hsl(${(i * 47) % 360} 30% 92%);font:16px Segoe UI'><p style='margin:120px 40px'>Tab ${i + 2}</p>`, icons[i % icons.length]);
  };

  const round = (r) => ({ x: Math.round(r.left * 100) / 100, y: Math.round(r.top * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 });
  const rect = (el) => round(el.getBoundingClientRect());

  /** Everything the bar drew in `win`, in window coordinates. */
  function bar(win = window) {
    const d = win.document;
    const items = [...d.querySelectorAll("#vitre-bar .item:not(.leaving)")].map((el) => ({ el, kind: el.classList.contains("plus") ? "plus" : el.classList.contains("active") ? "pill" : "circle", ...rect(el) })).sort((a, c) => a.x - c.x);
    return {
      items,
      pill: items.find((i) => i.kind === "pill"),
      circles: items.filter((i) => i.kind !== "pill"),
      rows: [...d.querySelectorAll("#vitre-bar .row-lens")].map(rect),
      capsule: rect(d.getElementById("vitre-winctl")),
      theme: win.vitre.theme(),
      state: win.vitre.bar.state,
    };
  }

  /** Wait until the bar's motion is over and the final lenses are installed. */
  async function settled(win = window) {
    await waitFor(() => win.vitre.bar.state.settled, { timeout: 5000, what: "bar to settle" });
    await sleep(120);
  }

  /**
   * Write the probes for check.py: for each glass shape a short horizontal segment inside it, away
   * from its content and its caps. Over the stripes pages check.py compares the stripe contrast on
   * that segment with the same columns of the bare page (y = 120).
   * `expect` is "glass" (the lens filters here) or "none" (nothing drawn: bar hidden).
   * `stripes` false says the capture is knowingly not over a striped page (check.py then skips it
   * instead of failing it).
   */
  function measure(capture, win = window, expect = "glass", stripes = true) {
    const info = bar(win);
    const probes = [];
    // A hidden bar is slid out of the window: probe the slots it would be in.
    const dy = expect === "none" && info.pill ? 12 - info.pill.y : 0;
    if (info.pill) probes.push({ name: "pill", x0: info.pill.x + 44, x1: info.pill.x + info.pill.w - 44, y: info.pill.y + dy + 6, max: 0.3 });
    info.circles.forEach((c, i) => {
      // The chord 7/44 of the way down, clear of the cap strips and of the icon.
      const d = Math.max(5, Math.round(c.h * 0.16));
      const half = Math.max(4, Math.round(c.w * 0.22));
      probes.push({ name: (c.kind === "plus" ? "plus" : "circle" + i), x0: c.x + c.w / 2 - half, x1: c.x + c.w / 2 + half, y: c.y + dy + d, max: 0.55 });
    });
    if (expect === "glass") probes.push({ name: "capsule", x0: info.capsule.x + 16, x1: info.capsule.x + info.capsule.w - 16, y: info.capsule.y + 5, max: 0.55 });
    const off = [Math.round(win.mozInnerScreenX - win.screenX), Math.round(win.mozInnerScreenY - win.screenY)];
    log("MEASURE " + capture + " " + JSON.stringify({ off, dpr: win.devicePixelRatio, expect, theme: info.theme, stripes, probes }));
  }

  /** Capture `win` and write its probes. */
  async function shot(name, win = window, expect = "glass", stripes = true) {
    await win.spike.capture(name);
    measure(name, win, expect, stripes);
  }

  // WM_NCHITTEST on the real window: what Windows thinks is at a client point.
  let SendMessageW = null;
  const HT = { 0: "NOWHERE", 1: "CLIENT", 2: "CAPTION", 8: "MINBUTTON", 9: "MAXBUTTON", 10: "LEFT", 11: "RIGHT", 12: "TOP", 13: "TOPLEFT", 14: "TOPRIGHT", 15: "BOTTOM", 16: "BOTTOMLEFT", 17: "BOTTOMRIGHT", 20: "CLOSE" };
  function hit(x, y, win = window) {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    if (!SendMessageW) SendMessageW = ctypes.open("user32.dll").declare("SendMessageW", ctypes.winapi_abi, ctypes.intptr_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const hwnd = ctypes.voidptr_t(ctypes.UInt64(win.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle));
    const dpr = win.devicePixelRatio;
    const sx = Math.round((win.mozInnerScreenX + x) * dpr);
    const sy = Math.round((win.mozInnerScreenY + y) * dpr);
    const n = Number(SendMessageW(hwnd, 0x0084, 0, ((sy & 0xffff) << 16) | (sx & 0xffff)).toString());
    return HT[n] || String(n);
  }
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
  };

  /** Navigate the active tab and wait for it (and for the theme sample that follows a load). */
  async function go(url, win = window) {
    const b = win.vitre;
    const t = b.active();
    b.navigate(t, url);
    await waitFor(() => t.url === url || (url.startsWith("http") && t.url.startsWith(url.slice(0, 20))), { timeout: 30000, what: "navigation to start" });
    await waitFor(() => !t.loading, { timeout: 40000, what: "load of " + url.slice(0, 40) });
    await sleep(500);
    await settled(win);
  }

  /** Make the window have exactly n tabs: the first stays, the others are filler pages. */
  async function tabs(n, win = window) {
    const b = win.vitre;
    while (b.tabs.length > n) b.closeTab(b.tabs[b.tabs.length - 1]);
    for (let i = b.tabs.length; i < n; i++) b.newTab(filler(i - 1), { background: true, index: i });
    await waitFor(() => b.tabs.length === n && b.tabs.every((t) => !t.loading), { timeout: 20000, what: n + " tabs loaded" });
    await sleep(400);
    await settled(win);
  }

  /** Move the pointer (synthesized in-process) to a point or an element's centre. */
  function pointer(target, y, win = window) {
    if (typeof target === "number") win.spike.EU.synthesizeMouseAtPoint(target, y, { type: "mousemove" }, win);
    else win.spike.EU.synthesizeMouseAtCenter(target, { type: "mousemove" }, win);
  }

  return { page, ring, tile, pages, filler, rect, bar, settled, measure, shot, hit, centre, go, tabs, pointer };
})();
