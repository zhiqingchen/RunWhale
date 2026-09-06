![RunWhale — Dive deep. Get it done. Build from anywhere.](.github/assets/runwhale-banner.png)

English | [简体中文](README.zh-CN.md)

RunWhale is a coding Agent that brings the development loop to your phone. Project files, tools, sessions, Git, Metro, and Preview stay on the device; only model inference uses the remote provider you configure.

## Download

[Download RunWhale on the App Store](https://apps.apple.com/app/id6807644595) for a US$10 one-time purchase.

## Demo

https://github.com/user-attachments/assets/b8b7d184-8d6b-4fc0-b954-c159c02aa1b4

## Build from Anywhere

- Start a new project or import an existing repository.
- Ask the Agent to inspect, edit, test, and repair code.
- Edit files, run bounded Node.js and TypeScript tasks, and install supported pure-JavaScript dependencies.
- Review Git changes and continue work in durable sessions.
- Preview the same Expo project on Web, iOS, and Android.
- Ask the Agent to inspect Preview logs and nodes, exercise supported controls, and check screenshots with a vision-capable model.

User projects never invoke Xcode, Gradle, EAS, or IPA/APK builds. RunWhale bundles and previews them locally on the phone.

For apps you use often, choose **Workspace → project more actions → Add to Home Screen**. Set a name and icon, then confirm the Android launcher prompt or follow the iPhone Shortcuts steps. The shortcut opens the project's latest successful Preview directly; keep RunWhale and the project installed. The setup page also lets you try the launch and export the icon.

## What Runs Where

| On the phone | Remote |
| --- | --- |
| Projects, Agent sessions, Node.js, TypeScript, tasks, Git, Metro, and Preview | Model inference through the selected provider |
| Credentials in Android Keystore or iOS Keychain | Git hosting during an explicit network Git operation |

Credentials pass only through the trusted in-memory seam. They are never written to projects, environment variables, Git configuration, sessions, logs, or Preview bundles. Local runtime RPC is token-protected and bound to localhost.

Private Git remotes use a device-generated Ed25519 key whose private half never leaves secure storage.

On iOS, Agent work receives a limited background grace period, then saves its session and pauses. Returning to the app automatically continues work paused by the current process. After restarting the app, use Continue on the paused session. Explicitly stopped tasks remain stopped.

## Scope

RunWhale targets Web and React Native projects with Expo SDK 57. Studio manages projects, files, Agent sessions, and settings; a separate Native Preview container runs user-project bundles.

The MVP intentionally does not provide:

- A general Linux environment, shell, or PTY.
- Native npm addons, arbitrary native binaries, dynamic Expo config plugins, or project-specific native SDKs.
- Unrestricted iOS background execution or background Metro.
- A cloud runner, marketplace, payments, or leaderboards.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [DEVELOPMENT.md](DEVELOPMENT.md) for build and development workflows.

## License and Trademarks

RunWhale's original software code is licensed under the [Apache License 2.0](LICENSE). Third-party code and assets remain subject to their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Apache License does not apply to third-party trademarks or to RunWhale brand assets that are identified as separately licensed or reserved.

The `RunWhale` name is not licensed for use as a trade name, trademark, service mark, or product name. See [TRADEMARKS.md](TRADEMARKS.md) for the permitted descriptive uses and reserved brand rights.
