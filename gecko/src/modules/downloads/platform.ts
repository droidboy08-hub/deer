// The few Windows-facing services the downloader needs, each behind one small function.
//
//   openFile / showInFolder / openFolder   nsIFile.launch() and nsIFile.reveal() (Explorer)
//   copyText / readClipboardText           nsIClipboardHelper; nsITransferable + Services.clipboard.getData
//                                          (browser/chrome/browser/content/browser/downloads/downloads.js
//                                          reads a pasted link the same way)
//   markOfTheWeb                           mozIDownloadPlatform.maybeWriteDownloadOriginInformation, the
//                                          call Firefox's own downloads make (gre/modules/DownloadIntegration.sys.mjs)
//   pickSavePath / pickFolder              nsIFilePicker on a window's browsing context (recipe: TAKE-OVER)
import { fileFor } from './partfile';
import { policyConstant, type ReferrerPolicy } from './referrer';

export function openFile(path: string): boolean {
  try {
    fileFor(path).launch();
    return true;
  } catch (e) {
    console.error('Deer downloads: could not open', path, e);
    return false;
  }
}

export function showInFolder(path: string): boolean {
  try {
    fileFor(path).reveal();
    return true;
  } catch {
    return false;
  }
}

export function openFolder(dir: string): boolean {
  try {
    const f = fileFor(dir);
    if (!f.exists()) f.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
    f.launch();
    return true;
  } catch (e) {
    console.error('Deer downloads: could not open the folder', dir, e);
    return false;
  }
}

export function copyText(text: string): void {
  Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(text);
}

/** Plain text on the clipboard ('' when there is none). */
export function readClipboardText(): string {
  try {
    const trans = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
    trans.init(null);
    trans.addDataFlavor('text/plain');
    Services.clipboard.getData(trans, Services.clipboard.kGlobalClipboard);
    const data: { value?: any } = {};
    trans.getTransferData('text/plain', data);
    return String(data.value?.QueryInterface(Ci.nsISupportsString).data ?? '');
  } catch {
    return '';
  }
}

/** A web address on the clipboard, or null. */
export function clipboardUrl(): string | null {
  const text = readClipboardText().trim();
  return /^https?:\/\/\S+$/i.test(text) && text.length < 4096 ? text : null;
}

/**
 * Mark of the Web: the Zone.Identifier stream Windows (SmartScreen, Office) reads to know a file
 * came from the internet. Firefox's own service writes it.
 */
export async function markOfTheWeb(path: string, url: string, pageUrl: string, isPrivate: boolean, policy: ReferrerPolicy = ''): Promise<void> {
  try {
    let referrer: any = null;
    if (/^https?:/i.test(pageUrl)) {
      // The page's own referrer policy (referrer.ts): a no-referrer download records no page.
      referrer = Cc['@mozilla.org/referrer-info;1'].createInstance(Ci.nsIReferrerInfo);
      referrer.init(policyConstant(policy), policy !== 'no-referrer', Services.io.newURI(pageUrl));
    }
    const platform = Cc['@mozilla.org/toolkit/download-platform;1'].getService(Ci.mozIDownloadPlatform);
    await platform.maybeWriteDownloadOriginInformation(fileFor(path), Services.io.newURI(url), referrer, isPrivate);
  } catch (e) {
    console.warn('Deer downloads: Mark of the Web failed', String(e));
  }
}

/** The native Save dialog. Resolves with the chosen path, or null when it was cancelled. */
export function pickSavePath(win: any, { title = 'Save As', name = '', dir = '' } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
      fp.init(win.browsingContext, title, Ci.nsIFilePicker.modeSave);
      fp.defaultString = name;
      const ext = /\.([a-z0-9]{1,10})$/i.exec(name)?.[1];
      if (ext) {
        fp.defaultExtension = ext;
        fp.appendFilter(ext.toUpperCase(), '*.' + ext);
      }
      fp.appendFilters(Ci.nsIFilePicker.filterAll);
      if (dir) {
        try {
          fp.displayDirectory = fileFor(dir);
        } catch {
          /* no such folder: the dialog picks one */
        }
      }
      fp.open((result: number) => {
        resolve(result === Ci.nsIFilePicker.returnOK || result === Ci.nsIFilePicker.returnReplace ? fp.file.path : null);
      });
    } catch (e) {
      console.error('Deer downloads: the Save dialog failed', e);
      resolve(null);
    }
  });
}

/** The native folder picker. */
export function pickFolder(win: any, { title = 'Choose a folder', dir = '' } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
      fp.init(win.browsingContext, title, Ci.nsIFilePicker.modeGetFolder);
      if (dir) {
        try {
          fp.displayDirectory = fileFor(dir);
        } catch {
          /* ignore */
        }
      }
      fp.open((result: number) => resolve(result === Ci.nsIFilePicker.returnOK ? fp.file.path : null));
    } catch {
      resolve(null);
    }
  });
}

/** The native file picker for one program (ffmpeg.exe). */
export function pickProgram(win: any, { title = 'Choose ffmpeg.exe', dir = '' } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
      fp.init(win.browsingContext, title, Ci.nsIFilePicker.modeOpen);
      fp.appendFilter('ffmpeg', 'ffmpeg.exe');
      fp.appendFilters(Ci.nsIFilePicker.filterApps);
      if (dir) {
        try {
          fp.displayDirectory = fileFor(dir);
        } catch {
          /* ignore */
        }
      }
      fp.open((result: number) => resolve(result === Ci.nsIFilePicker.returnOK ? fp.file.path : null));
    } catch {
      resolve(null);
    }
  });
}
