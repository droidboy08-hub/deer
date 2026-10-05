// Writing a download's bytes at their place in a pre-sized .part file, without holding the file
// in memory and without disk I/O on the main (UI) thread. Replaces Node's fs.promises.FileHandle
// positional writes in ranged.ts.
//
// Each connection gets a Writer: its own nsIFileOutputStream on the file, seeked to the segment's
// offset, fed through an nsIPipe by an nsIAsyncStreamCopier running on Necko's stream transport
// thread pool. The main thread only moves a channel's bytes into the pipe (native
// nsIOutputStream.writeFrom: the bytes never enter the JS heap); WriteFile happens off-thread.
import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";

const PR_WRONLY = 0x02;
const PR_CREATE_FILE = 0x08;
const PR_TRUNCATE = 0x20;
/** Pipe segment size = the size of each WriteFile. The pipe default (4 kB) would mean 25,000 syscalls a second at 100 MB/s. */
const PIPE_SEGMENT = 256 * 1024;

export function fileFor(path) {
  const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

function openOut(path, flags) {
  const s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
  s.init(fileFor(path), flags, 0o644, 0);
  return s;
}

/** Size in bytes, or -1 when the file isn't there. */
export async function sizeOf(path) {
  try {
    return (await IOUtils.stat(path)).size;
  } catch {
    return -1;
  }
}

/** Create the file or change its length to exactly `size` (no data is written). */
export function setSize(path, size, { truncate = false } = {}) {
  const s = openOut(path, PR_WRONLY | PR_CREATE_FILE | (truncate ? PR_TRUNCATE : 0));
  try {
    const seek = s.QueryInterface(Ci.nsISeekableStream);
    seek.seek(Ci.nsISeekableStream.NS_SEEK_SET, size);
    seek.setEOF();
  } finally {
    s.close();
  }
}

/** Free bytes on the volume holding `dir`, or Infinity when it won't say. */
export function freeSpace(dir) {
  try {
    return fileFor(dir).diskSpaceAvailable;
  } catch {
    return Infinity;
  }
}

export class DiskError extends Error {
  constructor(result) {
    const code = ChromeUtils.getXPCOMErrorName(result);
    super(code);
    this.result = result;
    this.code = code;
  }
}

export class Writer {
  #out;
  #pipe;
  #bin = null;
  #done;
  #closed = false;
  /** Bytes handed to this writer. */
  written = 0;
  /** nsresult of a failed disk write, as soon as it is known. */
  failed = 0;

  /** `offset` < 0 appends. */
  constructor(path, offset) {
    this.#out = openOut(path, PR_WRONLY | PR_CREATE_FILE | (offset < 0 ? 0x10 /* PR_APPEND */ : 0));
    if (offset >= 0) this.#out.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, offset);
    this.#pipe = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);
    // Non-blocking both ends, unlimited: the transfer applies back-pressure itself (see `backlog`).
    this.#pipe.init(true, true, PIPE_SEGMENT, 0xffffffff);
    this.#done = new Promise((resolve) => {
      NetUtil.asyncCopy(this.#pipe.inputStream, this.#out, (status) => {
        if (!Components.isSuccessCode(status)) this.failed = status;
        resolve(status);
      });
    });
  }

  /** Hand `count` bytes of a channel's stream (inside onDataAvailable) to the background writer. */
  write(stream, count) {
    if (this.failed) throw new DiskError(this.failed);
    let left = count;
    while (left > 0) {
      const n = this.#pipe.outputStream.writeFrom(stream, left);
      if (n <= 0) throw new DiskError(Cr.NS_ERROR_FAILURE);
      left -= n;
    }
    this.written += count;
  }

  /** The same for bytes already in JS (a decrypted HLS segment). */
  writeBytes(u8) {
    if (this.failed) throw new DiskError(this.failed);
    if (!this.#bin) {
      this.#bin = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
      this.#bin.setOutputStream(this.#pipe.outputStream);
    }
    this.#bin.writeByteArray(u8);
    this.written += u8.length;
  }

  /** Bytes accepted but not yet written to the file. */
  get backlog() {
    try {
      return this.#pipe.inputStream.available();
    } catch {
      return 0;
    }
  }

  /** Resolves when every accepted byte has been written and the handle is closed; throws DiskError if a write failed. */
  async close() {
    if (!this.#closed) {
      this.#closed = true;
      this.#pipe.outputStream.close();
    }
    const status = await this.#done;
    if (!Components.isSuccessCode(status)) throw new DiskError(status);
  }
}
