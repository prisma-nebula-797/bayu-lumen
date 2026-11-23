// Draws the PhoneBox app icon (the Android launcher icon's monitor, bars and dot on a rounded dark tile, the shape macOS
// expects: an 824 px tile centred in a 1024 px canvas) and writes packaging/macos/PhoneBox.icns. A Mac is needed for
// iconutil; the .icns is committed, so builds do not run this. Re-run it only when the artwork changes:
//
//   swift tools/make-macos-icon.swift            # from the repository root
//
// The geometry is android/app/src/main/res/drawable/ic_launcher_fg.xml (viewport 18..90, its safe zone) and the
// background colour is ic_bg in android/app/src/main/res/values/themes.xml.
import AppKit
import ImageIO
import UniformTypeIdentifiers

func hex(_ value: UInt32) -> CGColor {
    CGColor(srgbRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
}

func render(pixels: Int) -> CGImage {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setAllowsAntialiasing(true)
    ctx.interpolationQuality = .high
    // work in a 1024 x 1024 canvas with the origin at the top left, like the SVG the artwork came from
    ctx.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
    ctx.translateBy(x: 0, y: 1024)
    ctx.scaleBy(x: 1, y: -1)

    ctx.setFillColor(hex(0x0F1318))
    ctx.addPath(CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 185, cornerHeight: 185, transform: nil))
    ctx.fillPath()

    // the launcher icon's artwork: its 72 x 72 safe zone (18..90) fills the tile
    ctx.translateBy(x: 100, y: 100)
    ctx.scaleBy(x: 824.0 / 72, y: 824.0 / 72)
    ctx.translateBy(x: -18, y: -18)

    ctx.setStrokeColor(hex(0xE8ECF1))
    ctx.setLineWidth(3)
    ctx.addPath(CGPath(roundedRect: CGRect(x: 30, y: 36, width: 48, height: 32), cornerWidth: 5, cornerHeight: 5, transform: nil))
    ctx.strokePath()

    for (color, rect) in [(0x2DD4BF, CGRect(x: 38, y: 55, width: 5, height: 6)),
                          (0x76B900, CGRect(x: 46, y: 48, width: 5, height: 13)),
                          (0xA78BFA, CGRect(x: 54, y: 52, width: 5, height: 9))] as [(UInt32, CGRect)] {
        ctx.setFillColor(hex(color))
        ctx.fill(rect)
    }
    ctx.setFillColor(hex(0xF59E0B))
    ctx.fillEllipse(in: CGRect(x: 64, y: 43, width: 8, height: 8))
    ctx.setFillColor(hex(0xE8ECF1))
    ctx.fill(CGRect(x: 51, y: 68, width: 6, height: 5))
    ctx.fill(CGRect(x: 43, y: 73, width: 22, height: 3))
    return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to path: String) {
    let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("could not write \(path)") }
}

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "packaging/macos/PhoneBox.icns"
let iconset = NSTemporaryDirectory() + "PhoneBox-\(ProcessInfo.processInfo.processIdentifier).iconset"
try FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)
for (name, pixels) in [("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
                       ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
                       ("icon_512x512", 512), ("icon_512x512@2x", 1024)] {
    writePNG(render(pixels: pixels), to: "\(iconset)/\(name).png")
}
let tool = Process()
tool.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
tool.arguments = ["-c", "icns", iconset, "-o", out]
try tool.run()
tool.waitUntilExit()
try? FileManager.default.removeItem(atPath: iconset)
guard tool.terminationStatus == 0 else { fatalError("iconutil failed") }
print("wrote \(out)")
