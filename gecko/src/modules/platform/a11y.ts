// System accessibility settings Deer follows.
//
//   stickyKeysOn()   Sticky Keys is on (the tab switcher then opens latched, since a held Ctrl
//                    can't be told from a latched one). Windows: HKCU\Control Panel\Accessibility\
//                    StickyKeys, value Flags, bit 0 (SKF_STICKYKEYSON); read at most once per 5 s.
//                    macOS: false for now (its Sticky Keys setting is not read yet).
//
// The Windows reading is a copy of VitreSwitcher.stickyKeys(), which the switcher still calls.
// Firefox internal: nsIWindowsRegKey (xpcom/ds/nsIWindowsRegKey.idl), Windows only.
import { isWin } from '../../shared/os';

const STICKY_TTL = 5000;
let sticky = { on: false, at: -Infinity };

/** Whether the system's Sticky Keys is on. */
export function stickyKeysOn(): boolean {
  if (!isWin) return false;
  const now = Date.now();
  if (now - sticky.at < STICKY_TTL) return sticky.on;
  let on = false;
  const key = Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);
  try {
    key.open(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER, 'Control Panel\\Accessibility\\StickyKeys', Ci.nsIWindowsRegKey.ACCESS_READ);
    if (key.hasValue('Flags')) on = (Number.parseInt(String(key.readStringValue('Flags')), 10) & 1) === 1;
  } catch {
    on = false;
  } finally {
    try {
      key.close();
    } catch {
      /* never opened */
    }
  }
  sticky = { on, at: now };
  return on;
}
