// Spike-only logging for system modules: appends to the run's log file (VITRE_LOG), the same file
// tools/spike-lib.js writes to, so engine lines show up in the run output even with no window.
const path = Services.env.get("VITRE_LOG");

export function log(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : safe(a))).join(" ");
  if (!path) {
    dump("[vitre-dl] " + line + "\n");
    return;
  }
  try {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    s.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
    const bin = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    bin.setOutputStream(s);
    bin.writeByteArray(new TextEncoder().encode(line + "\n"));
    s.close();
  } catch (e) {
    dump("[vitre-dl] log failed " + e + "\n");
  }
}

function safe(a) {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
