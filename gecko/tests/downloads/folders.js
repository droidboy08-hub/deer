// Deer's own folders under %LOCALAPPDATA% for what it downloads for the person (ffmpeg, yt-dlp and
// Deno), on fake roots in %TEMP% (the pref vitre.localAppData; never the person's real folders):
//   1. nothing downloaded: new downloads would go to <root>\Deer\ffmpeg and <root>\Deer\tools, and
//      nothing is found;
//   2. copies downloaded before the rename, in <root>\Vitre\ffmpeg and <root>\Vitre\tools, are found
//      and used where they are (Settings › Video downloads says so and offers no download), and
//      nothing in that folder is written, moved or deleted; Deer's folder is not even created;
//   3. copies in Deer's own folder come first; a half pair (no Deno) there leaves the old pair in use;
//      the path chosen in Settings still wins over both.
// The stand-in files are text, not programs: they are only looked for, never run for real.
/* global spike, Services, IOUtils, PathUtils */
spike.main(async () => {
  const { check, waitFor, sleep, log } = spike;
  const b = window.vitre;
  await spike.resize(1280, 860);
  await spike.activate();
  const engine = b.sys("VitreDownloads");
  const store = b.sys("VitreSettings");
  // tools/run.py points vitre.localAppData into the throwaway profile; it is put back at the end, so
  // nothing after this test can reach the real %LOCALAPPDATA%.
  const harnessRoot = Services.prefs.getStringPref("vitre.localAppData", "");
  if (!check("the harness keeps %LOCALAPPDATA% out of reach (vitre.localAppData is set)", !!harnessRoot, harnessRoot)) return;
  const base = PathUtils.join(PathUtils.tempDir, "vitre-dl-folders-" + Services.appinfo.processID);
  await IOUtils.remove(base, { recursive: true, ignoreAbsent: true });
  for (const p of ["vitre.ffmpeg.installDir", "vitre.tools.installDir", "vitre.tools.ytdlpCommand"]) Services.prefs.clearUserPref(p);
  store.set({ ffmpegPath: "" });
  await sleep(100);

  const put = async (path) => {
    await IOUtils.makeDirectory(PathUtils.parent(path), { createAncestors: true, ignoreExisting: true });
    await IOUtils.writeUTF8(path, "not a program: a stand-in for tests/downloads/folders.js\n");
  };
  /** Every file under `dir` with its size and modification time, sorted. */
  const snapshot = async (dir) => {
    const out = [];
    const walk = async (d) => {
      for (const p of await IOUtils.getChildren(d)) {
        const st = await IOUtils.stat(p);
        if (st.type === "directory") await walk(p);
        else out.push(`${p}|${st.size}|${st.lastModified}`);
      }
    };
    await walk(dir);
    return out.sort();
  };
  const useRoot = (name) => {
    const root = PathUtils.join(base, name);
    Services.prefs.setStringPref("vitre.localAppData", root);
    return root;
  };
  const deer = (root, ...p) => PathUtils.join(root, "Deer", ...p);
  const vitre = (root, ...p) => PathUtils.join(root, "Vitre", ...p);

  // ---- 1. nothing downloaded ----
  const empty = useRoot("empty");
  const f0 = engine.toolFolders();
  log("folders: " + JSON.stringify(f0));
  check("ffmpeg, yt-dlp and Deno are downloaded to %LOCALAPPDATA%\\Deer", f0.ffmpeg === deer(empty, "ffmpeg") && f0.tools === deer(empty, "tools"), f0);
  check("copies from before the rename are read from %LOCALAPPDATA%\\Vitre", f0.oldFfmpeg === vitre(empty, "ffmpeg") && f0.oldTools === vitre(empty, "tools"), f0);
  const ff0 = await engine.ffmpeg();
  check("nothing downloaded: no ffmpeg from either folder", ff0.source !== "downloaded", ff0);
  check("nothing downloaded: yt-dlp is not installed", !engine.hasYtdlp() && f0.ytdlpFrom === "", f0);

  // ---- 2. copies from before the rename ----
  const old = useRoot("old");
  const oldFf = vitre(old, "ffmpeg", "ffmpeg.exe");
  for (const p of [oldFf, vitre(old, "ffmpeg", "LICENSE.txt"), vitre(old, "tools", "yt-dlp.exe"), vitre(old, "tools", "deno.exe")]) await put(p);
  const before = await snapshot(vitre(old));
  await sleep(1100); // a write would now change a modification time
  const ff1 = await engine.ffmpeg();
  check("an ffmpeg downloaded before the rename is found where it is", ff1.path === oldFf && ff1.source === "downloaded", ff1);
  const f1 = engine.toolFolders();
  check("yt-dlp and Deno installed before the rename are used where they are", engine.hasYtdlp() && f1.ytdlpFrom === vitre(old, "tools"), f1);

  const settings = await b.whenService("settings");
  settings.open("video-downloads");
  const $ = (id) => document.getElementById(id);
  const status = () => document.querySelector("#vitre-settings .vs-path");
  await waitFor(() => status()?.textContent.includes(oldFf), { timeout: 8000, what: "the ffmpeg row" });
  await waitFor(() => $("vd-yt-get")?.textContent === "Update", { timeout: 8000, what: "the yt-dlp row" }).catch(() => null);
  await sleep(300);
  check("Settings › Video downloads uses that ffmpeg and offers no download", status().textContent === "Downloaded copy: " + oldFf && $("vd-ff-get-row").hidden, [status().textContent, $("vd-ff-get-row").hidden]);
  check("Settings › Video downloads counts yt-dlp as installed (Update, not Download)", $("vd-yt-get").textContent === "Update", [$("vd-yt-get").textContent, $("vd-yt-status").textContent]);
  await spike.capture("folders-old");
  settings.close();
  await waitFor(() => !settings.isOpen(), { what: "Settings closed" });

  const after = await snapshot(vitre(old));
  check("nothing in the old folder was written, moved or deleted", JSON.stringify(after) === JSON.stringify(before), { before, after });
  check("Deer's folder is not created just by looking", !(await IOUtils.exists(deer(old))));

  // ---- 3. Deer's own folder first ----
  const both = useRoot("both");
  for (const p of [vitre(both, "ffmpeg", "ffmpeg.exe"), vitre(both, "tools", "yt-dlp.exe"), vitre(both, "tools", "deno.exe"), deer(both, "ffmpeg", "ffmpeg.exe"), deer(both, "tools", "yt-dlp.exe")]) await put(p);
  const half = engine.toolFolders();
  check("a half pair in Deer's folder (no Deno yet) leaves the old pair in use", half.ytdlpFrom === vitre(both, "tools"), half);
  await put(deer(both, "tools", "deno.exe"));
  const ff2 = await engine.ffmpeg();
  check("Deer's own ffmpeg comes before the old one", ff2.path === deer(both, "ffmpeg", "ffmpeg.exe") && ff2.source === "downloaded", ff2);
  const f2 = engine.toolFolders();
  check("Deer's own yt-dlp and Deno come before the old ones", f2.ytdlpFrom === deer(both, "tools"), f2);
  const chosen = vitre(both, "ffmpeg", "ffmpeg.exe");
  store.set({ ffmpegPath: chosen });
  await waitFor(() => b.settings.ffmpegPath === chosen, { what: "the setting" });
  const ff3 = await engine.ffmpeg();
  check("the file chosen in Settings still wins", ff3.path === chosen && ff3.source === "settings", ff3);
  store.set({ ffmpegPath: "" });

  Services.prefs.setStringPref("vitre.localAppData", harnessRoot);
  await IOUtils.remove(base, { recursive: true, ignoreAbsent: true });
  check("the fake roots are removed", !(await IOUtils.exists(base)));
});
