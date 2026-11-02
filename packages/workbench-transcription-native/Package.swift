// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "WorkbenchTranscriptionNative",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "WorkbenchTranscriptionCore", targets: ["WorkbenchTranscriptionCore"]),
        .executable(name: "workbench-transcribe", targets: ["WorkbenchTranscribe"]),
    ],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.7"),
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.3.0"),
    ],
    targets: [
        .target(
            name: "WorkbenchTranscriptionCore",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        ),
        .executableTarget(
            name: "WorkbenchTranscribe",
            dependencies: [
                "WorkbenchTranscriptionCore",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ]
        ),
    ]
)
