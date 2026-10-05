// Spike helper: quit the normal way (so Firefox writes its session file) and tell the runner only
// once the final session state is on disk. A window script cannot do this: its global is gone by then.
export function cleanQuit(logPath) {
  const write = (line) => {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(logPath);
    const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    s.init(f, 0x02 | 0x08 | 0x10, 0o644, 0);
    s.write(line + "\n", line.length + 1);
    s.close();
  };
  const obs = {
    observe(_s, topic) {
      write("[quit] " + topic);
      if (topic === "sessionstore-final-state-write-complete") write("@@quit");
    },
  };
  Services.obs.addObserver(obs, "quit-application-granted");
  Services.obs.addObserver(obs, "sessionstore-final-state-write-complete");
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}
