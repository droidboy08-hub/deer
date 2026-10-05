// Firefox's download protection for the files Deer's engine fetches itself. The take-over cancels
// Firefox's own Download before DownloadCore asks Safe Browsing about it
// (gre/modules/DownloadCore.sys.mjs, shouldBlockForReputationCheck), so the engine asks the same
// service with the same query when a file is complete, and opens executables the way
// DownloadIntegration.launchDownload does.
//
// Firefox internals (157), each used in one function below:
//   nsIApplicationReputationService.queryReputation / isBinary, VERDICT_*   the query
//     gre/modules/DownloadIntegration.sys.mjs shouldBlockForReputationCheck builds (source, referrer,
//     size, SHA-256, file name, signature info, redirects)
//   prefs browser.safebrowsing.downloads.enabled ("Block dangerous downloads") and
//     browser.safebrowsing.downloads.remote.enabled (gre/greprefs.js)
//   nsICryptoHash SHA256 over the finished file (the BackgroundFileSaver hashes while it writes;
//     Deer's ranged writer has none, so the file is read once, binaries only: only they go to the
//     remote lookup). No Authenticode signature info: a signed program is judged as unsigned.
//   DownloadIntegration.confirmLaunchExecutable(path) and Services.policies
//     .isExemptExecutableExtension(url, ext): launchDownload's prompt for an executable that is not
//     an .exe (Windows asks for those itself, by the Mark of the Web).
import { DownloadIntegration } from 'resource://gre/modules/DownloadIntegration.sys.mjs';
import { referrerFor, type ReferrerPolicy } from './referrer';
import { fileFor } from './partfile';

export type Verdict = 'safe' | 'dangerous' | 'uncommon' | 'unwanted';

const CHUNK = 4 * 1024 * 1024;

/** The service, looked up at each use (tests stand a mock in for the contract). */
function service(): any {
  return Cc['@mozilla.org/reputationservice/application-reputation-service;1'].getService(Ci.nsIApplicationReputationService);
}

/** SHA-256 of a file as the raw 32-byte string queryReputation wants, read in chunks off the main thread's way. */
async function sha256(path: string): Promise<string> {
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  for (let at = 0; ; at += CHUNK) {
    const buf: Uint8Array = await IOUtils.read(path, { offset: at, maxBytes: CHUNK });
    if (!buf.length) break;
    const s = Cc['@mozilla.org/io/arraybuffer-input-stream;1'].createInstance(Ci.nsIArrayBufferInputStream);
    s.setData(buf.buffer, buf.byteOffset, buf.length);
    hash.updateFromStream(s, buf.length);
    if (buf.length < CHUNK) break;
  }
  return hash.finish(false);
}

/**
 * What Safe Browsing says about a finished download. 'safe' when protection is off, the service
 * is missing, or anything goes wrong (as Firefox: a failed check never blocks).
 */
export async function reputationOf(o: { url: string; pageUrl: string; policy: ReferrerPolicy; path: string; size: number }): Promise<Verdict> {
  try {
    if (!Services.prefs.getBoolPref('browser.safebrowsing.downloads.enabled', true)) return 'safe';
    const svc = service();
    const name = PathUtils.filename(o.path);
    let binary = true;
    try {
      binary = !!svc.isBinary(name);
    } catch {
      binary = true;
    }
    // The hash only travels in the remote lookup (browser.safebrowsing.downloads.remote.enabled).
    const remote = Services.prefs.getBoolPref('browser.safebrowsing.downloads.remote.enabled', true);
    const hash = binary && remote ? await sha256(o.path) : '';
    let referrerInfo: any = null;
    if (/^https?:/i.test(o.pageUrl)) {
      const page = Services.io.newURI(o.pageUrl);
      const sent = referrerFor(page, Services.io.newURI(o.url), o.policy);
      if (sent) {
        referrerInfo = Cc['@mozilla.org/referrer-info;1'].createInstance(Ci.nsIReferrerInfo);
        referrerInfo.init(Ci.nsIReferrerInfo.UNSAFE_URL, true, sent);
      }
    }
    const V = Ci.nsIApplicationReputationService;
    return await new Promise<Verdict>((resolve) => {
      svc.queryReputation(
        {
          sourceURI: Services.io.newURI(o.url),
          referrerInfo,
          fileSize: o.size,
          sha256Hash: hash,
          suggestedFileName: name,
          signatureInfo: [],
          redirects: null,
        },
        (shouldBlock: boolean, _rv: number, verdict: number) => {
          if (!shouldBlock) resolve('safe');
          else if (verdict === V.VERDICT_UNCOMMON) resolve('uncommon');
          else if (verdict === V.VERDICT_POTENTIALLY_UNWANTED) resolve('unwanted');
          else resolve('dangerous');
        }
      );
    });
  } catch (e) {
    console.warn('Deer downloads: reputation check failed', String(e));
    return 'safe';
  }
}

/**
 * May this finished file be opened? An executable that is not an .exe (.bat, .cmd, .js, .vbs, .msi,
 * .lnk...) asks first with Firefox's own prompt, as DownloadIntegration.launchDownload does; an .exe
 * is left to Windows, which asks by its Mark of the Web.
 */
export async function mayLaunch(path: string, url: string): Promise<boolean> {
  try {
    const file = fileFor(path);
    const ext = /\.([^.]+)$/.exec(file.leafName)?.[1]?.toLowerCase() ?? '';
    let exempt = false;
    try {
      exempt = !!Services.policies.isExemptExecutableExtension(url, ext);
    } catch {
      exempt = false;
    }
    if (!file.isExecutable() || ext === 'exe' || exempt) return true;
    return !!(await DownloadIntegration.confirmLaunchExecutable(path));
  } catch (e) {
    console.error('Deer downloads: launch check failed', e);
    return false;
  }
}
