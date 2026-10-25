// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-screen-guard",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-screen-guard",
      type: .static,
      targets: ["tauri-plugin-screen-guard"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-screen-guard",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
