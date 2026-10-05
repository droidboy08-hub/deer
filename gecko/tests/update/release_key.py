"""tools/release-key.mjs end to end (run from gecko/; tests/update/all.py runs it as "key"):

  python tests/update/release_key.py [--app build-x] [--name P]

Makes a key pair in %TEMP%\\deer-release-key-test (DEER_UPDATE_KEY_FILE puts the public half there: the
repository's gecko/update-key.txt is never written), refuses a private key inside the repository and a
second key over an existing one, signs a SHA256SUMS.txt, verifies it, refuses it once changed, refuses
signing with a key that is not the public half's, and has Gecko's WebCrypto (release_key.js, through
tools/run.py) accept Node's signature as an installed Deer would. Exit code 1 if any check fails.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.abspath(os.path.join(HERE, '..', '..'))
TOOL = os.path.join(GECKO, 'tools', 'release-key.mjs')
failed = 0


def check(name, ok, detail=''):
    global failed
    failed += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail) if detail and not ok else ''), flush=True)


def tool(*args, env=None):
    r = subprocess.run(['node', TOOL, *args], capture_output=True, text=True, env=env)
    return r.returncode, (r.stdout + r.stderr).strip()


def main():
    global failed
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', default='build-updater')
    ap.add_argument('--name', default='update-key')
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    a = ap.parse_args()
    work = os.path.join(tempfile.gettempdir(), 'deer-release-key-test-' + a.name)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    repo_key = os.path.join(GECKO, 'update-key.txt')
    had_key = os.path.exists(repo_key)
    try:
        env = dict(os.environ, DEER_UPDATE_KEY_FILE=os.path.join(work, 'update-key.txt'))
        inside = os.path.join(GECKO, 'release-key-test-secret.pem')
        code, out = tool('new', inside, env=env)
        check('new: a private key inside the repository is refused, nothing written', code == 1 and 'must not be inside the repository' in out and
              not os.path.exists(inside) and not os.path.exists(env['DEER_UPDATE_KEY_FILE']), out)
        priv = os.path.join(work, 'deer-release-key.pem')
        code, out = tool('new', priv, env=env)
        pub = open(env['DEER_UPDATE_KEY_FILE']).read().strip() if os.path.exists(env['DEER_UPDATE_KEY_FILE']) else ''
        check('new: the private key where asked, the public half (32 bytes, base64) in update-key.txt', code == 0 and os.path.exists(priv) and len(pub) == 44, out)
        code, out = tool('new', os.path.join(work, 'second.pem'), env=env)
        check('new again: refused while a public key exists (installed copies would refuse the old key\'s releases)',
              code == 1 and 'exists already' in out and not os.path.exists(os.path.join(work, 'second.pem')), out)
        sums = os.path.join(work, 'SHA256SUMS.txt')
        open(sums, 'w', newline='\n').write('%s  Deer-Setup.exe\n' % ('ab' * 32))
        code, out = tool('sign', sums, priv, env=env)
        check('sign: SHA256SUMS.txt.sig written', code == 0 and os.path.exists(sums + '.sig'), out)
        code, out = tool('verify', sums, env=env)
        check('verify: signed with the key', code == 0, out)
        text = open(sums, newline='').read()
        open(sums, 'a', newline='\n').write('%s  Other.exe\n' % ('cd' * 32))
        code, out = tool('verify', sums, env=env)
        check('verify: a changed SHA256SUMS.txt is not', code == 1, out)
        open(sums, 'w', newline='').write(text)
        other_env = dict(os.environ, DEER_UPDATE_KEY_FILE=os.path.join(work, 'other-key.txt'))
        other = os.path.join(work, 'other.pem')
        tool('new', other, env=other_env)
        code, out = tool('sign', sums, other, env=env)
        check('sign with a private key that is not the public half\'s: refused', code == 1 and 'is not the private half' in out, out)
        data = json.dumps({'pub': pub, 'sig': open(sums + '.sig').read().strip(), 'msg': text})
        r = subprocess.run([sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--app', a.app, '--test', os.path.join(HERE, 'release_key.js'),
                            '--name', a.name, '--timeout', '60', '--out', a.out, '--env', 'KEYTOOL_DATA=' + data],
                           capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=GECKO)
        lines = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith(('PASS', 'FAIL', 'ERROR'))]
        for line in lines:
            print(line)
        failed += sum(1 for l in lines if l.startswith(('FAIL', 'ERROR'))) + (0 if r.returncode == 0 and lines else 1)
        check('the repository\'s update-key.txt was not touched', os.path.exists(repo_key) == had_key)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print('RESULT', 'ok' if not failed else '%d failed' % failed)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
