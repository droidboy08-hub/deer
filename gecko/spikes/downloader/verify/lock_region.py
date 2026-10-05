"""Hold a byte-range lock on a file for a while, so another process's WriteFile into that range
fails (ERROR_LOCK_VIOLATION). Used to provoke a real disk-write error in the download engine.

  python lock_region.py <path> <seconds>
"""
import msvcrt
import os
import sys
import time


def main():
    path, secs = sys.argv[1], float(sys.argv[2])
    size = os.path.getsize(path)
    fd = os.open(path, os.O_RDWR | os.O_BINARY)
    locked = 0
    chunk = 1 << 30
    pos = 0
    while pos < size:
        n = min(chunk, size - pos)
        os.lseek(fd, pos, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, n)
        locked += n
        pos += n
    print('locked %d bytes of %s' % (locked, os.path.basename(path)), flush=True)
    time.sleep(secs)
    pos = 0
    while pos < size:
        n = min(chunk, size - pos)
        os.lseek(fd, pos, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, n)
        pos += n
    os.close(fd)
    print('unlocked', flush=True)


if __name__ == '__main__':
    main()
