"""Verifier's runner. Runs a boot script (the original spike's or one of the verifier's) under an
"extensions-verify-*" profile name, with captures and log going to verify/out/<key>/.

  python spikes/extensions/verify/rerun.py <key> <boot.js> [release|unsigned] [--keep-profile] [--append] [--timeout N] [--pref k=v ...] [--url U]

<boot.js> is resolved against spikes/extensions/ first (the original scripts, run in place, read
only), then against spikes/extensions/verify/.
The local test server (verify/serve.py, 127.0.0.1:47631) must already be running.
"""
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
orig = os.path.dirname(here)

UNSIGNED = {
    'security.turn_off_all_security_so_that_viruses_can_take_over_this_computer': 'true',
    'xpinstall.signatures.required': 'false',
    'extensions.webapi.testing': 'true',
    'extensions.webapi.testing.http': 'true',
    'network.dns.localDomains': 'example.com',
    'network.proxy.type': '1',
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': '9',
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': '9',
    'network.proxy.no_proxies_on': 'example.com',
    'network.trr.mode': '5',
    'network.proxy.failover_direct': 'false',
    'network.proxy.allow_bypass': 'false',
    'extensions.blocklist.enabled': 'false',
    'extensions.abuseReport.enabled': 'false',
    'network.prefetch-next': 'false',
    'network.dns.disablePrefetch': 'true',
    'network.http.speculative-parallel-limit': '0',
    'extensions.getAddons.cache.enabled': 'false',
    'extensions.update.enabled': 'false',
    'extensions.systemAddon.update.enabled': 'false',
    'browser.safebrowsing.malware.enabled': 'false',
    'browser.safebrowsing.phishing.enabled': 'false',
    'browser.safebrowsing.downloads.remote.enabled': 'false',
    'network.captive-portal-service.enabled': 'false',
    'network.connectivity-service.enabled': 'false',
    'dom.push.connection.enabled': 'false',
}


def main():
    args = sys.argv[1:]
    key, boot = args[0], args[1]
    rest = args[2:]
    mode = 'release'
    if rest and rest[0] in ('release', 'unsigned'):
        mode = rest.pop(0)
    timeout = '150'
    extra = []
    url = 'about:blank'
    autohide = True
    append = False
    i = 0
    while i < len(rest):
        if rest[i] == '--timeout':
            timeout = rest[i + 1]
            i += 2
        elif rest[i] == '--url':
            url = rest[i + 1]
            i += 2
        elif rest[i] == '--no-autohide-pref':
            autohide = False
            i += 1
        elif rest[i] == '--append':
            append = True
            i += 1
        else:
            extra.append(rest[i])
            i += 1
    path = os.path.join(orig, boot)
    if not os.path.exists(path):
        path = os.path.join(here, boot)
    out = os.path.join(here, 'out', key)
    os.makedirs(out, exist_ok=True)
    cmd = [sys.executable, os.path.join(here, 'runx.py'), '--boot', path, '--name', 'extensions-verify-' + key,
           '--url', url, '--timeout', timeout, '--out', out, '--pref', 'network.dns.disableIPv6=true']
    if autohide:
        cmd += ['--pref', 'ui.popup.disable_autohide=true']
    env = dict(os.environ)
    if mode == 'unsigned':
        for k, v in UNSIGNED.items():
            cmd += ['--pref', '%s=%s' % (k, v)]
        env['MOZ_DISABLE_NONLOCAL_CONNECTIONS'] = '1'
    cmd += extra
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    text = res.stdout + res.stderr
    mode_ = 'a' if append else 'w'
    with open(os.path.join(out, 'run.log'), mode_, encoding='utf-8') as f:
        f.write(text)
    print(text)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
