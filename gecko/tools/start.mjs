// The second half of npm start (after node tools/build.mjs): runs this platform's development
// launcher with the arguments npm passes on (npm start -- https://example.com) and exits with its
// exit code:
//   Windows: launcher\Deer.cmd (runs launcher\Deer.exe, building it first when it is missing)
//   macOS:   launcher/deer
// Both return as soon as the engine is started. Exit codes are launcher/Launcher.cs's: 0 started,
// 1 bad -osint shape, 2 engine or package missing, 3 any other failure.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

// One argument on a cmd.exe line that starts a batch file: quoted the way CommandLineToArgvW reads
// it back (Launcher.cs's Quote), then cmd.exe's special characters escaped with ^ twice, since
// cmd.exe reads them once on this line and again where Deer.cmd passes %* on (npm's script runner,
// @npmcli/promise-spawn, does the same for a .cmd file).
function cmdArg(arg) {
  let quoted = arg;
  if (arg.length === 0 || /[ \t\n\v"]/.test(arg)) {
    quoted = '"';
    let backslashes = 0;
    for (const c of arg) {
      if (c === '\\') {
        backslashes++;
        continue;
      }
      quoted += c === '"' ? '\\'.repeat(backslashes * 2 + 1) + c : '\\'.repeat(backslashes) + c;
      backslashes = 0;
    }
    quoted += '\\'.repeat(backslashes * 2) + '"';
  }
  return quoted.replace(/[ !%^&()<>|"]/g, '^^^$&');
}

let r;
if (process.platform === 'win32') {
  // A .cmd file runs only through cmd.exe (Node refuses to spawn one directly). /s /c "<line>" runs
  // the line as it is between the outer quotes; the repository path may hold spaces.
  const line = [`"${join(ROOT, 'launcher', 'Deer.cmd')}"`, ...args.map(cmdArg)].join(' ');
  r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { stdio: 'inherit', windowsVerbatimArguments: true });
} else if (process.platform === 'darwin') {
  // Through /bin/sh, so a copy that lost its executable bit still runs.
  r = spawnSync('/bin/sh', [join(ROOT, 'launcher', 'deer'), ...args], { stdio: 'inherit' });
} else {
  console.error(`start: no development launcher for ${process.platform} (Windows and macOS only)`);
  process.exit(2);
}
if (r.error) {
  console.error(`start: ${r.error.message}`);
  process.exit(3);
}
// Killed by a signal (Ctrl+C with DEER_FOREGROUND=1): end the same way, so the caller sees it.
if (r.signal) process.kill(process.pid, r.signal);
process.exit(r.status ?? 3);
