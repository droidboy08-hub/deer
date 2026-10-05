"""Verifier: can the engine executable be rebranded WITHOUT a source build?  (spike claim 23: not possible)

  python spikes/packaging/verify/vtest-exe.py

Works only on copies inside the verifier's own runtime copy (verify/dist/Vitre/runtime):
  K1  vitre-engine.exe      = byte-identical copy of firefox.exe under another name.
                              Does Gecko start from a renamed exe, and what are the child processes called?
  K2  vitre-engine-res.exe  = the same copy with its Win32 resources edited through the documented
                              UpdateResource API: main icon group replaced by vitre.ico, and the
                              version-info strings "Firefox" -> "Vitre" (FileDescription / ProductName /
                              InternalName: what Task Manager, Alt-Tab fallbacks and "Open with" show).
                              This invalidates the Authenticode signature. Does it still run?
Both are started with -no-remote -profile <throwaway>, a boot script, and screenshots are captured.
"""
import ctypes
import ctypes.wintypes as wt
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.abspath(os.path.join(HERE, '..'))
ROOT = os.path.abspath(os.path.join(SPIKE, '..', '..'))
RUNTIME = os.path.join(HERE, 'dist', 'Vitre', 'runtime')
spec = importlib.util.spec_from_file_location('vitre_run', os.path.join(ROOT, 'tools', 'run.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
spec2 = importlib.util.spec_from_file_location('run_dist', os.path.join(SPIKE, 'run-dist.py'))
rd = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(rd)

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
RT_ICON, RT_GROUP_ICON, RT_VERSION = 3, 14, 16
k32.LoadLibraryExW.restype = wt.HMODULE
k32.LoadLibraryExW.argtypes = [wt.LPCWSTR, wt.HANDLE, wt.DWORD]
k32.FreeLibrary.argtypes = [wt.HMODULE]
k32.FindResourceExW.restype = wt.HANDLE
k32.FindResourceExW.argtypes = [wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, wt.WORD]
k32.LoadResource.restype = wt.HANDLE
k32.LoadResource.argtypes = [wt.HMODULE, wt.HANDLE]
k32.LockResource.restype = ctypes.c_void_p
k32.LockResource.argtypes = [wt.HANDLE]
k32.SizeofResource.restype = wt.DWORD
k32.SizeofResource.argtypes = [wt.HMODULE, wt.HANDLE]
k32.BeginUpdateResourceW.restype = wt.HANDLE
k32.BeginUpdateResourceW.argtypes = [wt.LPCWSTR, wt.BOOL]
k32.UpdateResourceW.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wt.WORD, ctypes.c_void_p, wt.DWORD]
k32.UpdateResourceW.restype = wt.BOOL
k32.EndUpdateResourceW.argtypes = [wt.HANDLE, wt.BOOL]
k32.EndUpdateResourceW.restype = wt.BOOL
ENUMNAME = ctypes.WINFUNCTYPE(wt.BOOL, wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
ENUMLANG = ctypes.WINFUNCTYPE(wt.BOOL, wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, wt.WORD, ctypes.c_void_p)
k32.EnumResourceNamesW.argtypes = [wt.HMODULE, ctypes.c_void_p, ENUMNAME, ctypes.c_void_p]
k32.EnumResourceLanguagesW.argtypes = [wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ENUMLANG, ctypes.c_void_p]


def res_name(p):
    """Resource name pointer -> int id or str."""
    return p if p < 0x10000 else ctypes.wstring_at(p)


def list_resources(path, rtype):
    h = k32.LoadLibraryExW(path, None, 0x2 | 0x20)  # AS_DATAFILE | AS_IMAGE_RESOURCE
    if not h:
        raise OSError('LoadLibraryEx failed %d' % ctypes.get_last_error())
    out = []

    def on_name(hmod, typ, name, _):
        n = res_name(name)
        langs = []

        def on_lang(hmod2, typ2, name2, lang, _2):
            langs.append(lang)
            return True

        k32.EnumResourceLanguagesW(h, rtype, name, ENUMLANG(on_lang), None)
        for lang in langs:
            r = k32.FindResourceExW(h, rtype, name, lang)
            size = k32.SizeofResource(h, r)
            data = ctypes.string_at(k32.LockResource(k32.LoadResource(h, r)), size)
            out.append((n, lang, data))
        return True

    k32.EnumResourceNamesW(h, rtype, ENUMNAME(on_name), None)
    k32.FreeLibrary(h)
    return out


def name_arg(n):
    return ctypes.c_void_p(n) if isinstance(n, int) else ctypes.cast(ctypes.c_wchar_p(n), ctypes.c_void_p)


def edit_resources(path, ico_path):
    groups = list_resources(path, RT_GROUP_ICON)
    icons = list_resources(path, RT_ICON)
    version = list_resources(path, RT_VERSION)
    print('[K2] icon groups in firefox.exe:', [(n, lang, len(d)) for n, lang, d in groups][:12], '| RT_ICON count', len(icons))
    # Explorer / the shell show the FIRST icon group (lowest id, then alphabetical).
    ints = sorted([g for g in groups if isinstance(g[0], int)], key=lambda g: g[0])
    strs = sorted([g for g in groups if not isinstance(g[0], int)], key=lambda g: g[0])
    main = (strs + ints)[0] if strs else ints[0]  # string names sort before integer ids in the PE resource directory
    print('[K2] replacing icon group', main[0], 'lang', main[1])

    ico = open(ico_path, 'rb').read()
    count = struct.unpack('<H', ico[4:6])[0]
    used = {n for n, _, _ in icons if isinstance(n, int)}
    next_id = max(used | {9000}) + 1
    grp = struct.pack('<HHH', 0, 1, count)
    new_icons = []
    for i in range(count):
        w, h, colors, res, planes, bpp, size, off = struct.unpack('<BBBBHHII', ico[6 + 16 * i:22 + 16 * i])
        grp += struct.pack('<BBBBHHIH', w, h, colors, res, planes, bpp, size, next_id)
        new_icons.append((next_id, ico[off:off + size]))
        next_id += 1

    vname, vlang, vdata = version[0]
    old = 'Firefox\0'.encode('utf-16le')
    new = 'Vitre\0\0\0'.encode('utf-16le')
    assert len(old) == len(new)
    n = vdata.count(old)
    vnew = vdata.replace(old, new)
    print('[K2] version-info: replaced %d standalone "Firefox" value(s) in place (same length, NUL padded)' % n)

    hupd = k32.BeginUpdateResourceW(path, False)
    if not hupd:
        raise OSError('BeginUpdateResource failed %d' % ctypes.get_last_error())
    ok = True
    for rid, data in new_icons:
        ok &= bool(k32.UpdateResourceW(hupd, RT_ICON, rid, main[1], data, len(data)))
    ok &= bool(k32.UpdateResourceW(hupd, RT_GROUP_ICON, name_arg(main[0]), main[1], grp, len(grp)))
    ok &= bool(k32.UpdateResourceW(hupd, RT_VERSION, name_arg(vname), vlang, vnew, len(vnew)))
    if not k32.EndUpdateResourceW(hupd, False) or not ok:
        raise OSError('UpdateResource failed %d' % ctypes.get_last_error())
    print('[K2] resources written')


def ps(cmd):
    return subprocess.run(['powershell', '-NoProfile', '-Command', cmd], capture_output=True, text=True).stdout.strip()


def procs_for(profile):
    raw = ps("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*%s*' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress" % os.path.basename(profile))
    rows = json.loads(raw) if raw else []
    if isinstance(rows, dict):
        rows = [rows]
    rows = [r for r in rows if r['Name'].lower() not in ('powershell.exe', 'python.exe', 'conhost.exe')]
    pids = {r['ProcessId'] for r in rows}
    allrows = json.loads(ps("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"))
    grew = True
    while grew:
        grew = False
        for r in allrows:
            if r['ParentProcessId'] in pids and r['ProcessId'] not in pids and r['Name'].lower() not in ('powershell.exe', 'conhost.exe'):
                pids.add(r['ProcessId'])
                rows.append({'ProcessId': r['ProcessId'], 'Name': r['Name'], 'CommandLine': ''})
                grew = True
    return rows


def run(label, exe_name):
    exe = os.path.join(RUNTIME, exe_name)
    out = os.path.join(HERE, 'out', 'exe-' + label)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    profile = os.path.join(tempfile.gettempdir(), 'vitre-gecko-packaging-verify-exe-' + label)
    shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile)
    prefs = dict(base.PREFS)
    prefs['browser.shell.customIcon.enabled'] = False
    prefs['browser.privacySegmentation.createdShortcut'] = True
    with open(os.path.join(profile, 'user.js'), 'w', encoding='utf-8') as f:
        for k, v in prefs.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    log = os.path.join(out, 'log.txt')
    open(log, 'w').close()
    env = dict(os.environ, VITRE_LOG=log, VITRE_OUT=out, VITRE_BOOT=os.path.join(HERE, 'vboot-exe.js'),
               VITRE_LIB=os.path.join(ROOT, 'tools', 'spike-lib.js'), MOZ_CRASHREPORTER_DISABLE='1', MOZ_DISABLE_AUTO_SAFE_MODE='1')
    env.pop('VITRE_APP', None)
    info = ps("$v=(Get-Item '%s').VersionInfo; $s=Get-AuthenticodeSignature '%s'; 'FileDescription=' + $v.FileDescription + ' | ProductName=' + $v.ProductName + ' | OriginalFilename=' + $v.OriginalFilename + ' | signature=' + $s.Status" % (exe, exe))
    print('[%s] %s: %s' % (label, exe_name, info))
    subprocess.Popen([exe, '-no-remote', '-profile', profile, 'https://example.com/'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    seen, done, start = 0, False, time.time()
    names = None
    try:
        while time.time() - start < 60 and not done:
            time.sleep(0.2)
            lines = open(log, encoding='utf-8', errors='replace').read().split('\n')[:-1]
            for line in lines[seen:]:
                if line.startswith('@@capture '):
                    n = line[10:].strip()
                    rows = procs_for(profile)
                    names = sorted({r['Name'] for r in rows})
                    hwnd = base.find_window({r['ProcessId'] for r in rows})
                    if hwnd:
                        ok, w, h = base.capture(hwnd, os.path.join(out, n + '.png'))
                        print('[%s] [capture] %s.png %dx%d %s' % (label, n, w, h, rd.identity(hwnd, out, n)))
                    else:
                        print('[%s] [capture] no window found' % label)
                    open(os.path.join(out, n + '.png.done'), 'w').close()
                elif line.startswith('@@quit'):
                    done = True
                elif not line.startswith('[config]'):
                    print('[%s] %s' % (label, line[:330]))
            seen = len(lines)
        if not done:
            print('[%s] DID NOT FINISH within 60 s (no window / no boot)' % label)
        print('[%s] process image names for this profile (parent + children): %s' % (label, names))
    finally:
        time.sleep(0.5)
        for r in procs_for(profile):
            subprocess.run(['taskkill', '/PID', str(r['ProcessId']), '/T', '/F'], capture_output=True)


def main():
    src = os.path.join(RUNTIME, 'firefox.exe')
    k1 = os.path.join(RUNTIME, 'vitre-engine.exe')
    k2 = os.path.join(RUNTIME, 'vitre-engine-res.exe')
    shutil.copyfile(src, k1)
    shutil.copyfile(src, k2)
    edit_resources(k2, os.path.join(SPIKE, 'dist-files', 'vitre.ico'))
    run('k1-renamed', 'vitre-engine.exe')
    run('k2-resedit', 'vitre-engine-res.exe')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
