// Settings › Appearance › App icon: the two tiles, the window icon switching live (read back with
// WM_GETICON by run.py --identity), a new window opening with the chosen icon, and Deer's shortcuts
// pointed at the chosen .ico. The shortcut is a copy of a template .lnk in the profile, handed to
// VitreAppIcon.testShortcuts, so no real Start menu, desktop or taskbar shortcut is touched.
//   node tools/build.mjs --out=build-settings --modules=settings
//   python tools/run.py --app build-settings --test tests/settings/appicon.js --name settings-appicon --timeout 160 --identity
// Captures: appicon-tiles.png (Appearance, dark), appicon-orange.png and appicon-new-window.png (each
// with .icon.png, the window's own icon), appicon-gold.png (back to the default).
/* global spike, ChromeUtils, IOUtils, PathUtils */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const store = b.sys("VitreSettings");
  const AppIcon = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreAppIcon.sys.mjs").VitreAppIcon;
  await spike.resize(1280, 860);
  await spike.activate();
  store.set({ theme: "dark" });
  await waitFor(() => window.matchMedia("(prefers-color-scheme: dark)").matches, { timeout: 10000, what: "dark chrome" });

  // A shortcut to notepad.exe with notepad's own icon (made with WScript.Shell, 1660 bytes).
  const TEMPLATE = "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";
  const lnk = PathUtils.join(PathUtils.profileDir, "Deer-appicon-test.lnk");
  await IOUtils.write(lnk, Uint8Array.from(atob(TEMPLATE), (c) => c.charCodeAt(0)));
  const utf16 = (text) => Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]));
  const contains = (bytes, text) => {
    const pat = utf16(text.toLowerCase());
    const low = bytes.map((x) => (x >= 65 && x <= 90 ? x + 32 : x));
    outer: for (let i = 0; i + pat.length <= low.length; i++) {
      for (let j = 0; j < pat.length; j++) if (low[i + j] !== pat[j]) continue outer;
      return true;
    }
    return false;
  };
  const iconOf = async () => {
    const bytes = await IOUtils.read(lnk);
    return contains(bytes, "deer-orange.ico") ? "orange" : contains(bytes, "vitre.ico") ? "gold" : contains(bytes, "notepad.exe") ? "notepad" : "?";
  };
  check("template shortcut written, notepad's icon", (await iconOf()) === "notepad");
  AppIcon.testShortcuts = [lnk];

  // ---- default ----
  store.reset("appIcon");
  check("default app icon is gold, window root icon=vitre", store.get().appIcon === "gold" && document.documentElement.getAttribute("icon") === "vitre", { appIcon: store.get().appIcon, icon: document.documentElement.getAttribute("icon") });
  check("new windows are branded with the setting's icon", AppIcon.iconName() === "vitre");

  // ---- the tiles ----
  const svc = b.service("settings");
  svc.open("appearance");
  const root = () => document.getElementById("vitre-settings");
  await waitFor(() => root()?.querySelector(".vs-appicons"), { timeout: 10000, what: "App icon tiles" });
  const tiles = () => [...root().querySelectorAll(".vs-appicons .vs-style")];
  check("two tiles, Gold checked and marked Default", tiles().length === 2 && tiles()[0].getAttribute("aria-checked") === "true" && /Default/.test(tiles()[0].textContent) && tiles()[1].getAttribute("aria-checked") === "false", tiles().map((t) => [t.dataset.value, t.getAttribute("aria-checked"), t.textContent]));
  const imgs = [...root().querySelectorAll(".vs-appicons img")];
  await waitFor(() => imgs.every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000, what: "previews loaded" });
  check("previews load (128 px)", imgs.every((i) => i.naturalWidth === 128), imgs.map((i) => [i.src, i.naturalWidth]));
  tiles()[1].scrollIntoView({ block: "center" });
  await sleep(500);
  await spike.capture("appicon-tiles");

  // ---- choose Orange ----
  spike.click(tiles()[1]);
  await waitFor(() => AppIcon.last?.name === "deer-orange", { timeout: 10000, what: "orange applied" });
  check("Orange tile checked, setting stored", tiles()[1].getAttribute("aria-checked") === "true" && store.get().appIcon === "orange");
  check("open windows switched (root icon=deer-orange)", AppIcon.last.windows >= 1 && document.documentElement.getAttribute("icon") === "deer-orange" && !AppIcon.last.error, AppIcon.last);
  check("shortcut points at deer-orange.ico", AppIcon.last.shortcuts.includes(lnk) && (await iconOf()) === "orange", { last: AppIcon.last, now: await iconOf() });
  svc.close();
  await sleep(600);
  await spike.capture("appicon-orange");

  const w2 = await spike.openWindow();
  check("a new window opens with the orange icon", w2.document.documentElement.getAttribute("icon") === "deer-orange", w2.document.documentElement.getAttribute("icon"));
  await w2.spike.capture("appicon-new-window");
  w2.close();
  await sleep(300);

  // ---- back to Gold with the keyboard ----
  svc.open("appearance");
  await waitFor(() => root()?.querySelector(".vs-appicons"), { timeout: 10000, what: "tiles again" });
  tiles()[1].focus();
  spike.press("ArrowLeft");
  await waitFor(() => AppIcon.last?.name === "vitre", { timeout: 10000, what: "gold applied" });
  check("ArrowLeft picks Gold; window and shortcut follow", store.get().appIcon === "gold" && document.documentElement.getAttribute("icon") === "vitre" && (await iconOf()) === "gold", { appIcon: store.get().appIcon, icon: document.documentElement.getAttribute("icon"), lnk: await iconOf() });
  svc.close();
  await sleep(600);
  await spike.capture("appicon-gold");

  // ---- a development run owns no shortcuts ----
  AppIcon.testShortcuts = null;
  store.set({ appIcon: "orange" });
  await waitFor(() => AppIcon.last?.name === "deer-orange", { timeout: 10000, what: "orange again" });
  check("without install.ini no real shortcut is touched", AppIcon.last.shortcuts.length === 0 && !AppIcon.last.error, AppIcon.last);
  store.reset("appIcon");
  await waitFor(() => AppIcon.last?.name === "vitre", { timeout: 10000, what: "gold again" });
  await IOUtils.remove(lnk, { ignoreAbsent: true });
  log("done");
});
