// Compile the development launcher, launcher/Launcher.cs (+ installer/ProfileMigration.cs, which the
// installed Deer.exe shares), to launcher/Deer.exe with the .NET Framework compiler that ships with
// Windows (no SDK), with the gold Deer icon. The exe is git-ignored; launcher/Deer.cmd runs it and
// builds it first when it is missing. Run this again after changing either source file.
// launcher/Vitre.exe (the launcher's name before the rename, still on old taskbar pins and in old
// scripts) is written as a copy of the same program, so whatever starts it opens Deer's development
// profile like Deer.exe, never the pre-rename profile on its own.
//   node tools/build-launcher.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windir = process.env.WINDIR ?? 'C:\\Windows';
const csc = [join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find(existsSync);
if (!csc) {
  console.error('csc.exe (.NET Framework 4) not found: launcher\\Deer.exe cannot be built');
  process.exit(1);
}
// The gold Deer icon (the file keeps its old name on purpose; tools/make-icon.py writes it).
const icon = join(ROOT, 'tools', 'runtime-overlay', 'browser', 'chrome', 'icons', 'default', 'vitre.ico');
const out = join(ROOT, 'launcher', 'Deer.exe');
const args = ['/nologo', '/target:winexe', '/optimize+', '/codepage:65001', `/out:${out}`];
if (existsSync(icon)) args.push(`/win32icon:${icon}`);
args.push(join(ROOT, 'launcher', 'Launcher.cs'), join(ROOT, 'installer', 'ProfileMigration.cs'));
const r = spawnSync(csc, args, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`built ${out}`);
const old = join(ROOT, 'launcher', 'Vitre.exe');
try {
  copyFileSync(out, old);
  console.log(`copied to ${old} (old pins and scripts)`);
} catch (e) {
  // In use (a Vitre.exe still starting): Deer.exe is built; the copy is made next time.
  console.warn(`could not update ${old}: ${e.message}`);
}
