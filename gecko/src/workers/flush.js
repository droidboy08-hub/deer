// FlushFileBuffers for a download's .part, off the main thread (spikes/downloader/RESUME-DESIGN.md 4.1
// seals; Phase 5 spike (a)): IOUtils.write with flush does not reach the dirty pages another handle left
// (0-2 ms over 256 MiB, where FlushFileBuffers took 65 ms), and js-ctypes on the main thread would hold it
// for as long as the disk takes (hundreds of ms on a hard disk or a USB stick). A ChromeWorker made from a
// blob: address may not load, so this file is copied into the package (tools/build.mjs: src/workers).
//
// Message in: {id, path}. Message out: {id, ok: 1|0, ms, err}. The file is opened for writing with every
// share mode (the transfer's own writers may still hold it), flushed, closed; nothing is written.
/* global ctypes, onmessage: writable, postMessage */
let api = null;

function load() {
  if (api) return api;
  const k32 = ctypes.open('kernel32.dll');
  const HANDLE = ctypes.voidptr_t;
  api = {
    CreateFileW: k32.declare('CreateFileW', ctypes.winapi_abi, HANDLE, ctypes.char16_t.ptr, ctypes.uint32_t, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uint32_t, ctypes.voidptr_t),
    FlushFileBuffers: k32.declare('FlushFileBuffers', ctypes.winapi_abi, ctypes.int32_t, HANDLE),
    CloseHandle: k32.declare('CloseHandle', ctypes.winapi_abi, ctypes.int32_t, HANDLE),
    GetLastError: k32.declare('GetLastError', ctypes.winapi_abi, ctypes.uint32_t),
  };
  return api;
}

onmessage = (e) => {
  const { id, path } = e.data || {};
  const t = Date.now();
  try {
    const k = load();
    // GENERIC_WRITE; FILE_SHARE_READ | WRITE | DELETE; OPEN_EXISTING; FILE_ATTRIBUTE_NORMAL.
    const h = k.CreateFileW(String(path), 0x40000000, 0x7, null, 3, 0x80, null);
    if (ctypes.cast(h, ctypes.intptr_t).value == -1) {
      postMessage({ id, ok: 0, err: k.GetLastError(), ms: Date.now() - t });
      return;
    }
    const ok = k.FlushFileBuffers(h);
    k.CloseHandle(h);
    postMessage({ id, ok: ok ? 1 : 0, ms: Date.now() - t });
  } catch (err) {
    postMessage({ id, ok: 0, err: String(err), ms: Date.now() - t });
  }
};
