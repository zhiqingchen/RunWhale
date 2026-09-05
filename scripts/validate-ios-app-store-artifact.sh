#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 11 ]]; then
  echo "Usage: $0 <stage> <app-path> <bundle-id> <version> <build> <minimum-ios> <team-id> <profile-name> <report-path> <xcode-build> <sdk-name>" >&2
  exit 64
fi

stage=$1
app_path=$2
expected_bundle_id=$3
expected_version=$4
expected_build=$5
expected_minimum_ios=$6
expected_team_id=$7
expected_profile_name=$8
report_path=$9
expected_xcode_build=${10}
expected_sdk_name=${11}

info_plist="$app_path/Info.plist"
embedded_profile="$app_path/embedded.mobileprovision"
validation_temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/runwhale-ios-validation.XXXXXX")
repository_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
generated_runtime_dir="$repository_dir/native/node-host/runtime"
entitlements_plist="$validation_temp/entitlements.plist"
profile_plist="$validation_temp/profile.plist"
signature_metadata="$validation_temp/signature.txt"
vtool_metadata="$validation_temp/vtool.txt"
module_store_root="$validation_temp/module-store"
npm_listing="$validation_temp/npm-archive.list"

cleanup() {
  rm -rf -- "$validation_temp"
}
trap cleanup EXIT

fail() {
  echo "$stage validation failed: $*" >&2
  exit 1
}

plist_value() {
  local plist=$1
  local key=$2
  local type=$3
  plutil -extract "$key" raw -expect "$type" -o - -- "$plist"
}

assert_equal() {
  local label=$1
  local actual=$2
  local expected=$3
  [[ "$actual" == "$expected" ]] || fail "$label is '$actual'; expected '$expected'"
}

[[ -d "$app_path" ]] || fail "app bundle is missing at $app_path"
[[ -f "$info_plist" ]] || fail "Info.plist is missing"
[[ -f "$embedded_profile" ]] || fail "embedded.mobileprovision is missing"

node_mobile_runtime_package_json=$(node -e 'const { createRequire } = require("node:module"); process.stdout.write(createRequire(process.argv[1]).resolve("@runwhale/node-mobile-runtime/package.json"))' "$repository_dir/native/node-host/package.json") || fail 'installed @runwhale/node-mobile-runtime package cannot be resolved'
expected_npm_archive="$(dirname "$node_mobile_runtime_package_json")/runtime/runwhale-npm.tgz"

runtime_assets=(
  runwhale-runtime.mjs
  runwhale-agent-runtime.mjs
  runwhale-task-worker.mjs
  runwhale-package-worker.mjs
  worker.cjs
  runwhale-module-store.tgz
  runwhale-npm.tgz
)
for runtime_asset in "${runtime_assets[@]}"; do
  packaged_runtime_asset="$app_path/$runtime_asset"
  [[ -s "$packaged_runtime_asset" ]] || fail "embedded runtime asset is missing or empty: $runtime_asset"
  expected_runtime_asset="$generated_runtime_dir/$runtime_asset"
  if [[ "$runtime_asset" == runwhale-npm.tgz ]]; then expected_runtime_asset=$expected_npm_archive; fi
  [[ -s "$expected_runtime_asset" ]] || fail "runtime input asset is missing; run pnpm install and pnpm runtime:bundle before archiving: $runtime_asset"
  cmp -s "$expected_runtime_asset" "$packaged_runtime_asset" || fail "packaged runtime asset does not match the current runtime input; rebuild the archive after pnpm install and pnpm runtime:bundle: $runtime_asset"
done

module_store_archive="$app_path/runwhale-module-store.tgz"
module_store_archive_bytes=$(wc -c <"$module_store_archive")
maximum_module_store_archive_bytes=$((96 * 1024 * 1024))
if ((module_store_archive_bytes > maximum_module_store_archive_bytes)); then
  fail "embedded module store archive is $module_store_archive_bytes bytes; limit is $maximum_module_store_archive_bytes bytes (run pnpm runtime:bundle before archiving)"
fi
mkdir -p "$module_store_root"
tar -xzf "$module_store_archive" -C "$module_store_root" || fail 'embedded module store archive is unreadable'
if [[ -e "$module_store_root/node_modules" || -L "$module_store_root/node_modules" ]]; then
  fail 'embedded module store unexpectedly contains a top-level node_modules entry'
fi
ln -s . "$module_store_root/node_modules"
module_store_validation=$(node "$repository_dir/native/node-host/scripts/validate-module-store.mjs" "$module_store_root" 2>&1) || fail "$module_store_validation"
module_store_files=$(sed -n 's/^Validated embedded module store: \([0-9][0-9]*\) files, \([0-9][0-9]*\) bytes$/\1/p' <<<"$module_store_validation")
module_store_bytes=$(sed -n 's/^Validated embedded module store: \([0-9][0-9]*\) files, \([0-9][0-9]*\) bytes$/\2/p' <<<"$module_store_validation")
[[ -n "$module_store_files" && -n "$module_store_bytes" ]] || fail 'embedded module store validator did not report payload metrics'

npm_archive="$app_path/runwhale-npm.tgz"
tar -tzf "$npm_archive" >"$npm_listing" || fail 'embedded npm archive is unreadable'
grep -Eq '^\./package\.json$|^package\.json$' "$npm_listing" || fail 'embedded npm archive is missing package.json'

node_mobile_executable="$app_path/Frameworks/NodeMobile.framework/NodeMobile"
[[ -f "$node_mobile_executable" ]] || fail 'NodeMobile.framework executable is missing'
node_mobile_architectures=$(lipo -archs "$node_mobile_executable")
assert_equal "NodeMobile.framework architectures" "$node_mobile_architectures" arm64
node_mobile_vtool_metadata="$validation_temp/node-mobile-vtool.txt"
xcrun vtool -show-build "$node_mobile_executable" >"$node_mobile_vtool_metadata"
grep -Eq '^[[:space:]]*platform IOS$' "$node_mobile_vtool_metadata" || fail 'NodeMobile.framework does not target the iOS device platform'

bundle_id=$(plist_value "$info_plist" CFBundleIdentifier string)
version=$(plist_value "$info_plist" CFBundleShortVersionString string)
build=$(plist_value "$info_plist" CFBundleVersion string)
minimum_ios=$(plist_value "$info_plist" MinimumOSVersion string)
encryption=$(plist_value "$info_plist" ITSAppUsesNonExemptEncryption bool)
device_family_count=$(plist_value "$info_plist" UIDeviceFamily array)
phone_device_family=$(plist_value "$info_plist" UIDeviceFamily.0 integer)
tablet_device_family=$(plist_value "$info_plist" UIDeviceFamily.1 integer)
executable_name=$(plist_value "$info_plist" CFBundleExecutable string)
xcode_build=$(plist_value "$info_plist" DTXcodeBuild string)
sdk_name=$(plist_value "$info_plist" DTSDKName string)
executable_path="$app_path/$executable_name"

assert_equal "bundle identifier" "$bundle_id" "$expected_bundle_id"
assert_equal "marketing version" "$version" "$expected_version"
assert_equal "build number" "$build" "$expected_build"
assert_equal "minimum iOS version" "$minimum_ios" "$expected_minimum_ios"
assert_equal "ITSAppUsesNonExemptEncryption" "$encryption" false
assert_equal "device family count" "$device_family_count" 2
assert_equal "phone device family" "$phone_device_family" 1
assert_equal "tablet device family" "$tablet_device_family" 2
assert_equal "Xcode build" "$xcode_build" "$expected_xcode_build"
assert_equal "SDK name" "$sdk_name" "$expected_sdk_name"
[[ -f "$executable_path" ]] || fail "main executable is missing at $executable_path"

codesign --verify --deep --strict --verbose=2 "$app_path"
codesign --display --verbose=4 "$app_path" >/dev/null 2>"$signature_metadata"
codesign --display --entitlements :- "$app_path" >"$entitlements_plist" 2>/dev/null
plutil -lint "$entitlements_plist" >/dev/null

signature_team=$(sed -n 's/^TeamIdentifier=//p' "$signature_metadata" | head -n 1)
entitlement_team=$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.team-identifier' "$entitlements_plist")
app_identifier=$(plist_value "$entitlements_plist" application-identifier string)
keychain_group_count=$(plist_value "$entitlements_plist" keychain-access-groups array)
keychain_group=$(plist_value "$entitlements_plist" keychain-access-groups.0 string)
assert_equal "signature team identifier" "$signature_team" "$expected_team_id"
assert_equal "entitlement team identifier" "$entitlement_team" "$expected_team_id"
assert_equal "keychain access group count" "$keychain_group_count" 1
grep -q '^Authority=Apple Distribution' "$signature_metadata" || fail "Apple Distribution signing authority is missing"

security cms -D -i "$embedded_profile" -o "$profile_plist"
profile_name=$(plist_value "$profile_plist" Name string)
profile_uuid=$(plist_value "$profile_plist" UUID string)
profile_team=$(plist_value "$profile_plist" TeamIdentifier.0 string)
profile_prefix=$(plist_value "$profile_plist" ApplicationIdentifierPrefix.0 string)
profile_app_identifier=$(plist_value "$profile_plist" Entitlements.application-identifier string)
profile_get_task_allow=$(plist_value "$profile_plist" Entitlements.get-task-allow bool)
profile_expiration=$(plist_value "$profile_plist" ExpirationDate date)
expected_app_identifier="${profile_prefix%.}.${expected_bundle_id}"
assert_equal "provisioning profile name" "$profile_name" "$expected_profile_name"
assert_equal "provisioning profile team identifier" "$profile_team" "$expected_team_id"
assert_equal "profile application identifier" "$profile_app_identifier" "$expected_app_identifier"
assert_equal "signed application identifier" "$app_identifier" "$profile_app_identifier"
assert_equal "keychain access group" "$keychain_group" "$expected_app_identifier"
assert_equal "profile get-task-allow" "$profile_get_task_allow" false
if plutil -type ProvisionedDevices "$profile_plist" >/dev/null 2>&1; then
  fail 'App Store profile unexpectedly contains ProvisionedDevices'
fi
if plutil -type ProvisionsAllDevices "$profile_plist" >/dev/null 2>&1; then
  fail 'App Store profile unexpectedly contains ProvisionsAllDevices'
fi

architectures=$(lipo -archs "$executable_path")
assert_equal "main executable architectures" "$architectures" arm64
xcrun vtool -show-build "$executable_path" >"$vtool_metadata"
grep -Eq '^[[:space:]]*platform IOS$' "$vtool_metadata" || fail 'main executable does not target the iOS device platform'
grep -Eq "^[[:space:]]*minos $expected_minimum_ios$" "$vtool_metadata" || fail "main executable minimum iOS is not $expected_minimum_ios"
grep -Eq "^[[:space:]]*sdk ${expected_sdk_name#iphoneos}$" "$vtool_metadata" || fail "main executable SDK is not ${expected_sdk_name#iphoneos}"

mach_o_count=0
while IFS= read -r -d '' candidate; do
  candidate_metadata=$(file -b "$candidate")
  if [[ "$candidate_metadata" == *Mach-O* ]]; then
    candidate_architectures=$(lipo -archs "$candidate")
    [[ "$candidate_architectures" == arm64 ]] || fail "device Mach-O has unexpected architectures '$candidate_architectures': $candidate"
    mach_o_count=$((mach_o_count + 1))
  fi
done < <(find "$app_path" -type f -print0)
((mach_o_count > 0)) || fail 'app bundle contains no Mach-O binaries'

executable_sha256=$(shasum -a 256 "$executable_path" | awk '{print $1}')
module_store_sha256=$(shasum -a 256 "$module_store_archive" | awk '{print $1}')
npm_archive_sha256=$(shasum -a 256 "$npm_archive" | awk '{print $1}')
node_mobile_sha256=$(shasum -a 256 "$node_mobile_executable" | awk '{print $1}')

mkdir -p "$(dirname "$report_path")"
{
  printf '## %s validation\n\n' "$stage"
  printf -- '- Bundle identifier: `%s`\n' "$bundle_id"
  printf -- '- Marketing version: `%s`\n' "$version"
  printf -- '- Build number: `%s`\n' "$build"
  printf -- '- Minimum iOS: `%s`\n' "$minimum_ios"
  printf -- '- Xcode / SDK: `%s` / `%s`\n' "$xcode_build" "$sdk_name"
  printf -- '- Architectures: `%s`\n' "$architectures"
  printf -- '- Mach-O files checked: `%s`\n' "$mach_o_count"
  printf -- '- Signing team: `%s`\n' "$signature_team"
  printf -- '- Provisioning profile: `%s` (`%s`, expires `%s`)\n' "$profile_name" "$profile_uuid" "$profile_expiration"
  printf -- '- Keychain group: `%s`\n' "$keychain_group"
  printf -- '- `ITSAppUsesNonExemptEncryption`: Boolean `false`\n'
  printf -- '- Device families: iPhone and iPad (`1, 2`)\n'
  printf -- '- Embedded module store: `%s` bytes compressed, `%s` files / `%s` bytes expanded\n' "$module_store_archive_bytes" "$module_store_files" "$module_store_bytes"
  printf -- '- Embedded module store SHA-256: `%s`\n' "$module_store_sha256"
  printf -- '- Embedded npm SHA-256: `%s`\n' "$npm_archive_sha256"
  printf -- '- NodeMobile SHA-256: `%s`\n' "$node_mobile_sha256"
  printf -- '- Executable SHA-256: `%s`\n' "$executable_sha256"
} >"$report_path"

echo "$stage artifact validation passed"
