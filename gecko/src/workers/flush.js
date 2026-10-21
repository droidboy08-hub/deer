// File operations for a download's .part, off the main thread. js-ctypes on the main thread would hold it
// for as long as the disk takes (hundreds of ms on a hard disk or a USB stick). A ChromeWorker made from a
// blob: address may not load, so this file is copied into the package (tools/build.mjs: src/workers).
//
//   flush   FlushFileBuffers (spikes/downloader/RESUME-DESIGN.md 4.1 seals; Phase 5 spike (a)): IOUtils.write
//           with flush does not reach the dirty pages another handle left (0-2 ms over 256 MiB, where
//           FlushFileBuffers took 65 ms).
//   sparse  FSCTL_SET_SPARSE. A .part sized to the whole file is written at many places at once; NTFS
//           writes zeros from the file's valid data length up to any write beyond it, inside that write,
//           so the connections far into a big file waited minutes (3.4 s at 35 GB on an NVMe drive; about
//           7 minutes for 70 GB on a hard disk). A sparse file has no such fill: 0 s, also for a .part that
//           was sized before it was marked. Volumes without sparse files (FAT, exFAT) answer an error and
//           the download goes on as before.
//
//   unsparse  FSCTL_SET_SPARSE with SetSparse FALSE on the finished file: Windows refuses to mount a sparse ISO,
//           VHD or VHDX (every range is written by then, so it is an ordinary file again).
//   held    GetCompressedFileSizeW: the bytes of disk the file holds (a sparse .part: what was written and what
//           lies past its farthest write), so the room a download still needs is known (ranged.ts openPart()).
//
// Message in: {id, path, op} (op 'flush' when absent). Message out: {id, ok: 1|0, ms, err} ('held' adds size).
// The file is opened for writing with every share mode (the transfer's own writers may hold it); nothing is
// written. 'held' opens nothing.
/* global ctypes, onmessage: writable, postMessage */
let api = null;

function load() {
  if (api) return api;
  const k32 = ctypes.open('kernel32.dll');
  const HANDLE = ctypes.voidptr_t;
  api = {
    CreateFileW: k32.declare('CreateFileW', ctypes.winapi_abi, HANDLE, ctypes.char16_t.ptr, ctypes.uint32_t, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uint32_t, ctypes.voidptr_t),
    FlushFileBuffers: k32.declare('FlushFileBuffers', ctypes.winapi_abi, ctypes.int32_t, HANDLE),
    DeviceIoControl: k32.declare('DeviceIoControl', ctypes.winapi_abi, ctypes.int32_t, HANDLE, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uint32_t.ptr, ctypes.voidptr_t),
    CloseHandle: k32.declare('CloseHandle', ctypes.winapi_abi, ctypes.int32_t, HANDLE),
    GetLastError: k32.declare('GetLastError', ctypes.winapi_abi, ctypes.uint32_t),
    GetCompressedFileSizeW: k32.declare('GetCompressedFileSizeW', ctypes.winapi_abi, ctypes.uint32_t, ctypes.char16_t.ptr, ctypes.uint32_t.ptr),
  };
  return api;
}

const FSCTL_SET_SPARSE = 0x000900c4;

onmessage = (e) => {
  const { id, path, op } = e.data || {};
  const t = Date.now();
  try {
    const k = load();
    if (op === 'held') {
      const high = new ctypes.uint32_t(0);
      const low = k.GetCompressedFileSizeW(String(path), high.address());
      // INVALID_FILE_SIZE is also the low half of a real size: only an error code says it failed.
      const err = low === 0xffffffff ? ctypes.winLastError : 0;
      if (err) postMessage({ id, ok: 0, err, ms: Date.now() - t });
      else postMessage({ id, ok: 1, err: 0, size: high.value * 4294967296 + low, ms: Date.now() - t });
      return;
    }
    // GENERIC_READ | GENERIC_WRITE for sparse (DeviceIoControl needs both), GENERIC_WRITE for flush;
    // FILE_SHARE_READ | WRITE | DELETE; OPEN_EXISTING; FILE_ATTRIBUTE_NORMAL.
    const access = op === 'sparse' || op === 'unsparse' ? 0xc0000000 : 0x40000000;
    const h = k.CreateFileW(String(path), access, 0x7, null, 3, 0x80, null);
    if (ctypes.cast(h, ctypes.intptr_t).value == -1) {
      postMessage({ id, ok: 0, err: k.GetLastError(), ms: Date.now() - t });
      return;
    }
    let ok = 0;
    let err = 0;
    if (op === 'sparse') {
      const returned = new ctypes.uint32_t(0);
      ok = k.DeviceIoControl(h, FSCTL_SET_SPARSE, null, 0, null, 0, returned.address(), null);
    } else if (op === 'unsparse') {
      // FILE_SET_SPARSE_BUFFER { BOOLEAN SetSparse = FALSE }.
      const returned = new ctypes.uint32_t(0);
      const clear = new ctypes.uint8_t(0);
      ok = k.DeviceIoControl(h, FSCTL_SET_SPARSE, clear.address(), 1, null, 0, returned.address(), null);
    } else {
      ok = k.FlushFileBuffers(h);
    }
    if (!ok) err = k.GetLastError();
    k.CloseHandle(h);
    postMessage({ id, ok: ok ? 1 : 0, err, ms: Date.now() - t });
  } catch (err) {
    postMessage({ id, ok: 0, err: String(err), ms: Date.now() - t });
  }
};
