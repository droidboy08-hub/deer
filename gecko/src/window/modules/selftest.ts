// Sample feature module: the smallest thing that proves auto-discovery, and the pattern to copy.
// It is inert in normal use. With VITRE_SELFTEST=1 in the environment (tests/core sets it) it
// exercises the module API the way a real module would and leaves the results on window.vitreSelftest.
import type { Browser } from '../browser';

export function install(b: Browser): void {
  const record = { installed: true, tabsAtInstall: b.tabs.length, events: [] as string[], ran: 0, layer: false };
  (window as any).vitreSelftest = record;
  if (Services.env.get('VITRE_SELFTEST') !== '1') return;

  b.on('tab-created', (t) => record.events.push(`created:${t.id}`));
  b.on('tab-activated', (t) => record.events.push(`activated:${t.id}`));
  b.on('tab-closed', (t) => record.events.push(`closed:${t.id}`));
  b.on('ready', () => record.events.push('ready'));
  // Registered at 'ready', after every feature module installed: modules install in name order and
  // the settings module (after this one) owns shortcutsHelp, so an install-time registration here
  // would be overridden in a full build (self-test runs only).
  b.on('ready', () => {
    b.registerAction('shortcutsHelp', () => {
      record.ran++;
    });
  });
  b.css('selftest', '#layer-selftest > .selftest-mark { position: absolute; left: 16px; bottom: 16px; width: 8px; height: 8px; border-radius: 4px; background: #4cc2ff; }');
  const mark = document.createElement('div');
  mark.className = 'selftest-mark';
  b.layer('selftest', 30).append(mark);
  record.layer = true;
}
