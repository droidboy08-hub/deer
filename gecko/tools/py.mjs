// Runs Python 3 with the arguments given, for the npm scripts that run a Python script
// (npm run setup-runtime, npm test), so that one package.json works on Windows and macOS:
//   node tools/py.mjs tools/setup-runtime.py --check
//   node tools/py.mjs -c "import sys; print(sys.version)"
// Windows: python, as these scripts always ran it (the Python on PATH, or the active venv's); the py
// launcher (py -3) only when there is no python on PATH. py -3 is not tried first because it ignores
// an active venv and may pick another installed Python than python does.
// Elsewhere: python3 (macOS has no python command). The Mac's scripts keep to Python 3.9, the
// /usr/bin/python3 of the Command Line Tools.
// The arguments, the working directory (npm's: the gecko folder) and the exit code pass through.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const pythons = process.platform === 'win32' ? [['python'], ['py', '-3']] : [['python3']];
for (const [command, ...first] of pythons) {
  const r = spawnSync(command, [...first, ...args], { stdio: 'inherit' });
  if (r.error?.code === 'ENOENT') continue;
  if (r.error) {
    console.error(`py.mjs: ${command}: ${r.error.message}`);
    process.exit(1);
  }
  // Killed by a signal (Ctrl+C): end the same way, so the caller sees it.
  if (r.signal) process.kill(process.pid, r.signal);
  process.exit(r.status ?? 1);
}
console.error(`py.mjs: Python 3 not found (looked for ${pythons.map((p) => p.join(' ')).join(', ')} on PATH)`);
process.exit(1);
