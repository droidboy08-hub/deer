// deer-wintool: the macOS window helper of Deer's test harness. It lists windows, brings an app to
// the front and takes real screenshots of a window or of a screen rectangle, which tools/run.py
// does with user32/gdi32 on Windows.
//
// Swift 6, macOS 14 or later, Apple frameworks only. tools/mac/wintool.py builds it on first use
// (xcrun swiftc -O) into tools/mac/bin/deer-wintool, which git ignores, and rebuilds it when this
// file is newer. Run it through wintool.py:  python3 tools/mac/wintool.py preflight
//
//   preflight [--request]
//       {"screenCapture": bool, "accessibility": bool, "app": NAME|null}. "app" is the nearest
//       ancestor app of this process: usually the one macOS asks the Screen Recording permission
//       of (Terminal, an editor, the Claude app). --request also calls
//       CGRequestScreenCaptureAccess(), which shows the system prompt (only the first time).
//   list [--pid N ...] [--name TEXT]
//       A JSON array with one object per window of layer 0 (ordinary windows, front to back for the
//       ones on screen): id, pid, owner, title, x, y, w, h, onscreen, alpha. --pid (repeatable,
//       or N,M) keeps those processes' windows; --name keeps the apps whose name contains TEXT
//       (case-insensitive). Works without the Screen Recording permission, but "title" is then
//       null for other apps' windows.
//   front --pid N [--id WINDOW]
//       Activates that app (NSRunningApplication.activate, all its windows) and, when this process
//       may use Accessibility, also makes it frontmost and raises the window --id (else its main
//       window) through the AX API. {"ok": true, "activated": bool, "ax": bool, "front": bool}:
//       "front" says whether the app's window (--id when given) became the frontmost window.
//   capture --id WINDOW --out FILE.png [--no-shadow] [--children] [--screencapture]
//       That window at full Retina resolution through ScreenCaptureKit (a desktop-independent
//       window filter, so windows covering it are not in the picture; sRGB). Without --no-shadow
//       the window's shadow is included. --children includes its child windows (macOS 14.2+).
//       When ScreenCaptureKit fails, or with --screencapture, falls back to
//       /usr/sbin/screencapture -x -l<id> (-o with --no-shadow). {"ok": true, "w", "h", "scale",
//       "via": "screencapturekit"|"screencapture", "note"?}
//   capture-rect --x X --y Y --w W --h H --out FILE.png [--pid N ...] [--screencapture]
//       A rectangle of the screen (for menus and panels, which are separate windows) on the display
//       it overlaps most. --pid keeps only those apps' windows in the picture (others are left
//       out, not drawn over it). Fallback: screencapture -x -R (without the --pid filter).
//       {"ok": true, "w", "h", "scale", "display", "via", "note"?}
//
// Coordinates are global points, as CGWindowListCopyWindowInfo gives them: origin at the top left
// of the main display, y downwards. Pixels = points * scale (2 on a Retina display).
// Output: one JSON document on stdout; messages on stderr.
// Exit codes: 0 ok, 1 failed, 2 bad arguments, 3 not found, 4 Screen Recording permission off.
//
// Screen captures need the Screen Recording permission for the app that runs this tool; without
// it ScreenCaptureKit fails and screencapture draws only the wallpaper, so capture and
// capture-rect check CGPreflightScreenCaptureAccess() first and exit 4. macOS stops drawing a
// window that is fully covered and not active, so the harness brings Deer to the front (front)
// before it captures. A sandboxed shell may be refused access to the window server: list then
// fails with a message saying so.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

enum Exit: Int32 {
    case ok = 0
    case failed = 1
    case badArgs = 2
    case notFound = 3
    case noPermission = 4
}

let permissionMessage = "Screen Recording permission is off for the app running this harness: "
    + "System Settings › Privacy & Security › Screen & System Audio Recording"

let usage = """
    usage: deer-wintool preflight [--request]
           deer-wintool list [--pid N ...] [--name TEXT]
           deer-wintool front --pid N [--id WINDOW]
           deer-wintool capture --id WINDOW --out FILE.png [--no-shadow] [--children] [--screencapture]
           deer-wintool capture-rect --x X --y Y --w W --h H --out FILE.png [--pid N ...] [--screencapture]
    """

func fail(_ code: Exit, _ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code.rawValue)
}

func emit(_ value: JSON) {
    print(value.text)
}

// MARK: - JSON output (keys keep their order)

enum JSON {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([(String, JSON)])

    static func num<T: BinaryInteger>(_ value: T) -> JSON { .number(Double(value)) }
    static func num(_ value: CGFloat) -> JSON { .number(Double(value)) }
    static func str(_ value: String?) -> JSON { value.map { .string($0) } ?? .null }

    var text: String {
        switch self {
        case .null:
            return "null"
        case .bool(let value):
            return value ? "true" : "false"
        case .number(let value):
            guard value.isFinite else { return "null" }
            if value == value.rounded(), abs(value) < 1e15 { return String(Int64(value)) }
            return String(value)
        case .string(let value):
            return JSON.quote(value)
        case .array(let items):
            return "[" + items.map(\.text).joined(separator: ",") + "]"
        case .object(let fields):
            return "{" + fields.map { JSON.quote($0.0) + ":" + $0.1.text }.joined(separator: ",") + "}"
        }
    }

    static func quote(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }
}

// MARK: - Arguments

struct Options {
    private var values: [String: [String]] = [:]
    private var flags: Set<String> = []

    init(_ argv: [String], values allowedValues: Set<String> = [], flags allowedFlags: Set<String> = []) {
        var i = 0
        while i < argv.count {
            let token = argv[i]
            guard token.hasPrefix("--"), token.count > 2 else { fail(.badArgs, "unexpected argument \(token)\n\(usage)") }
            var key = String(token.dropFirst(2))
            var inline: String?
            if let eq = key.firstIndex(of: "=") {
                inline = String(key[key.index(after: eq)...])
                key = String(key[..<eq])
            }
            if allowedFlags.contains(key) {
                if inline != nil { fail(.badArgs, "--\(key) takes no value") }
                flags.insert(key)
            } else if allowedValues.contains(key) {
                let value: String
                if let inline {
                    value = inline
                } else {
                    i += 1
                    guard i < argv.count else { fail(.badArgs, "--\(key) needs a value") }
                    value = argv[i]  // taken as is, so negative coordinates work: --x -1440
                }
                values[key, default: []].append(value)
            } else {
                fail(.badArgs, "unknown option --\(key)\n\(usage)")
            }
            i += 1
        }
    }

    func has(_ flag: String) -> Bool { flags.contains(flag) }

    func string(_ key: String) -> String? { values[key]?.last }

    func required(_ key: String) -> String {
        guard let value = string(key), !value.isEmpty else { fail(.badArgs, "--\(key) is required\n\(usage)") }
        return value
    }

    func int(_ key: String) -> Int? {
        guard let text = string(key) else { return nil }
        guard let value = Int(text) else { fail(.badArgs, "--\(key) needs a whole number, not \(text)") }
        return value
    }

    func double(_ key: String) -> Double {
        let text = required(key)
        guard let value = Double(text), value.isFinite else { fail(.badArgs, "--\(key) needs a number, not \(text)") }
        return value
    }

    /// Every value of a repeatable option, each of which may also be a comma-separated list.
    func ints(_ key: String) -> [Int] {
        (values[key] ?? []).flatMap { $0.split(separator: ",") }.map { part in
            let text = part.trimmingCharacters(in: .whitespaces)
            guard let value = Int(text) else { fail(.badArgs, "--\(key) needs whole numbers, not \(text)") }
            return value
        }
    }
}

// MARK: - Windows

struct WindowInfo {
    let id: CGWindowID
    let pid: pid_t
    let owner: String?
    let title: String?
    let bounds: CGRect
    let onscreen: Bool
    let alpha: Double
    let layer: Int

    var json: JSON {
        .object([
            ("id", .num(id)), ("pid", .num(pid)), ("owner", .str(owner)), ("title", .str(title)),
            ("x", .num(bounds.minX)), ("y", .num(bounds.minY)), ("w", .num(bounds.width)), ("h", .num(bounds.height)),
            ("onscreen", .bool(onscreen)), ("alpha", .number(alpha)),
        ])
    }
}

/// The window server's window list, front to back for the windows on screen. nil when the window
/// server does not answer (a sandboxed process may be refused).
func windowList(onScreenOnly: Bool) -> [WindowInfo]? {
    let options: CGWindowListOption = onScreenOnly ? [.optionOnScreenOnly, .excludeDesktopElements] : [.optionAll, .excludeDesktopElements]
    guard let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]], !raw.isEmpty else { return nil }
    return raw.compactMap { entry in
        guard let number = entry[kCGWindowNumber as String] as? NSNumber,
              let pid = entry[kCGWindowOwnerPID as String] as? NSNumber else { return nil }
        var bounds = CGRect.zero
        if let dict = entry[kCGWindowBounds as String] as? NSDictionary, let rect = CGRect(dictionaryRepresentation: dict as CFDictionary) {
            bounds = rect
        }
        return WindowInfo(
            id: number.uint32Value,
            pid: pid.int32Value,
            owner: entry[kCGWindowOwnerName as String] as? String,
            title: entry[kCGWindowName as String] as? String,
            bounds: bounds,
            onscreen: (entry[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false,
            alpha: (entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1,
            layer: (entry[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        )
    }
}

func allWindows() -> [WindowInfo] {
    guard let list = windowList(onScreenOnly: false) else {
        fail(.failed, "the window server gave no window list (CGWindowListCopyWindowInfo returned nothing). "
            + "A sandboxed shell may be refused access to it: run this outside the sandbox.")
    }
    return list
}

func window(_ id: Int) -> WindowInfo {
    guard let info = allWindows().first(where: { Int($0.id) == id }) else { fail(.notFound, "no window with id \(id)") }
    return info
}

/// The display that holds most of `rect`.
func display(for rect: CGRect) -> CGDirectDisplayID? {
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    guard CGGetDisplaysWithRect(rect, UInt32(ids.count), &ids, &count) == .success, count > 0 else { return nil }
    return ids[0..<Int(count)].max { area(CGDisplayBounds($0).intersection(rect)) < area(CGDisplayBounds($1).intersection(rect)) }
}

/// Pixels per point of a display, from its current display mode.
func scale(of display: CGDirectDisplayID?) -> Double? {
    guard let display, let mode = CGDisplayCopyDisplayMode(display), mode.width > 0 else { return nil }
    return Double(mode.pixelWidth) / Double(mode.width)
}

func area(_ rect: CGRect) -> CGFloat { rect.isNull ? 0 : rect.width * rect.height }

// MARK: - preflight

/// The nearest ancestor process that is an ordinary app (Terminal, an editor, the Claude app):
/// usually the one macOS attributes this tool's screen captures to.
func ancestorApp() -> String? {
    var pid = getppid()
    var seen = 0
    while pid > 1, seen < 64 {
        if let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular {
            return app.localizedName ?? app.bundleURL?.deletingPathExtension().lastPathComponent
        }
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0) == 0, size > 0 else { return nil }
        pid = info.kp_eproc.e_ppid
        seen += 1
    }
    return nil
}

func preflight(_ options: Options) {
    var granted = CGPreflightScreenCaptureAccess()
    var fields: [(String, JSON)] = []
    if options.has("request") {
        granted = CGRequestScreenCaptureAccess() || granted
        fields.append(("requested", .bool(true)))
    }
    fields.insert(("screenCapture", .bool(granted)), at: 0)
    fields.append(("accessibility", .bool(AXIsProcessTrusted())))
    fields.append(("app", .str(ancestorApp())))
    emit(.object(fields))
    if !granted { FileHandle.standardError.write(Data((permissionMessage + "\n").utf8)) }
}

// MARK: - list

func list(_ options: Options) {
    let pids = Set(options.ints("pid").map { pid_t($0) })
    let name = options.string("name")?.lowercased()
    let rows = allWindows().filter { info in
        info.layer == 0
            && (pids.isEmpty || pids.contains(info.pid))
            && (name == nil || (info.owner?.lowercased().contains(name!) ?? false))
    }
    print(rows.isEmpty ? "[]" : "[\n" + rows.map(\.json.text).joined(separator: ",\n") + "\n]")
}

// MARK: - front

func axValue(_ element: AXUIElement, _ attribute: String) -> AXValue? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success,
          let raw, CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    return unsafeDowncast(raw, to: AXValue.self)
}

func axFrame(_ element: AXUIElement) -> CGRect? {
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard let position = axValue(element, kAXPositionAttribute), AXValueGetValue(position, .cgPoint, &origin),
          let extent = axValue(element, kAXSizeAttribute), AXValueGetValue(extent, .cgSize, &size) else { return nil }
    return CGRect(origin: origin, size: size)
}

/// The app's AX window with the same frame as the window server's window `target`, else its main window.
func axWindow(_ app: AXUIElement, matching target: CGRect?) -> AXUIElement? {
    if let target {
        var raw: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &raw) == .success,
           let windows = raw as? [AXUIElement] {
            for candidate in windows {
                guard let frame = axFrame(candidate) else { continue }
                if abs(frame.minX - target.minX) < 1, abs(frame.minY - target.minY) < 1,
                   abs(frame.width - target.width) < 1, abs(frame.height - target.height) < 1 {
                    return candidate
                }
            }
        }
    }
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXMainWindowAttribute as CFString, &raw) == .success,
          let raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    return unsafeDowncast(raw, to: AXUIElement.self)
}

/// Whether the frontmost ordinary window on screen belongs to `pid` (and is `id`, when given).
func isFront(pid: pid_t, id: Int?) -> Bool {
    guard let top = windowList(onScreenOnly: true)?.first(where: { $0.layer == 0 && $0.alpha > 0 }) else { return false }
    return top.pid == pid && (id == nil || Int(top.id) == id)
}

func front(_ options: Options) async {
    guard let pidValue = options.int("pid") else { fail(.badArgs, "--pid is required\n\(usage)") }
    let pid = pid_t(pidValue)
    let id = options.int("id")
    guard let app = NSRunningApplication(processIdentifier: pid) else { fail(.notFound, "no running app with pid \(pid)") }
    let target = id.map { window($0) }
    if let target, target.pid != pid { fail(.badArgs, "window \(target.id) belongs to pid \(target.pid), not \(pid)") }
    if app.isHidden { app.unhide() }
    let activated = app.activate(options: [.activateAllWindows])
    var ax = false
    if AXIsProcessTrusted() {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(element, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        if let win = axWindow(element, matching: target?.bounds) {
            AXUIElementPerformAction(win, kAXRaiseAction as CFString)
        }
        ax = true
    }
    var isNowFront = false
    for _ in 0..<20 {  // up to 2 s for the window server to reorder
        if isFront(pid: pid, id: id) {
            isNowFront = true
            break
        }
        try? await Task.sleep(nanoseconds: 100_000_000)
    }
    emit(.object([("ok", .bool(true)), ("activated", .bool(activated)), ("ax", .bool(ax)), ("front", .bool(isNowFront))]))
}

// MARK: - capture

func requireScreenCapture() {
    if !CGPreflightScreenCaptureAccess() { fail(.noPermission, permissionMessage) }
}

func prepareOutput(_ path: String) -> URL {
    let url = URL(fileURLWithPath: path).standardizedFileURL
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: url)  // never report a stale file as this capture
    return url
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
        throw ToolError("cannot create \(url.path)")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw ToolError("cannot write \(url.path)") }
}

func pngSize(_ url: URL) -> (Int, Int)? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
          let w = props[kCGImagePropertyPixelWidth as String] as? Int,
          let h = props[kCGImagePropertyPixelHeight as String] as? Int else { return nil }
    return (w, h)
}

struct ToolError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

func describe(_ error: Error) -> String {
    if let error = error as? ToolError { return error.description }
    let ns = error as NSError
    return "\(ns.localizedDescription) (\(ns.domain) \(ns.code))"
}

/// Runs /usr/sbin/screencapture; true when it wrote the file.
func screencapture(_ arguments: [String], to url: URL) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = arguments + [url.path]
    do {
        try process.run()
    } catch {
        return false
    }
    process.waitUntilExit()
    return process.terminationStatus == 0 && FileManager.default.fileExists(atPath: url.path)
}

func baseConfiguration() -> SCStreamConfiguration {
    let config = SCStreamConfiguration()
    config.showsCursor = false
    config.captureResolution = .best
    config.colorSpaceName = CGColorSpace.sRGB  // Gecko draws sRGB; read back the CSS colours
    return config
}

func capture(_ options: Options) async {
    guard let id = options.int("id") else { fail(.badArgs, "--id is required\n\(usage)") }
    let out = prepareOutput(options.required("out"))
    let noShadow = options.has("no-shadow")
    requireScreenCapture()
    let info = window(id)
    var note: String?
    if options.has("screencapture") {
        note = "--screencapture"
    } else {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            if let scWindow = content.windows.first(where: { Int($0.windowID) == id }) {
                let filter = SCContentFilter(desktopIndependentWindow: scWindow)
                let scale = CGFloat(filter.pointPixelScale)
                let config = baseConfiguration()
                config.width = Int((filter.contentRect.width * scale).rounded())
                config.height = Int((filter.contentRect.height * scale).rounded())
                config.ignoreShadowsSingleWindow = noShadow
                if #available(macOS 14.2, *) { config.includeChildWindows = options.has("children") }
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
                try writePNG(image, to: out)
                emit(.object([("ok", .bool(true)), ("w", .num(image.width)), ("h", .num(image.height)),
                              ("scale", .number(Double(scale))), ("via", .string("screencapturekit"))]))
                return
            }
            note = "window \(id) is not in ScreenCaptureKit's list"
        } catch {
            note = "ScreenCaptureKit: " + describe(error)
        }
    }
    let args = ["-x"] + (noShadow ? ["-o"] : []) + ["-l\(id)"]
    guard screencapture(args, to: out), let (w, h) = pngSize(out) else {
        fail(.failed, "capture of window \(id) failed" + (note.map { " (\($0)); screencapture failed too" } ?? ""))
    }
    emit(.object([("ok", .bool(true)), ("w", .num(w)), ("h", .num(h)),
                  ("scale", scale(of: display(for: info.bounds)).map { .number($0) } ?? .null),
                  ("via", .string("screencapture")), ("note", .str(note))]))
}

func captureRect(_ options: Options) async {
    let rect = CGRect(x: options.double("x"), y: options.double("y"), width: options.double("w"), height: options.double("h"))
    guard rect.width > 0, rect.height > 0 else { fail(.badArgs, "--w and --h must be greater than 0") }
    let pids = Set(options.ints("pid").map { pid_t($0) })
    let out = prepareOutput(options.required("out"))
    requireScreenCapture()
    var note: String?
    if options.has("screencapture") {
        note = "--screencapture"
    } else {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            let display = content.displays.max { area($0.frame.intersection(rect)) < area($1.frame.intersection(rect)) }
            guard let display, area(display.frame.intersection(rect)) > 0 else {
                fail(.notFound, "the rectangle \(rect) is on no display")
            }
            let filter: SCContentFilter
            if pids.isEmpty {
                filter = SCContentFilter(display: display, excludingWindows: [])
            } else {
                let apps = content.applications.filter { pids.contains($0.processID) }
                guard !apps.isEmpty else { fail(.notFound, "no app with pid \(pids.sorted()) has a window on screen") }
                filter = SCContentFilter(display: display, including: apps, exceptingWindows: [])
            }
            let clipped = display.frame.intersection(rect)
            if clipped != rect { note = "clipped to display \(display.displayID)" }
            let scale = CGFloat(filter.pointPixelScale)
            let config = baseConfiguration()
            config.sourceRect = clipped.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
            config.width = Int((clipped.width * scale).rounded())
            config.height = Int((clipped.height * scale).rounded())
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            try writePNG(image, to: out)
            emit(.object([("ok", .bool(true)), ("w", .num(image.width)), ("h", .num(image.height)),
                          ("scale", .number(Double(scale))), ("display", .num(display.displayID)),
                          ("via", .string("screencapturekit")), ("note", .str(note))]))
            return
        } catch {
            note = "ScreenCaptureKit: " + describe(error)
        }
    }
    let region = [rect.minX, rect.minY, rect.width, rect.height].map { String(format: "%g", Double($0)) }.joined(separator: ",")
    guard screencapture(["-x", "-R\(region)"], to: out), let (w, h) = pngSize(out) else {
        fail(.failed, "capture of \(region) failed" + (note.map { " (\($0)); screencapture failed too" } ?? ""))
    }
    var notes = [note].compactMap { $0 }
    if !pids.isEmpty { notes.append("--pid is ignored by screencapture") }
    let shown = display(for: rect)
    emit(.object([("ok", .bool(true)), ("w", .num(w)), ("h", .num(h)),
                  ("scale", scale(of: shown).map { .number($0) } ?? .null),
                  ("display", shown.map { .num($0) } ?? .null), ("via", .string("screencapture")),
                  ("note", .str(notes.isEmpty ? nil : notes.joined(separator: "; ")))]))
}

// MARK: - main

@main
struct DeerWintool {
    static func main() async {
        var argv = Array(CommandLine.arguments.dropFirst())
        guard !argv.isEmpty else { fail(.badArgs, usage) }
        let command = argv.removeFirst()
        // Never hang the harness: ScreenCaptureKit waits on the window server.
        DispatchQueue.global().asyncAfter(deadline: .now() + 60) {
            fail(.failed, "\(command) timed out after 60 s")
        }
        switch command {
        case "preflight":
            preflight(Options(argv, flags: ["request"]))
        case "list":
            list(Options(argv, values: ["pid", "name"]))
        case "front":
            await front(Options(argv, values: ["pid", "id"]))
        case "capture":
            await capture(Options(argv, values: ["id", "out"], flags: ["no-shadow", "children", "screencapture"]))
        case "capture-rect":
            await captureRect(Options(argv, values: ["x", "y", "w", "h", "out", "pid"], flags: ["screencapture"]))
        case "help", "-h", "--help":
            print(usage)
        default:
            fail(.badArgs, "unknown command \(command)\n\(usage)")
        }
        exit(Exit.ok.rawValue)
    }
}
