// Window-server helper for the mac-glass behaviour spikes (S3, S4, S5, S8, S9). Test-only.
// Build (Xcode or the Command Line Tools), into a folder outside the repo:
//   xcrun swiftc -O spikes/mac-glass/wininfo.swift -o <scratch>/wininfo
// Commands (JSON on stdout, one object):
//   list --pid P [--pid Q ...] [--helper H]
//        Every on-screen window, front to back (CGWindowListCopyWindowInfo, all layers), of the
//        processes P, Q... ("mine": true, with title), of the helper H ("helper"), and of other apps
//        only when they overlap one of mine ("other", no title, no app name). order = place in the
//        global front-to-back list; layer = window level (0 normal, 3 floating, 8 modal panel,
//        101 pop-up menu, 25 status ...).
//   ax --pid P      What the Accessibility API says about the app: active, hidden, the focused
//                   (key) window and the main window, and every AX window (title, role, subrole,
//                   frame, main, focused, minimized).
//   helper --x X --y Y --w W --h H --secs S [--activate] [--title T]
//        A plain titled window of this process at that rect (global points, top-left origin),
//        shown with orderFrontRegardless (no activation) or, with --activate, as the active app's
//        key window. Prints {"up": true, "pid", "id"} once it is on screen, quits after S seconds.
//   keys --pid P --seq "a b c cmd+a esc return"
//        Real key events (CGEvent, posted to that process only: CGEvent.postToPid), 40 ms apart.
//        Keys: a-z 0-9 space esc return tab delete left right up down; mods cmd shift alt ctrl.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func emit(_ obj: Any) {
    let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

struct Args {
    var values: [String: [String]] = [:]
    var flags: Set<String> = []
    init(_ argv: [String]) {
        var i = 0
        while i < argv.count {
            let t = argv[i]
            guard t.hasPrefix("--") else { i += 1; continue }
            let key = String(t.dropFirst(2))
            if i + 1 < argv.count, !argv[i + 1].hasPrefix("--") || Double(argv[i + 1]) != nil {
                values[key, default: []].append(argv[i + 1])
                i += 2
            } else {
                flags.insert(key)
                i += 1
            }
        }
    }
    func str(_ k: String) -> String? { values[k]?.last }
    func num(_ k: String) -> Double? { str(k).flatMap(Double.init) }
    func ints(_ k: String) -> [Int] { (values[k] ?? []).flatMap { $0.split(separator: ",") }.compactMap { Int($0) } }
}

func rectOf(_ w: [String: Any]) -> CGRect {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    func d(_ k: String) -> Double { (b[k] as? NSNumber)?.doubleValue ?? 0 }
    return CGRect(x: d("X"), y: d("Y"), width: d("Width"), height: d("Height"))
}

func list(_ a: Args) {
    let pids = Set(a.ints("pid"))
    let helpers = Set(a.ints("helper"))
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else {
        fail("CGWindowListCopyWindowInfo failed")
    }
    var union = CGRect.null
    for w in info where pids.contains((w[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1) {
        union = union.union(rectOf(w))
    }
    var out: [[String: Any]] = []
    for (i, w) in info.enumerated() {
        let pid = (w[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1
        let r = rectOf(w)
        let mine = pids.contains(pid)
        let helper = helpers.contains(pid)
        let layer = (w[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        if !mine && !helper && (union.isNull || !union.intersects(r) || layer > 1000 || layer < 0) { continue }
        var row: [String: Any] = [
            "order": i, "id": (w[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0, "pid": pid,
            "who": mine ? "mine" : helper ? "helper" : "other", "layer": layer,
            "x": r.origin.x, "y": r.origin.y, "w": r.width, "h": r.height,
            "alpha": (w[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1,
        ]
        if mine || helper { row["title"] = (w[kCGWindowName as String] as? String) ?? "" }
        out.append(row)
    }
    emit(["windows": out, "union": union.isNull ? [] : [union.origin.x, union.origin.y, union.width, union.height]])
}

func axAttr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func axWindow(_ el: AXUIElement) -> [String: Any] {
    var d: [String: Any] = [:]
    d["title"] = axAttr(el, kAXTitleAttribute) as? String ?? ""
    d["role"] = axAttr(el, kAXRoleAttribute) as? String ?? ""
    d["subrole"] = axAttr(el, kAXSubroleAttribute) as? String ?? ""
    if let pv = axAttr(el, kAXPositionAttribute), CFGetTypeID(pv) == AXValueGetTypeID() {
        var p = CGPoint.zero
        AXValueGetValue(pv as! AXValue, .cgPoint, &p)
        d["x"] = p.x
        d["y"] = p.y
    }
    if let sv = axAttr(el, kAXSizeAttribute), CFGetTypeID(sv) == AXValueGetTypeID() {
        var s = CGSize.zero
        AXValueGetValue(sv as! AXValue, .cgSize, &s)
        d["w"] = s.width
        d["h"] = s.height
    }
    for (k, attr) in [("main", kAXMainAttribute), ("focused", kAXFocusedAttribute), ("minimized", kAXMinimizedAttribute)] {
        if let b = axAttr(el, attr) as? Bool { d[k] = b }
    }
    return d
}

func ax(_ a: Args) {
    guard let pid = a.ints("pid").first else { fail("--pid is required") }
    let app = AXUIElementCreateApplication(pid_t(pid))
    var out: [String: Any] = ["trusted": AXIsProcessTrusted()]
    if let ra = NSRunningApplication(processIdentifier: pid_t(pid)) {
        out["active"] = ra.isActive
        out["hidden"] = ra.isHidden
    }
    out["frontmostIsThis"] = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid_t(pid)
    if let f = axAttr(app, kAXFocusedWindowAttribute), CFGetTypeID(f) == AXUIElementGetTypeID() { out["focusedWindow"] = axWindow(f as! AXUIElement) }
    if let m = axAttr(app, kAXMainWindowAttribute), CFGetTypeID(m) == AXUIElementGetTypeID() { out["mainWindow"] = axWindow(m as! AXUIElement) }
    if let ws = axAttr(app, kAXWindowsAttribute) as? [AXUIElement] { out["windows"] = ws.map(axWindow) }
    emit(out)
}

/// axfocus --pid P: the app's focused UI element as an assistive app (VoiceOver) sees it: role,
/// subrole, title, value, description and the AX window it belongs to. Asking turns Gecko's
/// accessibility on (AXEnhancedUserInterface, as VoiceOver does), so it asks twice, 1.5 s apart.
func axfocus(_ a: Args) {
    guard let pid = a.ints("pid").first else { fail("--pid is required") }
    let app = AXUIElementCreateApplication(pid_t(pid))
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    var out: [String: Any] = [:]
    for pass in 0..<2 {
        if pass == 1 { Thread.sleep(forTimeInterval: 1.5) }
        guard let f = axAttr(app, kAXFocusedUIElementAttribute), CFGetTypeID(f) == AXUIElementGetTypeID() else {
            out["focused"] = "none"
            continue
        }
        let el = f as! AXUIElement
        var d = axWindow(el)
        d["value"] = (axAttr(el, kAXValueAttribute) as? String) ?? ""
        d["description"] = (axAttr(el, kAXDescriptionAttribute) as? String) ?? ""
        d["roleDescription"] = (axAttr(el, kAXRoleDescriptionAttribute) as? String) ?? ""
        d["placeholder"] = (axAttr(el, "AXPlaceholderValue") as? String) ?? ""
        if let w = axAttr(el, kAXWindowAttribute), CFGetTypeID(w) == AXUIElementGetTypeID() { d["window"] = axWindow(w as! AXUIElement) }
        out["focused"] = d
    }
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse)
    emit(out)
}

final class HelperDelegate: NSObject, NSApplicationDelegate {
    let a: Args
    var win: NSWindow?
    init(_ a: Args) { self.a = a }
    func applicationDidFinishLaunching(_ n: Notification) {
        let x = a.num("x") ?? 100, y = a.num("y") ?? 100, w = a.num("w") ?? 400, h = a.num("h") ?? 300
        let screenH = NSScreen.screens.first?.frame.height ?? 1117
        let rect = NSRect(x: x, y: screenH - y - h, width: w, height: h)
        let win = NSWindow(contentRect: rect, styleMask: [.titled], backing: .buffered, defer: false)
        win.title = a.str("title") ?? "glass spike helper"
        win.backgroundColor = NSColor(calibratedRed: 0.95, green: 0.55, blue: 0.10, alpha: 1)
        win.isReleasedWhenClosed = false
        let label = NSTextField(labelWithString: "Another app's window (spike helper)")
        label.font = NSFont.systemFont(ofSize: 22, weight: .semibold)
        label.textColor = .black
        label.frame = NSRect(x: 24, y: h / 2 - 16, width: w - 48, height: 32)
        win.contentView?.addSubview(label)
        self.win = win
        if a.flags.contains("activate") {
            NSApp.activate(ignoringOtherApps: true)
            win.makeKeyAndOrderFront(nil)
        } else {
            win.orderFrontRegardless()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            emit(["up": true, "pid": Int(ProcessInfo.processInfo.processIdentifier), "id": win.windowNumber, "active": NSApp.isActive])
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + (self.a.num("secs") ?? 5)) {
            win.orderOut(nil)
            exit(0)
        }
    }
}

func helper(_ a: Args) {
    let app = NSApplication.shared
    app.setActivationPolicy(a.flags.contains("activate") ? .regular : .accessory)
    let d = HelperDelegate(a)
    app.delegate = d
    app.run()
}

let KEYCODES: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
    "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
    "9": 25, "7": 26, "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40,
    "n": 45, "m": 46, "space": 49, "esc": 53, "return": 36, "tab": 48, "delete": 51, "left": 123,
    "right": 124, "down": 125, "up": 126, "period": 47, "comma": 43,
]

func keys(_ a: Args) {
    guard let pid = a.ints("pid").first else { fail("--pid is required") }
    guard let seq = a.str("seq") else { fail("--seq is required") }
    let src = CGEventSource(stateID: .privateState)
    var sent: [String] = []
    for item in seq.split(separator: " ") {
        let parts = item.lowercased().split(separator: "+").map(String.init)
        guard let key = parts.last, let code = KEYCODES[key] else { fail("unknown key \(item)") }
        var flags: CGEventFlags = []
        for m in parts.dropLast() {
            switch m {
            case "cmd": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "alt": flags.insert(.maskAlternate)
            case "ctrl": flags.insert(.maskControl)
            default: fail("unknown modifier \(m)")
            }
        }
        for down in [true, false] {
            guard let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down) else { fail("CGEvent failed") }
            e.flags = flags
            if key.count == 1, flags.subtracting(.maskShift).isEmpty {
                var chars = Array((flags.contains(.maskShift) ? key.uppercased() : key).utf16)
                e.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: &chars)
            }
            e.postToPid(pid_t(pid))
            usleep(down ? 25_000 : 40_000)
        }
        sent.append(String(item))
    }
    emit(["sent": sent, "pid": pid])
}

/// track --pid P [--pid Q] --secs S [--every-ms 4] [--go FILE]
/// The window server's frames of those processes' on-screen windows, sampled every few ms for S
/// seconds: {"t0": epoch s, "samples": [[ms, [[id, layer, x, y, w, h, alpha], ...]], ...]}, a sample
/// kept only when something changed. --go: a file written after the first sample.
func track(_ a: Args) {
    let pids = Set(a.ints("pid"))
    let secs = a.num("secs") ?? 3
    let every = (a.num("every-ms") ?? 4) / 1000
    let t0 = Date().timeIntervalSince1970
    var samples: [[Any]] = []
    var last = ""
    var wrote = false
    while Date().timeIntervalSince1970 - t0 < secs {
        let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
        var rows: [[Any]] = []
        for w in info where pids.contains((w[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1) {
            let r = rectOf(w)
            rows.append([(w[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0, (w[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0,
                         r.origin.x, r.origin.y, r.width, r.height, (w[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1])
        }
        let key = rows.map { "\($0)" }.joined()
        let ms = (Date().timeIntervalSince1970 - t0) * 1000
        if key != last {
            samples.append([Double(Int(ms * 10)) / 10, rows])
            last = key
        }
        if !wrote, let go = a.str("go") {
            FileManager.default.createFile(atPath: go, contents: Data())
            wrote = true
        }
        Thread.sleep(forTimeInterval: every)
    }
    emit(["t0": t0, "samples": samples])
}

let argv = Array(CommandLine.arguments.dropFirst())
guard let cmd = argv.first else { fail("usage: wininfo list|ax|helper|keys|track ...") }
let a = Args(Array(argv.dropFirst()))
switch cmd {
case "list": list(a)
case "ax": ax(a)
case "helper": helper(a)
case "keys": keys(a)
case "track": track(a)
case "axfocus": axfocus(a)
default: fail("unknown command \(cmd)")
}
