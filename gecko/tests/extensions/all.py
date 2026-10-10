"""Run the extensions test set: builds the module's two outputs, the test extensions, then every test.

  python tests/extensions/all.py [--only bar,settings] [--no-amo]

  build-extensions        the extensions module with the 'menus' and 'settings' modules it uses
  build-extensions-solo   the extensions module alone (fallback.js: no menus, no settings)
Captures and logs land in tests/extensions/out. Exit code 1 if any test failed.
--no-amo skips the read-only load of the real addons.mozilla.org listing in install.js.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

# The toolbar layout of the owner's profile on 2026-10-10 (copied from the old Vitre profile): the
# extensions button listed in the nav-bar. It stopped Firefox's add-on prompts (tests/extensions/layout.js).
STALE_LAYOUT = '{"placements":{"widget-overflow-fixed-list":[],"unified-extensions-area":["ublock0_raymondhill_net-browser-action"],"nav-bar":["back-button","forward-button","stop-reload-button","customizableui-special-spring1","vertical-spacer","urlbar-container","customizableui-special-spring2","downloads-button","fxa-toolbar-menu-button","reset-pbm-toolbar-button","unified-extensions-button"],"vitre-ext-bar":[],"toolbar-menubar":["menubar-items"],"TabsToolbar":["tabbrowser-tabs","new-tab-button","customizableui-special-spring3","alltabs-button","smartwindow-group-tabs-button","ai-window-toggle"],"vertical-tabs":[],"PersonalToolbar":["personal-bookmarks"]},"seen":["reset-pbm-toolbar-button","smartwindow-group-tabs-button","ai-window-toggle","developer-button","screenshot-button","ublock0_raymondhill_net-browser-action"],"dirtyAreaCache":["nav-bar","TabsToolbar","vertical-tabs","vitre-ext-bar","unified-extensions-area"],"currentVersion":26,"newElementCount":3}'

TESTS = [
    # (script, profile name, app, timeout, extra args)
    ('bar.js', 'extensions-bar', 'build-extensions', 260, []),
    ('install.js', 'extensions-install', 'build-extensions', 200, []),
    ('settings.js', 'extensions-settings', 'build-extensions', 240, []),
    ('persist.js', 'extensions-persist', 'build-extensions', 240, []),
    ('private.js', 'extensions-private', 'build-extensions', 240, []),
    ('update.js', 'extensions-update', 'build-extensions', 240, ['--pref', 'extensions.checkUpdateSecurity=false']),
    ('fallback.js', 'extensions-fallback', 'build-extensions-solo', 200, []),
    # The real addons.mozilla.org: uBlock Origin installed with a real click (needs the network;
    # downloads it into the test profile; skipped with --no-amo).
    ('amo.js', 'extensions-amo', 'build-extensions', 240, ['--env', 'AMO_AUTOHIDE=1', '--env', 'AMO_REALMOUSE=1']),
    # A profile copied from an old one, its toolbar layout listing the extensions button (layout.js).
    ('layout.js', 'extensions-layout', 'build-extensions', 120, ['--pref', 'browser.uiCustomization.state=' + STALE_LAYOUT]),
]


def main():
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    env = dict(os.environ)
    if '--no-amo' in sys.argv:
        env['VITRE_AMO'] = '0'
    node = 'node'
    subprocess.run([node, 'tools/build.mjs', '--out=build-extensions', '--modules=extensions,menus,settings'], cwd=ROOT, check=True, shell=os.name == 'nt')
    subprocess.run([node, 'tools/build.mjs', '--out=build-extensions-solo', '--modules=extensions'], cwd=ROOT, check=True, shell=os.name == 'nt')
    subprocess.run([sys.executable, os.path.join(HERE, 'make-extensions.py')], check=True)
    failed = []
    for script, name, app, timeout, extra in TESTS:
        if only and script.replace('.js', '') not in only:
            continue
        if script == 'amo.js' and env.get('VITRE_AMO') == '0':
            continue
        print('==== %s' % script, flush=True)
        args = [sys.executable, os.path.join(HERE, 'runx.py'), '--test', os.path.join(HERE, script), '--name', name,
                '--app', app, '--timeout', str(timeout)] + extra
        if '--env' not in extra and env.get('VITRE_AMO') == '0':
            args += ['--env', 'VITRE_AMO=0']
        code = subprocess.run(args, cwd=ROOT, env=env).returncode
        if code:
            failed.append(script)
    print('==== failed: %s' % (', '.join(failed) if failed else 'none'))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
