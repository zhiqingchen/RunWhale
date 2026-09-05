# Repository Instructions

## Basics

- Work in English; product copy may use the localization system.

## Runtime Boundaries

- Treat the standalone `https://github.com/zhiqingchen/nodejs-mobile.git` repository as the canonical owner of the Node Mobile source port and `@runwhale/node-mobile-runtime` releases. Consume its prebuilt artifacts at an exact version and keep their release provenance aligned with `upstreams.lock.json`.
- Studio uses computer Metro on `8081` or `8082`; user Preview uses embedded Metro on a random token-protected localhost port.
- Rebuild the app only for native-host, embedded-runtime, or Native Preview changes. Use Fast Refresh for Studio UI work.
- User projects must never trigger Xcode, Gradle, EAS, IPA, or APK builds.
- Preserve Android arm64, iPhone arm64, and iOS Simulator arm64/x86_64 support.

## Working Loop

- Classify work as documentation, Studio UI, embedded runtime, or native; use the narrowest matching feedback loop and widen only when needed.
- Batch related discovery and UI states. Reuse Metro, devices, routes, and disposable audit projects.
- Run the smallest focused check during implementation. Run `pnpm check` once for a cohesive source change; documentation changes need formatting, language, links, and diff review instead.
- Place temporary fixtures at an existing boundary, exercise related states together, and remove them before committing. Never retain credentials, private keys, runtime events, or project mutations.
- If a device, host unlock, or owner fact is unavailable, record the exact NYV boundary and continue with an independent TODO instead of retrying the blocked path.

## Scope and Safety

- Prefer the simplest current solution. Add abstractions or defensive branches only for a requirement, failing test, or observed case.
- Credentials must not enter project files, environment variables, sessions, logs, bundles, or Preview.
- Prioritize polished core MVP workflows, responsive and simple state, and few dependencies. Defer non-core accessibility, assistive-technology, and multi-device work unless requested.
- Validate routine mobile changes on one representative Android phone and one representative iPhone.
- Keep tests proportional to core happy paths and confirmed regressions; avoid duplicate or speculative coverage.
