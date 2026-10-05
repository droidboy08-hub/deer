"""What installer/build.py --check-engine accepts and refuses (run from gecko/):

  python installer/tests/engine_check.py [--engine engines/deer-runtime]

Works on a copy of a release engine made by tools/setup-engine.py (default engines/deer-runtime; the
unbranded build its deer-engine.json names must be there too) in %TEMP%\\deer-engine-check, never on the
engine itself. The copy leaves out the chrome package link (build.py never ships it). Each case changes
the copy, runs build.py --engine <copy> --check-engine and puts the copy back:
  accepted  the copy as it is
  refused   an engine file missing (nss3.dll; the fonts folder; everything but the 16 files the earlier
            checks looked at), one more (a DLL dropped in), one changed (a DLL with other bytes of the same
            size; xul.dll cut short), a record without its file list, Mozilla's updater put back, an
            empty identity, a launch contract that asks for more than the launcher does
Exit code 1 if any case is not as expected.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

GECKO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WORK = os.path.join(tempfile.gettempdir(), 'deer-engine-check')
failed = 0


def rmtree(path):
    if os.path.lexists(path):
        shutil.rmtree(path, onexc=lambda f, p, e: (os.chmod(p, 0o666), f(p)))


def build_check(engine):
    r = subprocess.run([sys.executable, os.path.join(GECKO, 'installer', 'build.py'), '--engine', engine, '--check-engine'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=GECKO)
    return r.returncode, (r.stdout + r.stderr).strip()


def case(label, expect_ok, change, undo, want_text=None):
    global failed
    change()
    try:
        code, text = build_check(WORK)
    finally:
        undo()
    good = (code == 0) == expect_ok and (want_text is None or want_text in text)
    failed += 0 if good else 1
    last = [l for l in text.splitlines() if l.strip()]
    detail = next((l.strip() for l in last if 'engine file' in l), None) or next((l for l in last if 'ERROR' in l), last[-1] if last else '')
    print('%s %s: %s  %s' % ('PASS' if good else 'FAIL', label, 'accepted' if code == 0 else 'refused', detail[:300]), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default=os.path.join(GECKO, 'engines', 'deer-runtime'))
    a = ap.parse_args()
    src = os.path.abspath(a.engine)
    if not os.path.exists(os.path.join(src, 'deer-engine.json')):
        sys.exit('%s is not a Deer engine (no deer-engine.json): python tools/setup-engine.py first' % src)
    rmtree(WORK)
    print('copying %s -> %s' % (src, WORK), flush=True)
    shutil.copytree(src, WORK, ignore=lambda folder, names: [n for n in names if os.path.isjunction(os.path.join(folder, n)) or
                                                             (os.path.normcase(folder) == os.path.normcase(src) and n == 'vitre')])
    meta_path = os.path.join(WORK, 'deer-engine.json')
    meta_text = open(meta_path, encoding='utf-8').read()

    def put_back(*rels):
        def undo():
            for rel in rels:
                d = os.path.join(WORK, rel)
                if os.path.isdir(os.path.join(src, rel)):
                    rmtree(d)
                    shutil.copytree(os.path.join(src, rel), d)
                elif os.path.exists(os.path.join(src, rel)):
                    os.makedirs(os.path.dirname(d), exist_ok=True)
                    shutil.copyfile(os.path.join(src, rel), d)
                elif os.path.lexists(d):
                    os.remove(d)
        return undo

    def remove(*rels):
        def change():
            for rel in rels:
                p = os.path.join(WORK, rel)
                rmtree(p) if os.path.isdir(p) else os.remove(p)
        return change

    def edit_meta(fn):
        def change():
            m = json.loads(meta_text)
            fn(m)
            open(meta_path, 'w', encoding='utf-8').write(json.dumps(m, indent=2))
        return change

    def meta_back():
        open(meta_path, 'w', encoding='utf-8').write(meta_text)

    try:
        case('the engine as setup-engine.py made it', True, lambda: None, lambda: None)
        case('nss3.dll missing (an interrupted copy, a quarantined DLL)', False, remove('nss3.dll'), put_back('nss3.dll'), 'missing: nss3.dll')
        case('the fonts folder missing', False, remove('fonts'), put_back('fonts'), 'missing')
        kept = {'deer-engine.json', 'application.ini', 'platform.ini', 'omni.ja', 'deer.exe', 'xul.dll', 'mozglue.dll', 'firefox.exe', 'config.js',
                os.path.join('browser', 'omni.ja'), os.path.join('browser', 'application.ini'), os.path.join('defaults', 'pref', 'config-prefs.js'),
                os.path.join('defaults', 'pref', 'vitre-prefs.js'), os.path.join('distribution', 'policies.json'),
                os.path.join('browser', 'chrome', 'icons', 'default', 'vitre.ico'), os.path.join('browser', 'chrome', 'icons', 'default', 'deer-orange.ico')}
        others = sorted({os.path.relpath(os.path.join(f, n), WORK) for f, _d, ns in os.walk(WORK) for n in ns} - {os.path.normpath(k) for k in kept})
        case('only the 16 files the earlier checks looked at (%d others gone)' % len(others), False, remove(*others), put_back(*others), 'missing')

        def drop_dll():
            open(os.path.join(WORK, 'version.dll'), 'wb').write(b'MZ' + b'\0' * 1022)
        case('a DLL dropped into the engine (version.dll)', False, drop_dll, put_back('version.dll'), 'not made by setup-engine.py: version.dll')

        def swap_dll():
            p = os.path.join(WORK, 'gkcodecs.dll')
            size = os.path.getsize(p)
            open(p, 'wb').write(b'\x90' * size)
        case('gkcodecs.dll with other bytes of the same size', False, swap_dll, put_back('gkcodecs.dll'), 'changed since setup-engine.py wrote it: gkcodecs.dll')

        def cut_xul():
            with open(os.path.join(WORK, 'xul.dll'), 'r+b') as f:
                f.truncate(1024 * 1024)
        case('xul.dll cut short', False, cut_xul, put_back('xul.dll'), 'xul.dll')
        case('deer-engine.json without its file list (an older setup-engine.py)', False, edit_meta(lambda m: m.pop('files', None)), meta_back,
             'lists no engine files')

        def updater():
            open(os.path.join(WORK, 'updater.exe'), 'wb').write(b'MZ')
        case('Mozilla\'s updater.exe put back', False, updater, put_back('updater.exe'), 'updater.exe')
        case('identity.app empty (--stock-identity)', False, edit_meta(lambda m: m['identity'].__setitem__('app', None)), meta_back, 'no Deer identity')
        case('identity.launch asks for a variable', False, edit_meta(lambda m: m['identity']['launch'].__setitem__('env', {'MOZ_X': '1'})), meta_back,
             'identity.launch asks for')
        case('identity.launch.clearEnv without MOZ_NEW_INSTANCE (not what setup-engine.py writes)', False,
             edit_meta(lambda m: m['identity']['launch'].__setitem__('clearEnv', ['XUL_APP_FILE', 'XRE_PROFILE_PATH', 'XRE_PROFILE_LOCAL_PATH'])), meta_back,
             'clearEnv')
        case('put back as it was: accepted again', True, lambda: None, lambda: None)
    finally:
        rmtree(WORK)
    print('RESULT %s' % ('ok' if not failed else '%d failed' % failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
