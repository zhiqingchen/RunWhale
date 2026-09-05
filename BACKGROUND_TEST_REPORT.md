# iOS background recovery — 2026-09-05

## Behavior

- Native iOS lifecycle owns a finite UIKit background assertion. The Agent receives at most 20 seconds of grace, with eight seconds reserved from the reported allowance for cancellation and persistence. The OS may grant less time. The assertion ends after checkpointing or foregrounding; this does not promise indefinite background execution.
- Studio no longer cancels Agent work on its React Native background event. Preview stops on actual backgrounding. Brief inactive transitions do not pause the Agent.
- The host checkpoints during execution and on background entry. At the grace deadline, it drains active work with a distinct background cancellation cause, preserves pending input, and persists `paused` instead of `failed` or user-stopped `aborted`.
- Foregrounding resumes only sessions paused by the current live host. Revisions reject stale lifecycle requests. Resumption retains the existing harness, history, permission mode, and Goal budget. A context notice requests reconciliation of completed tool results and uncertain effects; the original user request is not submitted again.
- Explicit Stop removes automatic-resume eligibility. A process restart leaves durable paused sessions parked for explicit Continue. The new Continue RPC restores the session without duplicating its original user prompt.
- Long-running `BGContinuedProcessingTask` support is deferred. The bounded UIKit allowance and checkpoint recovery are the implemented baseline.

## Automated validation

- Pre-commit validation on 2026-09-05: `pnpm check` passed all workspace typechecks and 446 tests; `pnpm test:node-runtime` passed all 85 tests. The focused background integration suite also passed all eight tests.
- Full Node-runtime suite before the final rapid-switch refinement: 84 passed.
- Final background integration file: 8 passed; final Node-runtime typecheck passed.
- Final combined host/harness/Goal regression rerun after removing the native fixture: 16 passed. Installed iOS and built Android runtime asset hashes match the production bundles.
- Workspace typechecks passed. The first full test run hit the existing five-second timeout in the 501-file Git snapshot test during native compilation. The Git file passed on its own (10 tests), and the complete non-Node-runtime suite passed serially: 446 tests.
- Integration coverage includes short switches, one continuation per pause, durable pause records, pending-message preservation, explicit Stop, Android isolation, harness-initialization interruption, explicit continuation after restart, Goal budget preservation, and a new background transition during foreground recovery.

## Device acceptance

- iPhone 17 Pro Simulator (iOS 26.5, arm64): native host build/install and actual Home/background/foreground transitions passed. The controlled Goal checkpointed at round 193 (`paused`, disarmed), resumed on return with its existing budget and exactly one background notice, and remained stopped at round 279 after an explicit Stop and another background/foreground cycle.
- Android arm64 host build succeeded. Updated-runtime phone acceptance is **NYV**: Huawei ANG-AN00 remains at the package installer's risk confirmation. The installation attempt was not completed.
- Physical iPhone acceptance is **NYV**: both registered physical iPhones were unavailable in `xcrun devicectl list devices`.
- Live-provider interruption and process-death timing on a physical iPhone remain **NYV**. Computer integration tests use the real harness with controlled adapters, not a remote provider.

The native audit used the existing deterministic mode with a temporary 200 ms asynchronous adapter delay, so UIKit lifecycle callbacks could run between responses. The disposable runtime project was deleted, the delay was removed, and production runtime bundles were regenerated. No provider credentials were added or changed, and no remote provider request was made.

A pre-existing Home card still references the deleted `recovery-audit-20260905` fixture from another audit and displays a project-load error; this was outside the background change and was not altered.

Follow-up acceptance: reconnect one physical iPhone and exercise a live-provider request across short switches, lease exhaustion, and process death. Complete the owner-controlled Android installation and verify the updated runtime on Huawei ANG-AN00.
