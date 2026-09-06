#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIMULATOR_ID="${1:-booted}"
FRAMEWORK_DIR="$REPOSITORY_DIR/native/node-host/node_modules/@runwhale/node-mobile-runtime/apple/NodeMobile.xcframework/ios-arm64_x86_64-simulator"
TEST_DIR="$REPOSITORY_DIR/native/node-host/test/ios-node-stack"
SDK_PATH="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)"
mkdir -p "$REPOSITORY_DIR/build"
AUDIT_DIR="$(mktemp -d "$REPOSITORY_DIR/build/ios-node-stack.XXXXXX")"
trap 'rm -rf "$AUDIT_DIR"' EXIT

# Sign a disposable copy; never alter the pinned runtime package.
cp -R "$FRAMEWORK_DIR/NodeMobile.framework" "$AUDIT_DIR/NodeMobile.framework"
codesign --force --sign - "$AUDIT_DIR/NodeMobile.framework"
xcrun --sdk iphonesimulator swiftc \
  -sdk "$SDK_PATH" -target "$ARCH-apple-ios16.4-simulator" \
  -F "$AUDIT_DIR" -framework NodeMobile \
  -Xlinker -rpath -Xlinker @executable_path \
  "$REPOSITORY_DIR/native/node-host/ios/NodeRuntimeThread.swift" \
  "$TEST_DIR/main.swift" -o "$AUDIT_DIR/node-stack-test"
xcrun simctl spawn "$SIMULATOR_ID" "$AUDIT_DIR/node-stack-test" "$TEST_DIR/stack.cjs"
