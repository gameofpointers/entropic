#!/usr/bin/env swift
import CoreGraphics
import Foundation
import ImageIO

struct IconOutput {
    let size: Int
    let relativePath: String
}

let cornerRadiusRatio: CGFloat = 0.22
let pngType = "public.png" as CFString

func ensureParentDirectory(for path: URL) throws {
    let parent = path.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
}

func loadImage(from url: URL) throws -> CGImage {
    guard
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        throw NSError(
            domain: "icons",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Failed to decode image at \(url.path)"]
        )
    }
    return image
}

func roundedImage(baseImage: CGImage, size: Int) throws -> CGImage {
    guard let context = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw NSError(domain: "icons", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to create graphics context"])
    }

    context.interpolationQuality = .high
    let rect = CGRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size))
    let radius = CGFloat(size) * cornerRadiusRatio
    let clipPath = CGPath(
        roundedRect: rect,
        cornerWidth: radius,
        cornerHeight: radius,
        transform: nil
    )
    context.addPath(clipPath)
    context.clip()
    context.draw(baseImage, in: rect)

    guard let output = context.makeImage() else {
        throw NSError(domain: "icons", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to render output image"])
    }
    return output
}

func writePng(image: CGImage, to url: URL) throws {
    try ensureParentDirectory(for: url)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, pngType, 1, nil) else {
        throw NSError(domain: "icons", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to create image destination"])
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw NSError(domain: "icons", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to write PNG output"])
    }
}

func writeRounded(baseImage: CGImage, size: Int, to output: URL) throws {
    let image = try roundedImage(baseImage: baseImage, size: size)
    try writePng(image: image, to: output)
}

func runCommand(_ command: String, _ args: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: command)
    process.arguments = args
    try process.run()
    process.waitUntilExit()
    if process.terminationStatus != 0 {
        throw NSError(
            domain: "icons",
            code: Int(process.terminationStatus),
            userInfo: [NSLocalizedDescriptionKey: "Command failed: \(command) \(args.joined(separator: " "))"]
        )
    }
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
let source = root.appendingPathComponent("src/assets/entropic-logo.png")

do {
    let baseImage = try loadImage(from: source)
    let outputs: [IconOutput] = [
        IconOutput(size: 32, relativePath: "src-tauri/icons/32x32.png"),
        IconOutput(size: 128, relativePath: "src-tauri/icons/128x128.png"),
        IconOutput(size: 256, relativePath: "src-tauri/icons/128x128@2x.png"),
        IconOutput(size: 512, relativePath: "src-tauri/icons/icon.png"),
    ]

    for output in outputs {
        let destination = root.appendingPathComponent(output.relativePath)
        try writeRounded(baseImage: baseImage, size: output.size, to: destination)
        print("Updated \(output.relativePath)")
    }

    let iconsetDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        .appendingPathComponent("entropic-rounded-\(UUID().uuidString).iconset", isDirectory: true)
    try FileManager.default.createDirectory(at: iconsetDir, withIntermediateDirectories: true)

    let iconsetEntries: [(Int, String)] = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]

    for (size, name) in iconsetEntries {
        let output = iconsetDir.appendingPathComponent(name)
        try writeRounded(baseImage: baseImage, size: size, to: output)
    }

    let icnsPath = root.appendingPathComponent("src-tauri/icons/icon.icns")
    do {
        try runCommand("/usr/bin/iconutil", ["-c", "icns", iconsetDir.path, "-o", icnsPath.path])
        print("Updated src-tauri/icons/icon.icns")
    } catch {
        fputs("Warning: failed to regenerate icon.icns (\(error)). Keeping existing icon.icns.\n", stderr)
    }
    try? FileManager.default.removeItem(at: iconsetDir)

    print("Rounded icon generation complete.")
} catch {
    fputs("Icon generation failed: \(error)\n", stderr)
    exit(1)
}
