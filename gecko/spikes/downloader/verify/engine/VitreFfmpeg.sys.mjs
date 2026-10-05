// ffmpeg, when there is one: Vitre's own copy beside the app, or one on PATH. Only ever used to
// change the container (-c copy). Port of app/src/main/modules/downloads/ffmpeg.ts:
// child_process.spawn becomes Subprocess.sys.mjs (toolkit's own process launcher: CreateProcess
// with CREATE_NO_WINDOW on a worker thread, pipes read asynchronously).
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { AbortedError } from "resource://vitre-boot/engine/VitreNet.sys.mjs";

let cache = null;

function isFile(path) {
  try {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(path);
    return f.exists() && f.isFile();
  } catch {
    return false;
  }
}

/**
 * Where ffmpeg.exe is, or null. Order: VITRE_FFMPEG (dev), <install dir>/ffmpeg/ffmpeg.exe and
 * <install dir>/ffmpeg.exe (where Vitre bundles its copy: the folder of the runtime's exe,
 * "XREExeF"), then PATH.
 */
export async function findFfmpeg() {
  if (cache && Date.now() - cache.at < 60000) return cache.bin;
  const exeDir = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.path;
  const candidates = [
    Services.env.get("VITRE_FFMPEG"),
    Services.env.get("VITRE_DL_FFMPEG"),
    PathUtils.join(exeDir, "ffmpeg", "ffmpeg.exe"),
    PathUtils.join(exeDir, "ffmpeg.exe"),
  ];
  let bin = candidates.find((c) => c && isFile(c)) ?? null;
  if (!bin) {
    try {
      bin = await Subprocess.pathSearch("ffmpeg");
    } catch {
      bin = null;
    }
  }
  cache = { at: Date.now(), bin };
  return bin;
}

/**
 * Run ffmpeg to the end. `onProgress({ seconds, raw })` is called as ffmpeg reports how much
 * media time it has written (-progress pipe:2 puts key=value lines on stderr).
 * Rejects with the tail of stderr when the exit code isn't 0; `signal` kills the process.
 */
export async function runFfmpeg(bin, args, signal = null, onProgress = null) {
  if (signal?.aborted) throw new AbortedError();
  const proc = await Subprocess.call({
    command: bin,
    arguments: ["-nostdin", "-progress", "pipe:2", "-nostats", ...args],
    stderr: "pipe",
  });
  const stop = () => proc.kill(0);
  signal?.addEventListener("abort", stop, { once: true });
  let tail = "";
  let pending = "";
  const drain = async (pipe, each) => {
    for (;;) {
      const chunk = await pipe.readString();
      if (!chunk) return;
      each(chunk);
    }
  };
  // Both pipes must be read or a chatty child blocks on a full pipe.
  const out = drain(proc.stdout, () => {});
  const err = drain(proc.stderr, (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      // out_time_us and out_time_ms carry the same number (microseconds): one of them is enough.
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m) onProgress?.({ seconds: Number(m[1]) / 1e6, raw: line });
      else if (!/^[a-z_0-9]+=/.test(line)) tail = (tail + line + "\n").slice(-2000);
    }
  });
  const { exitCode } = await proc.wait();
  await Promise.all([out, err]).catch(() => {});
  signal?.removeEventListener("abort", stop);
  if (signal?.aborted) throw new AbortedError();
  if (exitCode !== 0) throw new Error(`ffmpeg exited with ${exitCode}: ${tail.trim()}`);
  return { exitCode, stderr: tail.trim() };
}

/** Any console program: stdout and stderr as text. Used by the spike to prove Subprocess. */
export async function runTool(command, args = []) {
  // Subprocess wants a full path; a bare name is looked up on PATH.
  if (!command.includes("\\") && !command.includes("/")) command = await Subprocess.pathSearch(command);
  const proc = await Subprocess.call({ command, arguments: args, stderr: "pipe" });
  let stdout = "";
  let stderr = "";
  const read = async (pipe, add) => {
    for (;;) {
      const chunk = await pipe.readString();
      if (!chunk) return;
      add(chunk);
    }
  };
  await Promise.all([read(proc.stdout, (c) => (stdout += c)), read(proc.stderr, (c) => (stderr += c))]);
  const { exitCode } = await proc.wait();
  return { exitCode, stdout, stderr, pid: proc.pid };
}
