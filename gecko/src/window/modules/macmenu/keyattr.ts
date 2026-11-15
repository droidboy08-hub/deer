// macOS menu bar: a key spec of shortcuts.ts ("Mod+Shift+T", "Mod+Ctrl+F", "Mod+[", "Mod+Period")
// as the attributes of a XUL <key> element, which is how a native menu item gets its key equivalent
// (the glyphs macOS prints at the right of the item). Pure: safe in any bundle (the window's and
// VitreShell's).
//
// Firefox 157 reads them like this (widget/cocoa/nsMenuItemX.mm, nsMenuItemX::SetKeyEquiv):
//   - the item's key="<id>" names a <key> element, looked up with getElementById when the item is
//     built and again whenever the item's key attribute changes (nsMenuItemX::ObserveAttributeChanged);
//     a change to the <key> element alone is not seen;
//   - key="t" is the character, lowercased by Firefox; Shift comes from the modifiers, so ⇧⌘T is
//     key="t" with modifiers="shift,accel";
//   - with no key, keycode="VK_..." goes through nsCocoaUtils::ConvertGeckoNameToMacCharCode
//     (widget/cocoa/nsCocoaUtils.mm, gKeyConversions). VK_ESCAPE converts to 0: Esc can never be a
//     key equivalent, so a spec on Esc gives no attributes at all;
//   - modifiers="control,alt,shift,accel" (widget/cocoa/nsMenuUtilsX.mm,
//     GeckoModifiersForNodeAttribute): accel and meta are ⌘, alt is ⌥, control is ⌃, shift is ⇧.
// The <key> elements must stay out of every <keyset>: only a <keyset> attaches Gecko's key handler
// (dom/xul/nsXULElement.cpp BindToTree -> XULKeySetGlobalKeyListener::AttachKeyHandler,
// dom/events/GlobalKeyListener.cpp), so a <key> outside one is read by the menu and never runs
// anything on a key press. The key router parks Firefox's own keys the same way (firefox.ts parkKeysets).

/** What a <key> element carries for one key equivalent. Exactly one of key / keycode is set. */
export interface KeyAttrs {
  modifiers: string;
  key?: string;
  keycode?: string;
}

/** Modifier words of the spec grammar (shortcuts.ts: Mod is ⌘, Ctrl the Control key; MacCtrl from a stored rebind). */
const MODIFIERS: Record<string, string> = {
  mod: 'accel',
  accel: 'accel',
  meta: 'accel',
  cmd: 'accel',
  command: 'accel',
  ctrl: 'control',
  control: 'control',
  macctrl: 'control',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

/** Apple's order, ⌃⌥⇧⌘ (Firefox does not care about the order; people reading the DOM do). */
const ORDER = ['control', 'alt', 'shift', 'accel'];

/** Key names of the spec grammar that are typed characters (shortcuts.ts keyName, MAC_KEY_ALIASES). */
const CHARACTERS: Record<string, string> = {
  Plus: '+',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  // Return is a character key equivalent (↩); VK_RETURN would give NSEnterCharacter, the keypad ⌤.
  Enter: '\r',
  Return: '\r',
};

/** Shifted punctuation a spec may spell out; the menu shows the key itself, with ⇧. */
const UNSHIFTED: Record<string, string> = { '{': '[', '}': ']', '<': ',', '>': '.', '?': '/', ':': ';', '"': "'", '~': '`', '|': '\\', _: '-' };

/** Keys that have no character: the names nsCocoaUtils.mm gKeyConversions knows. */
const KEYCODES: Record<string, string> = {
  Backspace: 'VK_BACK',
  Delete: 'VK_DELETE',
  Tab: 'VK_TAB',
  Left: 'VK_LEFT',
  ArrowLeft: 'VK_LEFT',
  Right: 'VK_RIGHT',
  ArrowRight: 'VK_RIGHT',
  Up: 'VK_UP',
  ArrowUp: 'VK_UP',
  Down: 'VK_DOWN',
  ArrowDown: 'VK_DOWN',
  PageUp: 'VK_PAGE_UP',
  PageDown: 'VK_PAGE_DOWN',
  Home: 'VK_HOME',
  End: 'VK_END',
  Space: 'VK_SPACE',
  ' ': 'VK_SPACE',
  Insert: 'VK_INSERT',
  Help: 'VK_HELP',
};

/**
 * The <key> attributes for a spec, or null when the spec cannot be a menu key equivalent (Esc, an
 * unknown modifier or key name, an empty spec).
 */
export function keyAttrs(spec: string): KeyAttrs | null {
  const parts = spec.trim().split('+');
  let key = parts.pop() ?? '';
  // "Mod++" spells the plus key with a literal "+".
  if (key === '' && parts.length && parts[parts.length - 1] === '') {
    parts.pop();
    key = '+';
  }
  if (!key) return null;
  const mods = new Set<string>();
  for (const part of parts) {
    const m = MODIFIERS[part.toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const modifiers = ORDER.filter((m) => mods.has(m)).join(',');
  if (key === 'Escape' || key === 'Esc') return null;
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return { modifiers, keycode: `VK_${key}` };
  if (KEYCODES[key]) return { modifiers, keycode: KEYCODES[key] };
  const num = /^Num(\d)$/.exec(key);
  if (num) return { modifiers, key: num[1] };
  if (CHARACTERS[key]) return { modifiers, key: CHARACTERS[key] };
  if ([...key].length === 1) return { modifiers, key: (UNSHIFTED[key] ?? key).toLowerCase() };
  return null;
}
