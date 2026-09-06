# Development

RunWhale executes user projects on the phone, but developing RunWhale requires standard desktop Android or iOS tools.

## Prerequisites and Install

Use Node.js `24.19.0` and the pnpm version pinned in `package.json` through Corepack:

```sh
nvm install 24.19.0
nvm use 24.19.0
corepack enable
pnpm install
```

Install the platform toolchain needed for your change. `pnpm install` provides the native Node runtime through the standalone `@runwhale/node-mobile-runtime` package.

## Embedded JavaScript Runtime

Rebuild the embedded runtime and shared dependency store after changing the Node entry point, Agent host, dependency store, Metro server, or mobile runtime bundle:

```sh
pnpm runtime:bundle
```

## Studio and Development Clients

Generate the native projects and launch a development client:

```sh
pnpm --filter @runwhale/mobile exec expo prebuild
pnpm mobile:android
# or
pnpm mobile:ios
```

Rebuild only for native-host, embedded-runtime, or Native Preview changes. For Studio UI work, reuse the installed client with Fast Refresh:

```sh
pnpm mobile                 # port 8081
pnpm mobile:metro:alt       # port 8082 when 8081 is occupied
adb reverse tcp:8081 tcp:8081
```

Computer Metro serves Studio only. User-project Preview remains on the embedded, token-protected phone Metro server.

Agent Preview testing uses `preview_logs`, `preview_inspect`, `preview_screenshot`, and `preview_action`. Keep the current Preview visible while testing. Actions require a fresh node snapshot and follow the session permission mode. Native actions dispatch app view events; they do not validate OS gestures or system dialogs. Screenshots cover the Preview content area and require a vision-capable model for visual verification. Rebuild Preview to add console capture to older cached native bundles.

## iOS Simulator Workflow

Use the iOS Simulator for routine iOS validation. Use a physical iPhone only when explicitly requested or when the behavior requires device hardware.

Keep Metro running, boot the target Simulator, and reuse the native build cache:

```sh
pnpm mobile:ios:simulator
# or select an exact target
pnpm mobile:ios:simulator -- <SIMULATOR_UDID>
```

The installer rejects an invalid code identity. Do not disable signing for Keychain or Git SSH validation.

## Native Node Runtime

The standalone `@runwhale/node-mobile-runtime` package supplies the prebuilt Android arm64 runtime, iPhone arm64 runtime, iOS Simulator arm64/x86_64 runtime, headers, and bundled npm archive. Run `pnpm install` after changing its pinned version; RunWhale's native host consumes those package artifacts directly.

Android host builds still require Android NDK `27.2.12479018` (r27c) to compile the JNI bridge. The application repository does not build Node.js from a source checkout.

## Feedback Loops

| Change type | First validation loop |
| --- | --- |
| Documentation | Links and final diff |
| Studio UI | Computer Metro, Fast Refresh, and the smallest focused test or typecheck |
| Embedded runtime | `pnpm runtime:bundle` and focused runtime tests |
| Native host or Native Preview | Relevant native rebuild and one representative device per affected platform |

Widen the loop only when a change crosses another boundary or a focused check fails. Run `pnpm check` once before submitting a cohesive source change.

Run `pnpm secrets:check` before publishing source. It checks non-ignored untracked files, tracked working files, the Git index, and all locally reachable commits for common credential formats and private-key headers. Findings show only file locations, never source lines or secret values. A shallow clone must first fetch full history with `git fetch --unshallow`; CI uses a full checkout. This pattern check does not replace a broader secret audit of release binaries or external artifacts. Keep Apple `.p8` keys and other signing material outside the repository even though their extensions are ignored.

## Mobile Release Automation

Full native app builds are release or operator actions, not part of pull request and `main` CI. Use the **Native Build** GitHub Actions workflow when an Android debug APK, an iOS Simulator app, or both are needed for native-host validation.

Production mobile releases use one immutable `vX.Y.Z` tag for both platforms:

1. Update `expo.version` in `apps/mobile/app.json` to the numeric `X.Y.Z` version and merge it to `main`.
2. Create and push `vX.Y.Z` at that `main` commit. Prerelease suffixes and tags outside `main` are rejected.
3. The Android workflow publishes the signed APK to the matching GitHub Release. The independent iOS workflow signs and uploads an IPA to App Store Connect, then attaches the IPA to the same GitHub Release.

Both release workflows accept the existing tag through **Run workflow** on `main`. Choose `source: tag` to rebuild the original source, or `source: main` to rebuild the commit on `main` when the workflow was dispatched. The selected source must descend from the original tag and keep the same `expo.version`. For example, dispatch either workflow with `tag: v1.0.1` and `source: main` to build updated code as version `1.0.1`. The immutable tag stays fixed; artifact metadata records both the tag commit and the actual source commit. Android replaces the APK and its matching checksum and metadata in the existing GitHub Release.

Android rebuilds generate an increasing `versionCode` from seconds since 2020-01-01 UTC. The iOS workflow generates `CFBundleVersion` when the App Store build job starts, using the Asia/Shanghai date and time in `YYYYMMDD.HHmm` format (for example, `20260902.1223`). These build numbers change while the user-visible version stays the same.

The iOS workflow publishes the IPA after App Store Connect accepts the upload. Processing, TestFlight distribution, App Review submission, and App Store release remain manual. Each IPA filename includes its build number; `SHA256SUMS-ios` and `RELEASE_METADATA-ios.txt` describe the latest published iOS build. Earlier IPA builds remain available in the same Release. These are App Store distribution archives; normal iOS installation uses TestFlight or the App Store.

Before the first release, repository administrators must add a GitHub tag ruleset for `v*.*.*` that blocks tag updates and deletion. The `production` and `app-store` GitHub Environments must restrict deployments to `main` and protected `v*.*.*` tags; required reviewers are recommended for both environments. The ruleset and deployment restrictions are release trust boundaries, including for manually dispatched recovery runs.

Keep the Android signing material in the `production` Environment as `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` secrets. Set `ANDROID_SIGNING_CERT_SHA256` to the expected public certificate fingerprint as an Environment variable; the workflow rejects an APK signed by any other identity.

For iOS, create the `app.runwhale.mobile` App ID and App Store Connect app, an Apple Distribution certificate, an App Store provisioning profile, and an App Store Connect API key. Configure the `app-store` Environment with:

| Kind | Name |
| --- | --- |
| Variable | `APPLE_TEAM_ID` |
| Variable | `APPSTORE_ISSUER_ID` |
| Variable | `APPSTORE_API_KEY_ID` |
| Variable | `APPSTORE_PROVISIONING_PROFILE_NAME` |
| Secret | `APPSTORE_CERTIFICATES_FILE_BASE64` |
| Secret | `APPSTORE_CERTIFICATES_PASSWORD` |
| Secret | `APPSTORE_API_PRIVATE_KEY` |

`apps/mobile/app.json` intentionally declares `ITSAppUsesNonExemptEncryption` as the Boolean value `false`. This is an export-compliance owner decision covering the complete app and linked libraries, not an inference made by CI. Reconfirm it before the next tag whenever the embedded Node/OpenSSL runtime, SSH support, `node:crypto`, or other user-accessible encryption capability changes. If the classification changes, update the declaration and complete Apple's encryption declaration process before releasing.

## Repository Layout

- `apps/mobile`: Expo Router Studio, Agent, editor, settings, and Preview UI.
- `packages/node-runtime`: embedded Node entry point, Agent host, Metro, and bundle server.
- `packages/mobile-runtime`: file sandbox, task workers, dependency policy, Git, and TypeScript services.
- `packages/mobile-protocol`: versioned RPC and bounded runtime events.
- `packages/dsh-mobile`: mobile Agent profile and credential seam.
- `native/node-host`: Android and iOS Expo Module hosts consuming the standalone native Node runtime package.
