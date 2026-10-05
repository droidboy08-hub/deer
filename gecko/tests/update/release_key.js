// Run by tests/update/release_key.py: a release key made and a SHA256SUMS.txt signed by
// tools/release-key.mjs (Node), checked the way an installed Deer checks it (Gecko's WebCrypto,
// Ed25519; src/modules/VitreUpdater.sys.ts). KEYTOOL_DATA = {"pub", "sig", "msg"}.
/* global spike, Services */
spike.main(async () => {
  const d = JSON.parse(Services.env.get("KEYTOOL_DATA"));
  const raw = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw(d.pub), { name: "Ed25519" }, false, ["verify"]);
  const msg = new TextEncoder().encode(d.msg);
  spike.check("Gecko's WebCrypto accepts Node's signature of SHA256SUMS.txt", await crypto.subtle.verify({ name: "Ed25519" }, key, raw(d.sig), msg));
  spike.check("... and refuses it for other content", !(await crypto.subtle.verify({ name: "Ed25519" }, key, raw(d.sig), new TextEncoder().encode(d.msg + "x"))));
});
