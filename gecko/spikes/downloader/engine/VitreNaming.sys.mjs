// File names: from Content-Disposition, the address or a video's title; made safe for Windows and
// unique in the folder. Port of app/src/main/modules/downloads/naming.ts. Only two things changed:
// Buffer -> TextDecoder for the Latin-1/UTF-8 repair, and fs.existsSync -> nsIFile.exists().

const EXT = {
  video: ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "3gp", "ts", "m2ts", "mts", "mpg", "mpeg", "ogv"],
  music: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "aiff", "alac", "mid", "midi"],
  documents: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pps", "ppsx", "txt", "rtf", "odt", "ods", "odp", "epub", "csv", "md", "json", "xml"],
  compressed: ["zip", "rar", "7z", "gz", "tgz", "bz2", "xz", "tar", "zst", "cab", "lz", "lzma", "z"],
  programs: ["exe", "msi", "msix", "msixbundle", "appx", "appxbundle", "bat", "cmd", "ps1", "iso", "img", "vhd", "vhdx", "apk", "dmg", "jar"],
  images: ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff", "svg", "ico", "raw", "psd"],
  other: [],
};

const MIME_EXT = {
  "application/pdf": "pdf", "application/zip": "zip", "application/x-zip-compressed": "zip", "application/x-7z-compressed": "7z",
  "application/vnd.rar": "rar", "application/x-rar-compressed": "rar", "application/gzip": "gz", "application/x-msdownload": "exe",
  "application/x-msi": "msi", "application/json": "json", "application/epub+zip": "epub", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt", "text/csv": "csv", "text/html": "html", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "video/x-matroska": "mkv", "video/mp2t": "ts", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg",
  "audio/wav": "wav", "audio/flac": "flac", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg",
};

export function extOf(name) {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function categoryOf(name, mime = "") {
  const ext = extOf(name);
  for (const [cat, list] of Object.entries(EXT)) if (list.includes(ext)) return cat;
  const m = mime.toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "music";
  if (m.startsWith("image/")) return "images";
  return "other";
}

/** Content-Disposition: filename*=UTF-8''... wins over filename="...". */
export function nameFromDisposition(value) {
  if (!value) return "";
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*("((?:\\.|[^"\\])*)"|[^;]+)/i.exec(value);
  if (!plain) return "";
  let name = (plain[2] ?? plain[1]).trim().replace(/\\(.)/g, "$1");
  // Necko hands header bytes over as Latin-1; many servers send raw UTF-8.
  if (/[\u0080-\u00ff]/.test(name) && !/[\u0100-\uffff]/.test(name)) {
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(name, (c) => c.charCodeAt(0)));
    } catch {
      /* it really was Latin-1 */
    }
  }
  return name;
}

export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
}

/** Windows-safe: no reserved characters or names, no trailing dots or spaces, a sane length. */
export function sanitize(raw, fallback = "download") {
  let name = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = `_${name}`;
  if (!name || /^\.+$/.test(name)) name = fallback;
  if (name.length > 180) {
    const ext = extOf(name);
    name = ext ? `${name.slice(0, 175 - ext.length).trim()}.${ext}` : name.slice(0, 180).trim();
  }
  return name;
}

/** Make sure the name says what the file is when the server told us and the name doesn't. */
export function withExtension(name, mime) {
  if (extOf(name)) return name;
  const ext = MIME_EXT[mime.split(";")[0].trim().toLowerCase()];
  return ext ? `${name}.${ext}` : name;
}

/** `master.m3u8`, `index`, `720p` or a long hex token: not a name anyone would choose. */
export function isOpaque(name) {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  if (["master", "index", "playlist", "video", "audio", "stream", "manifest", "hls", "main", "media", "chunklist", "videoplayback", "download", "file"].includes(base)) return true;
  if (/^(\d{3,4}p|file\s+\d+|seg(ment)?[-_]?\d+)$/.test(base)) return true;
  const compact = base.replace(/[^a-z0-9]/g, "");
  return compact.length >= 16 && /^[0-9a-f]+$/.test(compact);
}

/** The best name for a download: what the server says, what the browser suggested, the address, or the page. */
export function chooseName(opts) {
  let name = nameFromDisposition(opts.disposition ?? "") || opts.suggested || nameFromUrl(opts.url);
  if ((!name || isOpaque(name)) && opts.title) name = `${opts.title}${extOf(name) ? `.${extOf(name)}` : ""}`;
  let host = "download";
  try {
    host = new URL(opts.url).hostname || host;
  } catch {
    /* keep */
  }
  return sanitize(withExtension(name || host, opts.mime ?? ""), host);
}

function exists(path) {
  try {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(path);
    return f.exists();
  } catch {
    return false;
  }
}

/** `name.ext`, then `name (1).ext`... free on disk (with its .part) and not taken by another download. */
export function uniquePath(dir, name, taken = () => false) {
  const ext = extOf(name);
  const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
  for (let n = 0; n < 10000; n++) {
    const candidate = PathUtils.join(dir, n === 0 ? name : `${stem} (${n})${ext ? `.${ext}` : ""}`);
    if (!taken(candidate) && !exists(candidate) && !exists(`${candidate}.part`)) return candidate;
  }
  return PathUtils.join(dir, `${stem} (${Date.now()})${ext ? `.${ext}` : ""}`);
}
