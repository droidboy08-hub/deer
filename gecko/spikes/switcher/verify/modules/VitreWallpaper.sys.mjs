// The user's Windows desktop wallpaper (Home's default background) and image luma.
// Parent process only. Port of app/src/main/wallpaper.ts.

function file(path) {
  const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

export const VitreWallpaper = {
  /** HKCU\Control Panel\Desktop\WallPaper, or "" when it is not set. */
  registryPath() {
    const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
    try {
      key.open(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER, "Control Panel\\Desktop", Ci.nsIWindowsRegKey.ACCESS_READ);
      return key.hasValue("WallPaper") ? key.readStringValue("WallPaper") : "";
    } catch (e) {
      return "";
    } finally {
      try { key.close(); } catch (e) {}
    }
  },

  /** %APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper (what the desktop shows right now; no extension). */
  transcodedPath() {
    const appdata = Services.env.get("APPDATA");
    return appdata ? PathUtils.join(appdata, "Microsoft", "Windows", "Themes", "TranscodedWallpaper") : "";
  },

  /** The wallpaper file to use, or null. Registry path first, like the Electron build. */
  async find() {
    const reg = this.registryPath();
    if (reg && (await IOUtils.exists(reg).catch(() => false))) return { path: reg, source: "registry" };
    const tr = this.transcodedPath();
    if (tr && (await IOUtils.exists(tr).catch(() => false))) return { path: tr, source: "transcoded" };
    return null;
  },

  /** file:// URL for a path (handles spaces, #, non-ASCII). */
  fileURL(path) {
    return Services.io.newFileURI(file(path)).spec;
  },

  /**
   * Mean luma (0..1) of an image file, decoded straight to a tiny bitmap.
   * `win` is any chrome window (createImageBitmap and OffscreenCanvas live on window globals).
   * The file is read as bytes so a missing extension (TranscodedWallpaper) does not matter.
   */
  async meanLuma(win, path) {
    const bytes = await IOUtils.read(path);
    const bmp = await win.createImageBitmap(new win.Blob([bytes]), { resizeWidth: 64, resizeHeight: 36, resizeQuality: "low" });
    const c = new win.OffscreenCanvas(64, 36);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const d = ctx.getImageData(0, 0, 64, 36).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  },
};
