// deer-icon: draws Deer's macOS app icon as an .iconset folder, which iconutil turns into deer.icns.
// The picture is the Default appearance of the "Deer app icon" design board (AppIcon) on Apple's
// macOS grid:
//
//   1024 x 1024 canvas; an 824 px plate (80.5 %, 100 px inset) with continuous corners of 22.37 %
//   (SwiftUI's RoundedRectangle(style: .continuous), Apple's own corner curve); the plate filled with
//   the charcoal gradient #2a2622 (top) to #121214 (bottom); the gold deer artwork filling the plate,
//   cropped by its edge; the board's drop shadow under the plate (0 10px 22px rgba(0,0,0,.30) and
//   0 1px 3px rgba(0,0,0,.22) at 256 px, so x4 here; a CoreGraphics shadow blur equals a CSS blur).
//
// The artwork is drawn on its own plate (a rounded square with transparent corners). That plate is
// found from the alpha channel and scaled so its corners cover the continuous corners of the 824 px
// plate (CORNER_SLACK px to spare); only the dark rim of the art's plate is cut. The 16 pt
// representations use the simplified artwork (--small-art), as tools/make-icon.py does for the Windows
// icon's 16 to 24 px images. Each size is drawn from the artwork, not reduced from the 1024 px picture.
//
// Swift 6, macOS 11 or later, Apple frameworks only. tools/mac/appicon.py builds it on first use
// (xcrun swiftc -O) into tools/mac/bin/deer-icon, which git ignores, and rebuilds it when this file is
// newer. Run it through appicon.py:  python3 tools/mac/appicon.py
//
//   deer-icon --art FILE.png --small-art FILE.png --out DIR.iconset
//       Writes icon_16x16.png ... icon_512x512@2x.png (Display P3, 8 bits, alpha) into DIR, which must
//       exist. Prints one JSON line: {"ok": true, "files": N, "artScale": S, "smallArtScale": S}.
// Exit codes: 0 ok, 1 failed, 2 bad arguments.

import CoreGraphics
import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

let CANVAS: CGFloat = 1024
let PLATE: CGFloat = 824
let CORNER: CGFloat = 0.2237           // of the plate; continuous
let PLATE_TOP = (r: 0x2a, g: 0x26, b: 0x22)
let PLATE_BOTTOM = (r: 0x12, g: 0x12, b: 0x14)
// (y offset downwards, blur, opacity) on the 1024 grid
let SHADOWS: [(dy: CGFloat, blur: CGFloat, alpha: CGFloat)] = [(40, 88, 0.30), (4, 12, 0.22)]
let CORNER_SLACK: CGFloat = 4          // px on the 1024 grid by which the art's corners overlap the plate's
let SMALL_MAX_POINTS = 24              // point sizes up to this use --small-art

// (file name, point size, scale)
let REPRESENTATIONS: [(String, Int, Int)] = [
    ("icon_16x16.png", 16, 1), ("icon_16x16@2x.png", 16, 2),
    ("icon_32x32.png", 32, 1), ("icon_32x32@2x.png", 32, 2),
    ("icon_128x128.png", 128, 1), ("icon_128x128@2x.png", 128, 2),
    ("icon_256x256.png", 256, 1), ("icon_256x256@2x.png", 256, 2),
    ("icon_512x512.png", 512, 1), ("icon_512x512@2x.png", 512, 2),
]

struct Failure: Error {
    let code: Int32
    let message: String
}

/// An artwork and where its own plate sits in it (pixels, top-down).
struct Art {
    let image: CGImage
    let centerX: CGFloat
    let centerY: CGFloat
    let scale: CGFloat   // art pixels -> 1024-grid pixels

    init(path: String, plateCornerInset: CGFloat) throws {
        let url = URL(fileURLWithPath: path) as CFURL
        guard let src = CGImageSourceCreateWithURL(url, nil),
              let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            throw Failure(code: 1, message: "cannot read the image \(path)")
        }
        let w = image.width, h = image.height
        guard w > 0, h > 0, let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let data = ctx.data else {
            throw Failure(code: 1, message: "cannot read the pixels of \(path)")
        }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        let px = data.assumingMemoryBound(to: UInt8.self)
        // alpha at (x, y), y from the top (the context's memory is top row first)
        func opaque(_ x: Int, _ y: Int) -> Bool { px[(y * w + x) * 4 + 3] >= 128 }
        let midX = w / 2, midY = h / 2
        guard let left = (0..<w).first(where: { opaque($0, midY) }),
              let right = (0..<w).last(where: { opaque($0, midY) }),
              let top = (0..<h).first(where: { opaque(midX, $0) }),
              let bottom = (0..<h).last(where: { opaque(midX, $0) }) else {
            throw Failure(code: 1, message: "\(path): no opaque plate across the middle of the picture")
        }
        let diagonal = (0..<min(w, h)).first(where: { opaque(left + $0, top + $0) }) ?? 0
        let plate = CGFloat((right + 1 - left) + (bottom + 1 - top)) / 2
        // The art's plate corner, on the diagonal, must reach CORNER_SLACK px past the 824 px plate's:
        //   s * diagonal - (s * plate - PLATE) / 2  <=  plateCornerInset - CORNER_SLACK
        let room = plate / 2 - CGFloat(diagonal)
        guard room > 0 else { throw Failure(code: 1, message: "\(path): the plate's corners could not be measured") }
        let cover = (PLATE / 2 - (plateCornerInset - CORNER_SLACK)) / room
        self.image = image
        self.centerX = CGFloat(left + right + 1) / 2
        self.centerY = CGFloat(top + bottom + 1) / 2
        self.scale = max(cover, PLATE / plate)
    }
}

@MainActor
func platePath(_ rect: CGRect) -> CGPath {
    RoundedRectangle(cornerRadius: CORNER * rect.width, style: .continuous).path(in: rect).cgPath
}

/// How far the plate's corner curve is from the plate's corner along the diagonal (1024 grid).
@MainActor
func plateCornerInset() -> CGFloat {
    let path = platePath(CGRect(x: 0, y: 0, width: PLATE, height: PLATE))
    var lo: CGFloat = 0, hi = PLATE / 2
    for _ in 0..<40 {
        let mid = (lo + hi) / 2
        if path.contains(CGPoint(x: mid, y: mid)) { hi = mid } else { lo = mid }
    }
    return hi
}

func srgb(_ c: (r: Int, g: Int, b: Int), _ alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
            components: [CGFloat(c.r) / 255, CGFloat(c.g) / 255, CGFloat(c.b) / 255, alpha])!
}

@MainActor
func render(size: Int, art: Art) throws -> CGImage {
    let k = CGFloat(size) / CANVAS
    guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.displayP3)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw Failure(code: 1, message: "cannot make a \(size) px drawing context")
    }
    ctx.interpolationQuality = .high
    ctx.setShouldAntialias(true)
    // CoreGraphics: origin at the bottom left, y upwards; shadow offsets are in that space too.
    let inset = (CANVAS - PLATE) / 2 * k
    let rect = CGRect(x: inset, y: inset, width: PLATE * k, height: PLATE * k)
    let path = platePath(rect)

    // The shadows, each cast by the plate's shape filled with its darkest colour (the plate is drawn
    // over it, so only the shadow and a dark antialiased rim of it remain).
    for s in SHADOWS {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -s.dy * k), blur: s.blur * k, color: CGColor(gray: 0, alpha: s.alpha))
        ctx.addPath(path)
        ctx.setFillColor(srgb(PLATE_BOTTOM))
        ctx.fillPath()
        ctx.restoreGState()
    }

    ctx.saveGState()
    ctx.addPath(path)
    ctx.clip()
    let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                              colors: [srgb(PLATE_TOP), srgb(PLATE_BOTTOM)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: rect.maxY), end: CGPoint(x: 0, y: rect.minY), options: [])
    // The art's plate centre on the canvas centre; art pixel (x, y) (top-down) lands at
    // (minX + x * s, maxY - y * s).
    let s = art.scale * k
    let w = CGFloat(art.image.width) * s, h = CGFloat(art.image.height) * s
    let minX = CGFloat(size) / 2 - art.centerX * s
    let maxY = CGFloat(size) / 2 + art.centerY * s
    ctx.draw(art.image, in: CGRect(x: minX, y: maxY - h, width: w, height: h))
    ctx.restoreGState()

    guard let image = ctx.makeImage() else { throw Failure(code: 1, message: "cannot finish the \(size) px picture") }
    return image
}

func writePNG(_ image: CGImage, to path: String) throws {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else {
        throw Failure(code: 1, message: "cannot write \(path)")
    }
    CGImageDestinationAddImage(dest, image, nil)
    if !CGImageDestinationFinalize(dest) { throw Failure(code: 1, message: "cannot write \(path)") }
}

@main
enum DeerIcon {
    @MainActor
    static func main() {
        do {
            try run(Array(CommandLine.arguments.dropFirst()))
        } catch let f as Failure {
            FileHandle.standardError.write((f.message + "\n").data(using: .utf8)!)
            exit(f.code)
        } catch {
            FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
            exit(1)
        }
    }

    @MainActor
    static func run(_ args: [String]) throws {
        var options: [String: String] = [:]
        var i = 0
        while i < args.count {
            let name = args[i]
            guard ["--art", "--small-art", "--out"].contains(name), i + 1 < args.count else {
                throw Failure(code: 2, message: "usage: deer-icon --art FILE.png --small-art FILE.png --out DIR.iconset")
            }
            options[name] = args[i + 1]
            i += 2
        }
        guard let artPath = options["--art"], let smallPath = options["--small-art"], let out = options["--out"] else {
            throw Failure(code: 2, message: "usage: deer-icon --art FILE.png --small-art FILE.png --out DIR.iconset")
        }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: out, isDirectory: &isDir), isDir.boolValue else {
            throw Failure(code: 2, message: "\(out) is not a folder")
        }
        let corner = plateCornerInset()
        let art = try Art(path: artPath, plateCornerInset: corner)
        let small = try Art(path: smallPath, plateCornerInset: corner)
        for (name, points, scale) in REPRESENTATIONS {
            let image = try render(size: points * scale, art: points <= SMALL_MAX_POINTS ? small : art)
            try writePNG(image, to: (out as NSString).appendingPathComponent(name))
        }
        print(String(format: "{\"ok\": true, \"files\": %d, \"artScale\": %.4f, \"smallArtScale\": %.4f}",
                     REPRESENTATIONS.count, Double(art.scale), Double(small.scale)))
    }
}
