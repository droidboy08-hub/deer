// Deer's release key: an Ed25519 key pair that signs each release's SHA256SUMS.txt. Once
// gecko/update-key.txt exists, every build carries its public half (tools/build.mjs bakes it in as
// __DEER_UPDATE_KEY__) and an installed Deer downloads an update only when the release also has
// SHA256SUMS.txt.sig, a signature of that exact SHA256SUMS.txt by the private half
// (src/modules/VitreUpdater.sys.ts). Without update-key.txt releases are not signed and Deer trusts
// whatever the repository's latest release holds.
//
//   node tools/release-key.mjs new <private key file>
//       makes the key pair: the private key (PKCS #8 PEM) goes to <private key file>, which must be
//       outside this repository and must not exist yet; the public key (32 bytes, base64) goes to
//       gecko/update-key.txt, which is committed. Keep the private file offline and backed up: losing
//       it means installed copies can only be updated by downloading the setup by hand.
//   node tools/release-key.mjs sign <file> <private key file>
//       writes <file>.sig (the base64 signature and a newline) after checking that the private key
//       belongs to gecko/update-key.txt (installer/build.py --sign-key runs this for SHA256SUMS.txt)
//   node tools/release-key.mjs verify <file> [<signature file>]
//       checks <file> against <file>.sig (or the one given) with gecko/update-key.txt; exit 1 if not
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const GECKO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(GECKO, '..');
// DEER_UPDATE_KEY_FILE (tests only) puts the public half somewhere else than gecko/update-key.txt.
const PUBLIC = process.env.DEER_UPDATE_KEY_FILE ? resolve(process.env.DEER_UPDATE_KEY_FILE) : join(GECKO, 'update-key.txt');

function die(text) {
  console.error('release-key: ' + text);
  process.exit(1);
}

/** The raw 32-byte public key of a KeyObject (public or private), as base64. */
function rawPublic(key) {
  const jwk = (key.type === 'public' ? key : createPublicKey(key)).export({ format: 'jwk' });
  if (jwk.crv !== 'Ed25519') die('not an Ed25519 key');
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function publicKey() {
  if (!existsSync(PUBLIC)) die(`${PUBLIC} does not exist: make the key first (node tools/release-key.mjs new <private key file>)`);
  const b64 = readFileSync(PUBLIC, 'utf8').trim();
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) die(`${PUBLIC} does not hold a 32-byte Ed25519 public key (base64)`);
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

const inside = (path, folder) => {
  const rel = relative(folder, resolve(path));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
};

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'new' && args.length === 1) {
  const file = resolve(args[0]);
  if (inside(file, REPO)) die(`the private key must not be inside the repository (${REPO})`);
  if (existsSync(file)) die(`${file} exists already: refusing to overwrite a key`);
  if (existsSync(PUBLIC)) die(`${PUBLIC} exists already: a new key would make installed copies refuse updates signed with the old one. Remove it first if that is really wanted.`);
  const { privateKey, publicKey: pub } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const raw = rawPublic(pub);
  writeFileSync(file, pem, { flag: 'wx' });
  writeFileSync(PUBLIC, raw + '\n', { flag: 'wx' });
  console.log(`private key: ${file}  (keep it offline; never commit it)`);
  console.log(`public key:  ${PUBLIC}  (commit it; builds from now on accept only signed releases)`);
} else if (cmd === 'sign' && args.length === 2) {
  const [file, keyFile] = args.map((p) => resolve(p));
  const priv = createPrivateKey(readFileSync(keyFile));
  if (rawPublic(priv) !== rawPublic(publicKey())) die(`${keyFile} is not the private half of ${PUBLIC}`);
  const data = readFileSync(file);
  const sig = sign(null, data, priv);
  if (!verify(null, data, publicKey(), sig)) die('the signature does not verify');
  writeFileSync(file + '.sig', sig.toString('base64') + '\n');
  console.log(`signed ${file} -> ${file}.sig`);
} else if (cmd === 'verify' && (args.length === 1 || args.length === 2)) {
  const file = resolve(args[0]);
  const sigFile = args[1] ? resolve(args[1]) : file + '.sig';
  if (!existsSync(sigFile)) die(`${sigFile} does not exist`);
  const sig = Buffer.from(readFileSync(sigFile, 'utf8').trim(), 'base64');
  const ok = sig.length === 64 && verify(null, readFileSync(file), publicKey(), sig);
  console.log(ok ? `${file}: signed with Deer's key` : `${file}: NOT signed with Deer's key`);
  process.exit(ok ? 0 : 1);
} else {
  console.error('usage: node tools/release-key.mjs new <private key file> | sign <file> <private key file> | verify <file> [<signature file>]');
  process.exit(2);
}
