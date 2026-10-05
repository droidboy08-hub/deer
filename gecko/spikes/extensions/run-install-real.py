"""Run an install-flow boot script with add-on signature enforcement switched off.

Release Firefox hard-codes AddonSettings.REQUIRE_SIGNING = true unless Cu.isInAutomation, so an
unsigned local XPI can never get past verification in a normal run. Automation mode is what
Mozilla's own tests use: the pref below plus MOZ_DISABLE_NONLOCAL_CONNECTIONS=1 (Firefox then
aborts if it ever opens a non-local connection, so every request is pointed at a dead loopback
proxy and example.com is mapped to the local test server). This is a spike-only device for seeing
the real permission prompt and "was added" doorhanger; it is not how Vitre would ship.

  python spikes/extensions/run-install-real.py boot-install-amo.js extensions-amo-real [extra run.py args]
"""
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
boot = sys.argv[1] if len(sys.argv) > 1 else 'boot-install-amo.js'
name = sys.argv[2] if len(sys.argv) > 2 else 'extensions-amo-real'
prefs = {
    'security.turn_off_all_security_so_that_viruses_can_take_over_this_computer': 'true',
    'xpinstall.signatures.required': 'false',
    'extensions.webapi.testing': 'true',
    'extensions.webapi.testing.http': 'true',
    'network.dns.localDomains': 'example.com',
    'network.dns.disableIPv6': 'true',
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
    'ui.popup.disable_autohide': 'true',
}
cmd = [sys.executable, os.path.join(here, 'runx.py'), '--boot', os.path.join(here, boot), '--name', name,
       '--url', 'about:blank', '--timeout', '120']
for k, v in prefs.items():
    cmd += ['--pref', '%s=%s' % (k, v)]
cmd += sys.argv[3:]  # e.g. --keep-profile
env = dict(os.environ, MOZ_DISABLE_NONLOCAL_CONNECTIONS='1')
sys.exit(subprocess.call(cmd, env=env))
