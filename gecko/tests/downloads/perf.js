// Diagnostic: where main-thread stalls come from during a fast multi-connection download.
//   A  network only: 8 throttled channels whose bytes are discarded
//   B  disk only: 256 MiB written through pipe + async copier at 8 offsets
//   C  the engine (network + disk)
// Lag is measured with a system-scope timer (Timer.sys.mjs), not a window timer.
/* global spike, Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils, DL */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);

spike.main(async () => {
  const { log, sleep } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const { setInterval, clearInterval } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");

  const lagMeter = () => {
    let last = ChromeUtils.now();
    const stalls = [];
    let worst = 0;
    const t0 = last;
    const timer = setInterval(() => {
      const now = ChromeUtils.now();
      const l = now - last - 20;
      last = now;
      worst = Math.max(worst, l);
      if (l > 200) stalls.push([Math.round(now - t0), Math.round(l)]);
    }, 20);
    return () => {
      clearInterval(timer);
      return { worst: Math.round(worst), stalls };
    };
  };

  // A: network only.
  {
    await DL.reset();
    const stop = lagMeter();
    const t0 = Date.now();
    const size = DL.manifest["big.bin"].size;
    const seg = size / 8;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => new Promise((resolve) => {
        const ch = NetUtil.newChannel({ uri: `${DL.base}/blob/big?rate=8192`, loadUsingSystemPrincipal: true });
        ch.QueryInterface(Ci.nsIHttpChannel).setRequestHeader("Range", `bytes=${i * seg}-${(i + 1) * seg - 1}`, false);
        const cjs = Cc["@mozilla.org/cookieJarSettings;1"].createInstance(Ci.nsICookieJarSettings);
        cjs.initWithURI(Services.io.newURI(`https://vitre-lane-${i}.invalid/`), false);
        ch.loadInfo.cookieJarSettings = cjs;
        let got = 0;
        ch.asyncOpen({
          onStartRequest() {},
          onDataAvailable(_r, stream, _o, count) {
            const s = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
            s.init(stream);
            s.readBytes(count);
            got += count;
          },
          onStopRequest() {
            resolve(got);
          },
          QueryInterface: ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver"]),
        });
      }))
    );
    log("A network only", { secs: (Date.now() - t0) / 1000, ...stop() });
  }

  // B: disk only, 8 writers at their offsets of a pre-sized file.
  {
    const path = PathUtils.join(DL.dir, "disk-only.bin");
    const stop = lagMeter();
    const t0 = Date.now();
    const size = 256 * 1048576;
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(path);
    const pre = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    pre.init(f, 0x02 | 0x08 | 0x20, 0o644, 0);
    pre.QueryInterface(Ci.nsISeekableStream).seek(0, size);
    pre.QueryInterface(Ci.nsISeekableStream).setEOF();
    pre.close();
    const chunk = new Uint8Array(1 << 20);
    const writers = Array.from({ length: 8 }, (_, i) => {
      const out = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      out.init(f, 0x02 | 0x08, 0o644, 0);
      out.QueryInterface(Ci.nsISeekableStream).seek(0, (i * size) / 8);
      const pipe = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);
      pipe.init(true, true, 256 * 1024, 0xffffffff);
      const done = new Promise((r) => NetUtil.asyncCopy(pipe.inputStream, out, r));
      const bin = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
      bin.setOutputStream(pipe.outputStream);
      return { pipe, done, bin };
    });
    for (let mb = 0; mb < 32; mb++) {
      for (const w of writers) w.bin.writeByteArray(chunk);
      while (writers.some((w) => w.pipe.inputStream.available() > 8 << 20)) await sleep(5);
    }
    for (const w of writers) w.pipe.outputStream.close();
    await Promise.all(writers.map((w) => w.done));
    log("B disk only", { secs: (Date.now() - t0) / 1000, ...stop() });
    await IOUtils.remove(path);
  }

  // C: the engine.
  {
    await DL.reset();
    const stop = lagMeter();
    const t0 = Date.now();
    const id = DL.engine.start(`${DL.base}/blob/big?rate=8192`, { filename: "engine.bin", named: true });
    const v = await DL.until(id, ["completed", "failed"], { timeout: 120000 });
    log("C engine", { state: v.state, secs: (Date.now() - t0) / 1000, ...stop() });
  }
});
