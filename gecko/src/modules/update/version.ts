// Pure helpers of Deer's updater (VitreUpdater.sys.ts): semantic versions and SHA256SUMS.txt.
// No Gecko globals here, so the rules can be read (and tested through VitreUpdater) on their own.

/** A parsed semantic version (semver.org 2.0.0); `pre` is empty for a release. */
export interface Semver {
  major: string;
  minor: string;
  patch: string;
  pre: string[];
}

const SEMVER = /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** "1.4.2", "v1.4.2" (or "V1.4.2"), "1.5.0-beta.1", "1.5.0+build.7" -> Semver; anything else -> null. */
export function parseVersion(text: unknown): Semver | null {
  if (typeof text !== 'string') return null;
  const m = SEMVER.exec(text.trim());
  if (!m) return null;
  return { major: m[1], minor: m[2], patch: m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** Numbers of any length, compared as numbers (no leading zeros by the pattern above). */
function compareNumeric(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semver precedence: <0 when a is older than b, 0 when equal (build metadata is ignored), >0 when
 * newer. A prerelease is older than its release; numeric identifiers sort numerically and before
 * alphanumeric ones; a longer set of identifiers wins when all before it are equal.
 * Returns NaN when either side is not a version.
 */
export function compareVersions(a: string | Semver, b: string | Semver): number {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) return NaN;
  for (const k of ['major', 'minor', 'patch'] as const) {
    const c = compareNumeric(x[k], y[k]);
    if (c) return c;
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    let c: number;
    if (pn && qn) c = compareNumeric(p, q);
    else if (pn !== qn) c = pn ? -1 : 1;
    else c = p < q ? -1 : p > q ? 1 : 0;
    if (c) return c;
  }
  return 0;
}

/** The version without a leading "v" (or "V") or build metadata, as shown: "v1.5.0+b7" -> "1.5.0". */
export function displayVersion(text: string): string {
  return text.trim().replace(/^[vV]/, '').replace(/\+.*$/, '');
}

/**
 * The SHA-256 SHA256SUMS.txt gives for `name` ("<64 hex>  <name>" or "<64 hex> *<name>" lines, as
 * sha256sum writes them; installer/build.py writes the first form), lower-case. '' when the file has
 * no line for that name, or two lines that disagree.
 */
export function sumFor(text: string, name: string): string {
  let found = '';
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (!m || m[2] !== name) continue;
    const sum = m[1].toLowerCase();
    if (found && found !== sum) return '';
    found = sum;
  }
  return found;
}
