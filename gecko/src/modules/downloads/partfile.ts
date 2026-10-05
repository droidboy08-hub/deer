// Writing a download's bytes at their place in a pre-sized .part file, without holding the file in
// memory and without disk I/O on the main thread. Port of
// spikes/downloader/verify/engine/VitrePartFile.sys.mjs (recipe: WRITE).
//
// Each connection gets a Writer: its own nsIFileOutputStream on the file, seeked to the segment's
// offset, fed through an nsIPipe by NetUtil.asyncCopy (Necko's stream-transport threads). The main
// thread only moves a channel's bytes into the pipe (nsIOutputStream.writeFrom: they never enter
// the JS heap).
//
// What was added to the prototype: `durable`, a lower bound of the bytes that certainly reached the
// file, so a disk error keeps the segment progress before it (recipe correction 6: the prototype
// threw all of it away).
import { NetUtil } from 'resource://gre/modules/NetUtil.sys.mjs';
import { DiskError } from './net';

const PR_WRONLY = 0x02;
const PR_CREATE_FILE = 0x08;
const PR_APPEND = 0x10;
const PR_TRUNCATE = 0x20;
/** Pipe segment size = the size of each WriteFile (the default 4 kB would mean 25,000 syscalls a second at 100 MB/s). */
const PIPE_SEGMENT = 256 * 1024;
/**
 * The copier takes a chunk out of the pipe and then writes it: a failed write loses at most that
 * chunk (NetUtil.asyncCopy: nsIAsyncStreamCopier2 with the default chunk size, at most one pipe
 * segment). Everything that left the pipe before the chunk in flight was written.
 */
const IN_FLIGHT = 2 * PIPE_SEGMENT;

export function fileFor(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

function openOut(path: string, flags: number): any {
  const s = Cc['@mozilla.org/network/file-output-stream;1'].createInstance(Ci.nsIFileOutputStream);
  try {
    s.init(fileFor(path), flags, 0o644, 0);
  } catch (e) {
    throw new DiskError((e as { result?: number }).result ?? Cr.NS_ERROR_FAILURE);
  }
  return s;
}

/** Size in bytes, or -1 when the file isn't there. */
export async function sizeOf(path: string): Promise<number> {
  try {
    return (await IOUtils.stat(path)).size;
  } catch {
    return -1;
  }
}

export function existsSync(path: string): boolean {
  try {
    return fileFor(path).exists();
  } catch {
    return false;
  }
}

/** Create the file or change its length to exactly `size` (no data is written). */
export function setSize(path: string, size: number, { truncate = false } = {}): void {
  const s = openOut(path, PR_WRONLY | PR_CREATE_FILE | (truncate ? PR_TRUNCATE : 0));
  try {
    const seek = s.QueryInterface(Ci.nsISeekableStream);
    seek.seek(Ci.nsISeekableStream.NS_SEEK_SET, size);
    seek.setEOF();
  } catch (e) {
    throw new DiskError((e as { result?: number }).result ?? Cr.NS_ERROR_FAILURE);
  } finally {
    s.close();
  }
}

/** Free bytes on the volume holding `dir`, or Infinity when it won't say. */
export function freeSpace(dir: string): number {
  try {
    return fileFor(dir).diskSpaceAvailable;
  } catch {
    return Infinity;
  }
}

export class Writer {
  private out: any;
  private pipe: any;
  private bin: any = null;
  private done: Promise<number>;
  private closed = false;
  /** Bytes handed to this writer. */
  written = 0;
  /** nsresult of a failed disk write, as soon as it is known. */
  failed = 0;
  /** Bytes that had left the pipe when last looked at. */
  private drained = 0;

  /** `offset` < 0 appends. Throws DiskError when the file can't be opened. */
  constructor(path: string, offset: number) {
    this.out = openOut(path, PR_WRONLY | PR_CREATE_FILE | (offset < 0 ? PR_APPEND : 0));
    try {
      if (offset >= 0) this.out.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, offset);
    } catch (e) {
      this.out.close();
      throw new DiskError((e as { result?: number }).result ?? Cr.NS_ERROR_FAILURE);
    }
    this.pipe = Cc['@mozilla.org/pipe;1'].createInstance(Ci.nsIPipe);
    // Non-blocking both ends, unlimited: the transfer applies back-pressure itself (see `backlog`).
    this.pipe.init(true, true, PIPE_SEGMENT, 0xffffffff);
    this.done = new Promise((resolve) => {
      NetUtil.asyncCopy(this.pipe.inputStream, this.out, (status: number) => {
        if (!Components.isSuccessCode(status)) this.failed = status;
        resolve(status);
      });
    });
  }

  /** Note how much has left the pipe. Not once the copy failed: the copier then closes the pipe. */
  private look(): void {
    if (this.failed) return;
    let waiting: number;
    try {
      waiting = this.pipe.inputStream.available();
    } catch {
      return;
    }
    this.drained = Math.max(this.drained, this.written - waiting);
  }

  /** Hand `count` bytes of a channel's stream (inside onDataAvailable) to the background writer. */
  write(stream: any, count: number): void {
    if (this.failed) throw new DiskError(this.failed);
    this.look();
    let left = count;
    while (left > 0) {
      let n = 0;
      try {
        n = this.pipe.outputStream.writeFrom(stream, left);
      } catch (e) {
        throw new DiskError((e as { result?: number }).result ?? Cr.NS_ERROR_FAILURE);
      }
      if (n <= 0) throw new DiskError(Cr.NS_ERROR_FAILURE);
      left -= n;
    }
    this.written += count;
  }

  /** The same for bytes already in JS (a decrypted stream segment). */
  writeBytes(u8: Uint8Array): void {
    if (this.failed) throw new DiskError(this.failed);
    this.look();
    if (!this.bin) {
      this.bin = Cc['@mozilla.org/binaryoutputstream;1'].createInstance(Ci.nsIBinaryOutputStream);
      this.bin.setOutputStream(this.pipe.outputStream);
    }
    try {
      this.bin.writeByteArray(u8);
    } catch (e) {
      throw new DiskError((e as { result?: number }).result ?? Cr.NS_ERROR_FAILURE);
    }
    this.written += u8.length;
  }

  /** Bytes accepted but not yet written to the file. */
  get backlog(): number {
    try {
      return this.pipe.inputStream.available();
    } catch {
      return 0;
    }
  }

  /** Bytes that are certainly in the file now (a lower bound). */
  get durable(): number {
    this.look();
    return Math.max(0, Math.min(this.written, this.drained - (this.failed ? IN_FLIGHT : 0)));
  }

  /** Resolves when every accepted byte has been written and the handle is closed; throws DiskError if a write failed. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.look();
      try {
        this.pipe.outputStream.close();
      } catch {
        /* already closed by a failed copy */
      }
    }
    const status = await this.done;
    if (!Components.isSuccessCode(status)) throw new DiskError(status);
    this.drained = this.written;
  }
}
