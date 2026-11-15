// A small Objective-C bridge for macOS through js-ctypes (gre/modules/ctypes.sys.mjs): look up a
// class or a selector, send a message with a fixed signature, and turn strings into NSString and
// back. Nothing is loaded until the first call, and nothing here is ever loaded on Windows: every
// entry point throws there.
//
//   const o = VitrePlatform.objc;
//   const t = o.ctypes();
//   const app = o.send(o.id())(o.cls('NSApplication'), o.sel('sharedApplication'));
//   const n = o.send(t.long)(nsWindow, o.sel('windowNumber'));
//
// Why one declaration per signature: objc_msgSend must be called through a function type that
// matches the method exactly. On Apple arm64 a variadic call puts its variable arguments on the
// stack while the method reads them from registers, so declaring objc_msgSend as variadic would pass
// garbage; send() declares (and caches) a non-variadic objc_msgSend for each return and argument
// list. On arm64 every return kind (pointers, integers, floating point, structs) goes through plain
// objc_msgSend; there is no _stret or _fpret variant to choose (Deer's Mac build is arm64 only).
//
// Objects returned by convenience constructors (stringWithUTF8String: and the like) are autoreleased
// into the pool around the Gecko event being run (widget/cocoa/nsAppShell.mm), so an id is good for
// the task that got it: never keep one across events without retaining it.
import { isMac } from '../../shared/os';

/** What the loaded bridge holds: the libraries stay open for the process. */
interface Bridge {
  ctypes: any;
  /** id, Class and SEL are all plain pointers here. */
  id: any;
  libobjc: any;
  appkit: any;
  getClass: (name: string) => any;
  registerName: (name: string) => any;
}

let bridge: Bridge | null = null;
const classes = new Map<string, any>();
const selectors = new Map<string, any>();
const senders = new Map<string, (...args: any[]) => any>();

/** Whether this process can use the bridge: macOS only. */
export function available(): boolean {
  return isMac;
}

/**
 * libobjc and AppKit, opened once. AppKit is already in the process (Gecko's widget layer links
 * it); opening it again only makes sure its classes are registered before objc_getClass asks.
 */
function load(): Bridge {
  if (bridge) return bridge;
  if (!available()) throw new Error('objc: macOS only');
  const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
  const libobjc = ctypes.open('/usr/lib/libobjc.A.dylib');
  const appkit = ctypes.open('/System/Library/Frameworks/AppKit.framework/AppKit');
  const id = ctypes.voidptr_t;
  bridge = {
    ctypes,
    id,
    libobjc,
    appkit,
    getClass: libobjc.declare('objc_getClass', ctypes.default_abi, id, ctypes.char.ptr),
    registerName: libobjc.declare('sel_registerName', ctypes.default_abi, id, ctypes.char.ptr),
  };
  return bridge;
}

/** The js-ctypes object, for the types a signature needs (t.long, t.double, t.char.ptr...). */
export function ctypes(): any {
  return load().ctypes;
}

/** The type of an object, a class or a selector: a pointer. */
export function id(): any {
  return load().id;
}

/** A pointer from the hex text Gecko prints for one (nsIBaseWindow.nativeHandle: "0x..."). */
export function ptr(hex: string): any {
  const b = load();
  return b.id(b.ctypes.UInt64(hex));
}

/** Whether an id is nil (a null pointer, or nothing at all). */
export function isNil(obj: any): boolean {
  return !obj || obj.isNull();
}

/** objc_getClass(name). Throws when the class does not exist. */
export function cls(name: string): any {
  let c = classes.get(name);
  if (!c) {
    c = load().getClass(name);
    if (c.isNull()) throw new Error(`objc: no class ${name}`);
    classes.set(name, c);
  }
  return c;
}

/** sel_registerName(name): "windowNumber", "stringWithUTF8String:" (one colon per argument). */
export function sel(name: string): any {
  let s = selectors.get(name);
  if (!s) {
    s = load().registerName(name);
    selectors.set(name, s);
  }
  return s;
}

/**
 * objc_msgSend declared for one signature: send(ret, ...argTypes) gives a function called as
 * (receiver, selector, ...args). The receiver and the selector are always pointers and are not
 * listed. Declarations are cached by the types' names, so a struct type needs a unique name.
 */
export function send(ret: any, ...argTypes: any[]): (receiver: any, selector: any, ...args: any[]) => any {
  const key = [ret, ...argTypes].map((t) => String(t.name)).join(',');
  let fn = senders.get(key);
  if (!fn) {
    const b = load();
    fn = b.libobjc.declare('objc_msgSend', b.ctypes.default_abi, ret, b.id, b.id, ...argTypes) as (...args: any[]) => any;
    senders.set(key, fn);
  }
  return fn;
}

/**
 * An NSString with the text of a JS string: [NSString stringWithUTF8String:] (js-ctypes passes a JS
 * string to a char* argument as UTF-8). Autoreleased (see the top of this file). Text after a NUL
 * character is lost, as for any C string.
 */
export function nsString(js: string): any {
  const b = load();
  return send(b.id, b.ctypes.char.ptr)(cls('NSString'), sel('stringWithUTF8String:'), js);
}

/** The text of an NSString ([obj UTF8String], read as UTF-8), or null for nil. */
export function jsString(obj: any): string | null {
  if (isNil(obj)) return null;
  const b = load();
  const chars = send(b.ctypes.char.ptr)(obj, sel('UTF8String'));
  return chars.isNull() ? null : chars.readString();
}
