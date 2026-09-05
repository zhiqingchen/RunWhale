#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$REPOSITORY_DIR/apps/mobile/ios"
NODE_HOST_PACKAGE="$REPOSITORY_DIR/native/node-host/package.json"
PODFILE_LOCK="$IOS_DIR/Podfile.lock"
PODS_MANIFEST="$IOS_DIR/Pods/Manifest.lock"
if [[ "${1:-}" == "--" ]]; then
  shift
fi
SIMULATOR_ID="${1:-${RUNWHALE_IOS_SIMULATOR_ID:-}}"
DERIVED_DATA_DIR="${RUNWHALE_IOS_SIMULATOR_DERIVED_DATA:-$IOS_DIR/build/agent-derived-data}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The iOS Simulator development client requires macOS and Xcode" >&2
  exit 1
fi

if [[ ! -d "$IOS_DIR/RunWhale.xcworkspace" ]]; then
  echo "Generate the iOS project first with: pnpm --filter @runwhale/mobile exec expo prebuild" >&2
  exit 1
fi

expected_node_host_version="$(node -p "require(process.argv[1]).version" "$NODE_HOST_PACKAGE")"
locked_node_host_version=""
if [[ -f "$PODFILE_LOCK" ]]; then
  locked_node_host_version="$(sed -n 's/^  - RunWhaleNodeHost (\([^)]*\)):.*/\1/p' "$PODFILE_LOCK" | head -n 1)"
fi
if [[ ! -f "$PODFILE_LOCK" || ! -f "$PODS_MANIFEST" || "$locked_node_host_version" != "$expected_node_host_version" ]] || ! cmp -s "$PODFILE_LOCK" "$PODS_MANIFEST"; then
  echo "Synchronizing iOS Pods (RunWhaleNodeHost ${locked_node_host_version:-missing} -> $expected_node_host_version)"
  (cd "$IOS_DIR" && pod install)
fi

locked_node_host_version="$(sed -n 's/^  - RunWhaleNodeHost (\([^)]*\)):.*/\1/p' "$PODFILE_LOCK" 2>/dev/null | head -n 1)"
if [[ "$locked_node_host_version" != "$expected_node_host_version" ]] || ! cmp -s "$PODFILE_LOCK" "$PODS_MANIFEST"; then
  echo "iOS Pods are not synchronized with RunWhaleNodeHost $expected_node_host_version" >&2
  exit 1
fi

if [[ -z "$SIMULATOR_ID" ]]; then
  SIMULATOR_ID="$(xcrun simctl list devices booted --json | node -e '
    let input = ""
    process.stdin.on("data", (chunk) => { input += chunk })
    process.stdin.on("end", () => {
      const devices = Object.values(JSON.parse(input).devices).flat()
      process.stdout.write(devices.find((device) => device.state === "Booted" && device.isAvailable)?.udid ?? "")
    })
  ')"
fi

if [[ -z "$SIMULATOR_ID" ]]; then
  echo "Boot an iOS Simulator or pass its UDID as the first argument" >&2
  exit 1
fi

xcodebuild -quiet \
  -workspace "$IOS_DIR/RunWhale.xcworkspace" \
  -scheme RunWhale \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  build

APP_PATH="$DERIVED_DATA_DIR/Build/Products/Debug-iphonesimulator/RunWhale.app"
SIGNING_INFO="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)"

if [[ "$SIGNING_INFO" != *"Identifier=app.runwhale.mobile"* || "$SIGNING_INFO" == *"linker-signed"* ]]; then
  echo "Refusing to install an improperly signed RunWhale Simulator app" >&2
  exit 1
fi

codesign --verify --strict "$APP_PATH"
xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"
xcrun simctl launch "$SIMULATOR_ID" app.runwhale.mobile
