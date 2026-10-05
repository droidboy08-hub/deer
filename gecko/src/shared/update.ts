// What Settings › About says about updates, from the updater's state (src/modules/VitreUpdater.sys.ts).
// Pure: no Gecko globals. Status lines follow the Settings rows' style: one line, no full stop (the
// updater's one-sentence errors lose theirs here), a second fact after " · ". The row's button says
// what to do ("Restart to update"), so the line does not repeat it.
import type { UpdateState } from '../modules/VitreUpdater.sys';

const MB = 1024 * 1024;

function mb(bytes: number): string {
  const n = bytes / MB;
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

/** "today at 14:05", "yesterday at 09:12", "on 3 October" (with the year when it is another one). */
export function when(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== n.getFullYear()) opts.year = 'numeric';
  return `on ${d.toLocaleDateString(undefined, opts)}`;
}

/** The Updates row's status line. */
export function updateStatus(s: UpdateState, now = Date.now()): string {
  switch (s.phase) {
    case 'off':
      return s.offReason || 'Updates are off in development builds';
    case 'checking':
      return 'Checking for updates…';
    case 'current':
      return `Deer is up to date · Checked ${when(s.lastCheck, now)}`;
    case 'downloading':
      return s.total > 0 ? `Downloading Deer ${s.available}… ${mb(s.received)} of ${mb(s.total)} MB` : `Downloading Deer ${s.available}…`;
    case 'verifying':
      return `Checking the download of Deer ${s.available}…`;
    case 'ready': {
      const text = s.lastAttempt ? `Deer ${s.available} didn’t install because ${s.lastAttempt}` : `Deer ${s.available} is ready to install`;
      // Installed for all users: said once (not again when the permission is what failed).
      return s.machine && !/administrator/.test(s.lastAttempt) ? `${text} · Windows asks for administrator permission` : text;
    }
    case 'restarting':
      return 'Restarting to update…';
    case 'failed':
      return s.error.replace(/\.$/, '');
    default:
      if (s.lastCheck) return `Last checked ${when(s.lastCheck, now)}`;
      return s.auto ? 'Deer checks for updates once a day' : 'Automatic checks are off';
  }
}
