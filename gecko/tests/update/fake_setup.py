"""A stand-in for Deer-Setup.exe in the updater's apply test (tests/update/apply.js, started through
vitre.update.testCommand by VitreUpdater instead of the real setup).

  pythonw fake_setup.py <result.json> <setup path> /update /installdir:<dir> /wait:<s> /launch /log:<file>

Writes what it was given to <result.json> at once, then waits (up to 90 s) for the process that started
it (Deer's engine) to exit and writes the file again with "parentExited": true. The test so sees the
exact arguments, that the setup was started while Deer was still quitting, and that it outlived Deer.
It never installs, writes or starts anything else.
"""
import ctypes
import json
import os
import sys
import time

SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0 = 0


def write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def main():
    out = sys.argv[1]
    parent = os.getppid()
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(SYNCHRONIZE, False, parent)
    data = {'argv': sys.argv[2:], 'pid': os.getpid(), 'parent': parent, 'parentAliveAtStart': bool(handle), 'startedAt': time.time(), 'parentExited': False}
    write(out, data)
    if handle:
        if kernel32.WaitForSingleObject(handle, 90000) == WAIT_OBJECT_0:
            data['parentExited'] = True
            data['parentExitedAt'] = time.time()
        kernel32.CloseHandle(handle)
    data['endedAt'] = time.time()
    write(out, data)


if __name__ == '__main__':
    main()
