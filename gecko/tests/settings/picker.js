// Home's background: Settings › Home and background › Browse opens the REAL Windows file dialog
// (nsIFilePicker), driven end to end as the switcher verifier did (spikes/switcher/verify/v-home.js
// H4): find the dialog by its title, put the path in its file name box (WM_SETTEXT), press Open
// (WM_COMMAND IDOK). No OS focus or real input. Then the Home page shows the picked picture, the
// tile appears in the picker, and Home's own Background popover (the circle on Home) chooses
// the Windows wallpaper and None. Also Downloads › Save files to › Change through the real folder
// dialog.
//   node tools/build.mjs --out=build-settings --modules=settings
//   python tools/run.py --app build-settings --test tests/settings/picker.js --name settings-picker --timeout 240
// Captures: picker-settings.png (the picked tile, checked), picker-home.png (Home showing it),
// picker-popover.png (board HomeBackground), picker-none.png, picker-video.png (a clip picked).
/* global spike, Services, Ci, Cc, ChromeUtils, IOUtils, PathUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const store = b.sys("VitreSettings");
  await spike.resize(1440, 900);
  await spike.activate();
  const settle = (ms = 400) => sleep(ms);
  const { panel, home, bg } = window.vitreSettingsPanel;
  const root = () => document.getElementById("vitre-settings");
  store.set({ theme: "dark" });
  await waitFor(() => window.matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });

  // ---------------------------------------------------------------- a picture to pick
  const dir = PathUtils.join(PathUtils.profileDir, "vitre-test-media");
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  const imgPath = PathUtils.join(dir, "picked background é #1.png");
  {
    const c = new OffscreenCanvas(1600, 900);
    const g = c.getContext("2d");
    g.fillStyle = "#1f3b4d";
    g.fillRect(0, 0, 1600, 900);
    g.fillStyle = "#d9b38c";
    g.beginPath();
    g.arc(1180, 300, 170, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2c5a52";
    g.fillRect(0, 620, 1600, 280);
    g.fillStyle = "#ffffff";
    g.font = "600 56px Segoe UI";
    g.fillText("Picked in the real Windows file dialog", 80, 800);
    const blob = await c.convertToBlob({ type: "image/png" });
    await IOUtils.write(imgPath, new Uint8Array(await blob.arrayBuffer()));
  }

  // ---------------------------------------------------------------- Home in a tab
  b.newTab();
  await settle(300);
  if (b.omni.open) b.omni.close();
  const homeDoc = () => b.active().browser.contentDocument?.documentElement;
  await waitFor(() => b.active().url === "about:vitre-home" && homeDoc()?.dataset.state, { timeout: 15000, what: "Home page" });
  await settle(500);
  log("Home starts with", { ...homeDoc().dataset });

  // ---------------------------------------------------------------- the real dialog (user32 through js-ctypes)
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = ctypes.open("user32.dll");
  const HWND = ctypes.voidptr_t;
  const FindWindowW = user32.declare("FindWindowW", ctypes.winapi_abi, HWND, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
  const FindWindowExW = user32.declare("FindWindowExW", ctypes.winapi_abi, HWND, HWND, HWND, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
  const SendText = user32.declare("SendMessageTimeoutW", ctypes.winapi_abi, ctypes.uintptr_t, HWND, ctypes.uint32_t, ctypes.uintptr_t, ctypes.char16_t.ptr, ctypes.uint32_t, ctypes.uint32_t, ctypes.uintptr_t.ptr);
  const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, HWND, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
  /** Wait for the dialog called `title`, type `path` into its file name box and press Open / Select Folder. */
  const answerDialog = async (title, path) => {
    let hwnd = null;
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      hwnd = FindWindowW(null, title);
      if (!hwnd.isNull()) break;
    }
    if (!hwnd || hwnd.isNull()) return "dialog not found";
    await sleep(800); // let the shell finish building the dialog
    // The file name box: ComboBoxEx32 > ComboBox > Edit (Open dialog); a folder dialog has the same
    // chain for its "Folder:" box, else a plain Edit.
    const combo = FindWindowExW(hwnd, null, "ComboBoxEx32", null);
    const inner = combo.isNull() ? combo : FindWindowExW(combo, null, "ComboBox", null);
    let edit = inner.isNull() ? inner : FindWindowExW(inner, null, "Edit", null);
    if (edit.isNull()) edit = FindWindowExW(hwnd, null, "Edit", null);
    if (edit.isNull()) {
      PostMessageW(hwnd, 0x0010 /* WM_CLOSE */, 0, 0);
      return "no file name box";
    }
    const out = ctypes.uintptr_t(0);
    SendText(edit, 0x000c /* WM_SETTEXT */, 0, path, 0x0002 /* SMTO_ABORTIFHUNG */, 3000, out.address());
    await sleep(300);
    PostMessageW(hwnd, 0x0111 /* WM_COMMAND */, 1 /* IDOK */, 0);
    // A folder dialog first navigates into a typed folder; the second Select Folder picks it.
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      if (FindWindowW(null, title).isNull()) return "answered";
    }
    PostMessageW(hwnd, 0x0111 /* WM_COMMAND */, 1 /* IDOK */, 0);
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      if (FindWindowW(null, title).isNull()) return "answered twice";
    }
    PostMessageW(hwnd, 0x0010 /* WM_CLOSE */, 0, 0);
    return "dialog stayed open";
  };

  b.service("settings").open("home");
  await waitFor(() => root().querySelector(".hb-picker")?.dataset.ready, { timeout: 5000, what: "picker" });
  await settle(500);
  const browse = [...root().querySelectorAll(".vs-btn")].find((x) => x.textContent === "Browse");
  check("Settings › Home and background has Browse", !!browse);
  browse.scrollIntoView({ block: "center" });
  await settle(200);
  const since = Date.now();
  spike.click(browse);
  const how = await answerDialog("Choose a photo or video for Home", imgPath);
  check("the real Open dialog came up with Vitre's title and took the path", how === "answered", how);
  root().querySelector(".vs-main").scrollTop = 0;
  await waitFor(() => store.get().homeBackground.path === imgPath, { timeout: 10000, what: "setting from the dialog" }).catch(() => null);
  const hb = store.get().homeBackground;
  check("the picked file became the background (kind image, exact path with space, é and #)", hb.kind === "image" && hb.path === imgPath, hb);
  await waitFor(() => homeDoc()?.dataset.kind === "image" && homeDoc()?.dataset.state === "ready", { timeout: 10000, what: "Home shows it" }).catch(() => null);
  check("the open Home page shows it at once", homeDoc()?.dataset.kind === "image" && homeDoc()?.dataset.state === "ready", { ...homeDoc()?.dataset, ms: Date.now() - since });
  let recent = [];
  try {
    recent = JSON.parse(Services.prefs.getStringPref("vitre.home.recent", "[]"));
  } catch {}
  check("the file joined the recent list (vitre.home.recent, not a Settings field)", recent[0]?.path === imgPath && !("recent" in store.get()), recent);
  await settle(600);
  const tile = [...root().querySelectorAll(".hb-tile")].find((x) => x.dataset.path === imgPath);
  check("the picker shows it as a tile, checked", tile && tile.getAttribute("aria-checked") === "true", tile && tile.getAttribute("aria-label"));
  await spike.capture("picker-settings");
  panel.close();
  await settle(500);
  await spike.capture("picker-home");

  // ---------------------------------------------------------------- the circle and popover on Home
  const circle = document.getElementById("vitre-home-bg");
  check("the Change background circle shows on Home", circle && !circle.classList.contains("off"));
  spike.click(circle.querySelector(".hb-circle-face"));
  await waitFor(() => home.isOpen && document.querySelector("#vitre-home-bg-pop .hb-picker")?.dataset.ready, { timeout: 5000, what: "popover" });
  await settle(700);
  const pop = document.getElementById("vitre-home-bg-pop");
  const pr = pop.getBoundingClientRect();
  check("the Background popover opens bottom right, 340 wide, over Home", Math.round(pr.width) === 340 && Math.round(window.innerWidth - pr.right) === 20 && Math.round(window.innerHeight - pr.bottom) === 76, [pr.left, pr.top, pr.width, pr.height]);
  // Show the photo tiles from the top (the picked file is first after the wallpaper).
  await spike.capture("picker-popover");
  const wpTile = pop.querySelector('.hb-tile[data-kind="windows"]');
  if (wpTile) {
    spike.click(wpTile);
    await waitFor(() => store.get().homeBackground.kind === "windows", { timeout: 3000, what: "windows wallpaper" }).catch(() => null);
    check("choosing Your Windows wallpaper in the popover sets it", store.get().homeBackground.kind === "windows");
    await waitFor(() => homeDoc()?.dataset.kind === "windows" && homeDoc()?.dataset.state === "ready", { timeout: 10000, what: "Home on the wallpaper" }).catch(() => null);
  } else {
    log("no Windows wallpaper on this machine: tile not offered");
  }
  spike.click([...pop.querySelectorAll('.hb-tabs [role="tab"]')].find((x) => x.textContent === "None"));
  await settle(300);
  spike.click(pop.querySelector('.hb-tile[data-kind="none"]'));
  await waitFor(() => store.get().homeBackground.kind === "none", { timeout: 3000, what: "none" }).catch(() => null);
  await waitFor(() => homeDoc()?.dataset.kind === "none", { timeout: 5000, what: "Home plain" }).catch(() => null);
  check("None in the popover gives Home a plain background", store.get().homeBackground.kind === "none" && homeDoc()?.dataset.kind === "none");
  await settle(400);
  await spike.capture("picker-none");
  spike.press("Escape");
  await settle(300);
  check("Esc closes the popover", !home.isOpen && !document.getElementById("vitre-home-bg-pop"));
  // changeBackground() (the Home wallpaper menu's "Change background…") opens the popover on Home.
  b.service("settings").changeBackground();
  await settle(400);
  check("changeBackground() on Home opens the popover", home.isOpen);
  b.service("settings").open("general");
  await settle(400);
  check("Settings taking the window closes the popover", !home.isOpen && panel.isOpen);
  panel.close();
  await settle(300);

  // ---------------------------------------------------------------- a video, through the dialog again
  const vidPath = PathUtils.join(dir, "loop clip.webm");
  {
    const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    c.width = 320;
    c.height = 180;
    const g = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    const t0 = performance.now();
    await new Promise((r) => {
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = `hsl(${200 + t * 40} 45% 28%)`;
        g.fillRect(0, 0, 320, 180);
        if (t < 2) requestAnimationFrame(frame);
        else r();
      };
      frame();
    });
    rec.stop();
    await stopped;
    await IOUtils.write(vidPath, new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
  }
  b.service("settings").open("home");
  await settle(500);
  const browse2 = [...root().querySelectorAll(".vs-btn")].find((x) => x.textContent === "Browse");
  browse2.scrollIntoView({ block: "center" });
  await settle(200);
  spike.click(browse2);
  const how3 = await answerDialog("Choose a photo or video for Home", vidPath);
  await waitFor(() => store.get().homeBackground.path === vidPath, { timeout: 10000, what: "video setting" }).catch(() => null);
  check("a .webm picked in the dialog becomes a video background", store.get().homeBackground.kind === "video" && store.get().homeBackground.path === vidPath, { how: how3, bg: store.get().homeBackground });
  await waitFor(() => root().querySelector('.hb-tabs [aria-selected="true"]')?.textContent === "Video" && root().querySelector(".hb-tile[aria-checked='true']")?.dataset.kind === "video", { timeout: 5000, what: "video tile" }).catch(() => null);
  check("the picker turns to its Video tab with the clip checked", root().querySelector('.hb-tabs [aria-selected="true"]')?.textContent === "Video" && root().querySelector(".hb-tile[aria-checked='true']")?.dataset.path === vidPath);
  root().querySelector(".vs-main").scrollTop = 0;
  await settle(600);
  await spike.capture("picker-video");
  panel.close();
  await waitFor(() => homeDoc()?.dataset.kind === "video" && homeDoc()?.dataset.state === "ready", { timeout: 10000, what: "Home video" }).catch(() => null);
  check("Home plays it (muted, looping) while it is on screen", homeDoc()?.dataset.kind === "video" && homeDoc()?.dataset.playing === "true", { ...homeDoc()?.dataset });
  await settle(300);

  // A file that has gone: choosing its tile says so and keeps the background.
  await IOUtils.remove(imgPath);
  store.set({ homeBackground: { kind: "none", path: "" } });
  await settle(200);
  await bg.chooseTile({ kind: "image", path: imgPath, label: "gone" });
  check("a tile whose file has gone is refused with a note, the background stays", store.get().homeBackground.kind === "none" && /Couldn’t open picked background é #1\.png/.test(bg.error || ""), bg.error);

  // ---------------------------------------------------------------- Downloads › Save files to (folder dialog)
  const folder = PathUtils.join(PathUtils.profileDir, "vitre-test-downloads");
  await IOUtils.makeDirectory(folder, { createAncestors: true });
  b.service("settings").open("downloads");
  await settle(400);
  const change = [...root().querySelectorAll(".vs-btn")].find((x) => x.textContent === "Change");
  spike.click(change);
  const how2 = await answerDialog("Save downloads to", folder);
  await waitFor(() => store.get().downloadsFolder === folder, { timeout: 8000, what: "downloads folder" }).catch(() => null);
  check("Save files to › Change: the real folder dialog sets downloadsFolder", store.get().downloadsFolder === folder, { how: how2, folder: store.get().downloadsFolder });
  const shown = [...root().querySelectorAll(".vs-row")].find((x) => x.querySelector(".vs-title")?.textContent === "Save files to")?.querySelector(".vs-desc")?.textContent;
  check("…and the row shows it", shown === folder, shown);
  panel.close();
  user32.close();
  store.reset("homeBackground.kind");
  store.reset("homeBackground.path");
  store.reset("downloadsFolder");
  store.reset("theme");
  await settle(300);
});
