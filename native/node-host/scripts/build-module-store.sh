#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_DIR="$(cd "$MODULE_DIR/../.." && pwd)"
STAGE_DIR="$(mktemp -d "$MODULE_DIR/.runwhale-module-store.XXXXXX")"
MODULES_STATE="$REPOSITORY_DIR/node_modules/.modules.yaml"
MODULES_BACKUP="$STAGE_DIR/root-modules.yaml"
if [[ -f "$MODULES_STATE" ]]; then cp "$MODULES_STATE" "$MODULES_BACKUP"; fi
cleanup() {
  if [[ -f "$MODULES_BACKUP" ]]; then cp "$MODULES_BACKUP" "$MODULES_STATE"; fi
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

cd "$REPOSITORY_DIR"
pnpm --config.node-linker=hoisted --config.inject-workspace-packages=true --filter @runwhale/runtime-module-store deploy --prod --frozen-lockfile "$STAGE_DIR/deploy"
if [[ -f "$MODULES_BACKUP" ]]; then cp "$MODULES_BACKUP" "$MODULES_STATE"; fi
MODULE_STORE="$STAGE_DIR/deploy/node_modules"
test -f "$MODULE_STORE/expo/package.json"
WORKSPACE_LINK="$MODULE_STORE/.pnpm/node_modules/@runwhale/runtime-module-store"
if [[ -L "$WORKSPACE_LINK" ]]; then unlink "$WORKSPACE_LINK"; fi
node "$SCRIPT_DIR/precompile-mobile-flow.mjs" "$MODULE_STORE"
# Native frameworks, build tools, and compiler inputs are consumed while the
# app itself is built. Embedded Metro only needs package JavaScript and assets;
# shipping these payloads made first launch expand hundreds of megabytes in the
# app process before the runtime could publish host.json.
find "$MODULE_STORE" -type d \( -name prebuilds -o -name local-maven-repo \) -prune -exec rm -rf -- {} +
find "$MODULE_STORE" -type f -name '*.map' -delete
rm -rf -- \
  "$MODULE_STORE/hermes-compiler/hermesc" \
  "$MODULE_STORE/@expo/expo-modules-macros-plugin/apple" \
  "$MODULE_STORE/@shopify/react-native-skia/android" \
  "$MODULE_STORE/@shopify/react-native-skia/apple" \
  "$MODULE_STORE/@shopify/react-native-skia/cpp" \
  "$MODULE_STORE/@shopify/react-native-skia/libs" \
  "$MODULE_STORE/react-native-skia-android" \
  "$MODULE_STORE/react-native-skia-apple-ios" \
  "$MODULE_STORE/react-native-skia-apple-macos" \
  "$MODULE_STORE/react-native-skia-apple-tvos"
node "$SCRIPT_DIR/validate-module-store.mjs" "$MODULE_STORE"
RUNWHALE_TEST_MODULE_STORE="$MODULE_STORE" pnpm --filter @runwhale/node-runtime exec vitest run test/module-store.test.ts test/project-template.test.ts
rm -rf -- "$MODULE_STORE/.cache/runwhale"
COPYFILE_DISABLE=1 tar -czf "$STAGE_DIR/runwhale-module-store.tgz" -C "$MODULE_STORE" .
ARCHIVE_BYTES=$(wc -c <"$STAGE_DIR/runwhale-module-store.tgz")
MAX_ARCHIVE_BYTES=$((96 * 1024 * 1024))
if (( ARCHIVE_BYTES > MAX_ARCHIVE_BYTES )); then
  echo "Embedded module store is too large: $ARCHIVE_BYTES bytes (limit: $MAX_ARCHIVE_BYTES)" >&2
  exit 1
fi
mkdir -p "$MODULE_DIR/runtime"
mv "$STAGE_DIR/runwhale-module-store.tgz" "$MODULE_DIR/runtime/runwhale-module-store.tgz"
du -h "$MODULE_DIR/runtime/runwhale-module-store.tgz"
