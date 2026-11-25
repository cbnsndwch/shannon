/**
 * Badge drawing for the macOS desktop launcher. The badge is drawn by a tiny
 * Swift/AppKit program compiled once with `swiftc` (Xcode Command Line Tools)
 * into the cache directory, so Shannon itself carries no image code and no
 * dependency. When `swiftc` is missing the launcher keeps the stock icon.
 */

/** Default badge colour (`clpd app <profile>` without `--color`). */
export const DEFAULT_COLOR = '#d97757';

export const BADGE_SWIFT = `import AppKit
let a = CommandLine.arguments
let src = a[1], label = a[2], out = a[3]
let rgb = a[4].split(separator: ",").map { CGFloat(Double($0)!) }
let trgb = a[5].split(separator: ",").map { CGFloat(Double($0)!) }
guard let base = NSImage(contentsOfFile: src) else { fatalError("cannot load \\(src)") }
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
base.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .sourceOver, fraction: 1)
let badge = NSRect(x: 112, y: 96, width: 800, height: 250)
let path = NSBezierPath(roundedRect: badge, xRadius: 70, yRadius: 70)
NSColor(calibratedRed: rgb[0], green: rgb[1], blue: rgb[2], alpha: 1).setFill(); path.fill()
NSColor.white.withAlphaComponent(0.9).setStroke(); path.lineWidth = 10; path.stroke()
let style = NSMutableParagraphStyle(); style.alignment = .center
var fontSize: CGFloat = 190
if label.count > 3 { fontSize = max(90, 190 * 3 / CGFloat(label.count)) }
let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: fontSize, weight: .heavy),
  .foregroundColor: NSColor(calibratedRed: trgb[0], green: trgb[1], blue: trgb[2], alpha: 1), .paragraphStyle: style ]
let str = NSAttributedString(string: label, attributes: attrs)
let h = str.size().height
str.draw(in: NSRect(x: badge.minX, y: badge.midY - h/2, width: badge.width, height: h))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
`;

/** Normalise `#rrggbb` / `rrggbb` to lower-case `#rrggbb`, or null if invalid. */
export function normalizeColor(value: string): string | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    return m ? `#${m[1].toLowerCase()}` : null;
}

/** `#rrggbb` → `[r, g, b]` in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace(/^#/, '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number
    ];
}

/** White text on dark badges, near-black on light ones. */
export function textRgb(
    rgb: [number, number, number]
): [number, number, number] {
    const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    return luminance > 0.6 ? [0.11, 0.1, 0.09] : [1, 1, 1];
}

/** The badge tool's colour argument: `r,g,b` with four decimals. */
export function rgbArg(rgb: [number, number, number]): string {
    return rgb.map(c => c.toFixed(4)).join(',');
}

/** Sizes of an `.iconset` (each also at @2x). */
export const ICONSET_SIZES = [16, 32, 128, 256, 512] as const;
