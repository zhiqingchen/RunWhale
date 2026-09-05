# Goal test report — 2026-09-05

## Retry tap and height regression — 17:28 follow-up

Classification: Studio UI; reused Metro on 8081 without rebuilding native apps.

- Reproduced with the production AgentPanel and a temporary runtime boundary: tap Retry, hold credential.status for 1.5 seconds, and deliver the previous task's failed event during that wait. Before the fix, the new onRun received an already-aborted signal and Retry returned silently to the failed card. The event cutoff now includes events received during credential lookup.
- The recovery card now places Retry beside the failure copy, with a 36-point button surface inside a 44-point touch target. Explicit row layout keeps the spinner inside the surface, and decorative children do not intercept touches.
- Huawei ANG-AN00 and iPhone 17 Pro Simulator both completed retries under the reproduced event ordering. Button-edge taps worked; repeated taps while pending admitted one run. Android also passed with the software keyboard open. The fixture made no provider request and created no runtime project.
- Focused recovery/lifecycle/deadline tests: **17 passed**. Root `pnpm check` passed, including all mobile tests and workspace type checks.
- Physical iPhone acceptance and the user's exact provider session remain **NYV**: both paired iPhones report unavailable. The Android check validates current Studio JavaScript against its installed native host.

Temporary route, runtime-context export, and audit draft keys were removed after validation.

## Recovery follow-up

The screenshot's recovery controls were checked on 2026-09-05:

- Goal reads now restore the saved session without submitting a prompt. Restored Goals stay disarmed until explicit Resume; edit and clear no longer require a preliminary Agent run. Goal-only mutations preserve the previous failed/stopped session state.
- Terminal lifecycle events retire stalled Studio requests and release the submission guard. Regression coverage includes failed, aborted, and completed states and rejects stale events from an earlier submission.
- Host-only failure details survive session reload, and whitespace-only error copy uses the recovery fallback. A successful retry clears the previous host failure.

Validation:

- The isolated commit snapshot passed root `pnpm check` (446 tests) and all 46 focused host, Goal audit, and session-driver tests.
- The runtime suite passed all 77 tests before concurrent background/resume edits. The final shared-workspace run had 83 passes and one existing diagnostic-wait timeout; that exact diagnostic test passed when rerun alone. Goal restart/edit/resume/clear and failure persistence/retry integration tests passed.
- Rebuilt iPhone 17 Pro Simulator: the production Retry button accepted a failed attempt whose transport deliberately never settled, unlocked, and accepted a second attempt through completion. The embedded runtime restored an inactive Goal without a new user message; native edit/save/read-back and delete passed. The transport fixture made no live-provider request.
- Android arm64 APK build passed. Installation on Huawei ANG-AN00 remained committed at 80%, with device confirmation unaccepted; the installed app's update time remained 12:25. Only this audit's pending install was abandoned. Updated-runtime Android acceptance is **NYV**.
- Both physical iPhones were unavailable. Physical iPhone acceptance and the original screenshot's provider-side failure are **NYV**.

The temporary UI fixture, synthetic seed, and owned simulator project were removed. Concurrent workspace changes were preserved.

## Implementation follow-up

The three regressions below are now ordinary passing tests. `AgentSessionExecution` owns loaded-session observation, cancellation, checkpoints, and project protection across manual turns and automatic Goal rounds. Admitted goal-sourced user messages advance the Studio round counter. The DSH continuation driver remains unchanged.

- Full Node-runtime suite: **75 passed**. After the final internal run-options cleanup, the host, Goal audit, and session-driver files were rerun: **44 passed**.
- Final root `pnpm check`: **444 passed**, no expected failures, including migration scaffold recovery. It excludes Node-runtime tests.
- Deletion is rejected while work runs and while cancellation drains. Deletion succeeds after cancellation and final persistence complete.
- Automatic events reach subscribers and final session storage. Repeated `host.suspend` calls checkpoint work and preserve Node; restored Goals remain disarmed.
- Rebuilt iPhone 17 Pro Simulator (iOS 26.5): create, lazy read, editor flush, version-conflict retention, blocked Agent admission, explicit draft apply, Native Preview bundle generation, repeated suspend, and disposable-project cleanup passed using a temporary route calling the production stores and RPCs.
- Huawei ANG-AN00: production Studio file/edit/conflict/apply and Native Preview bundle-generation checks passed against the previously installed runtime. The rebuilt Android arm64 APK succeeded, but installation requires the owner's lock-screen password. Updated-runtime device acceptance is **NYV**, not covered by the earlier installation.
- Both registered physical iPhones were unavailable in `xcrun devicectl list devices`; physical iPhone acceptance remains **NYV**. Live-provider mobile Goal execution and background/process-death behavior during that execution remain **NYV**; deterministic real-harness tests cover the execution logic on the computer.

The temporary route and its projects were removed. No provider request was made during the device audit: Agent submission was deliberately blocked at the unresolved-file-draft barrier. Dependency versions and runtime provenance were verified unchanged.

The original audit below is retained as historical evidence, not the current test result.

## Original audit

**Result: acceptance failed.** The goal domain and native controls work in the tested scenarios, but automatic continuation is not fully owned by the mobile runtime host. Three regression cases remain failing and are explicitly recorded with Vitest `it.fails`; they are not fixes or evidence of successful acceptance.

## Verified scope

- Node.js 24.19.0, pnpm 11.25.0, installed DSH packages 0.1.2-alpha.4.
- Existing Studio Metro on port 8081. No native rebuild, dependency upgrade, user-project build, or remote model request was needed.
- Real `MobileHarness`, goal service, continuation driver, and model-facing tools with deterministic adapters.
- Real `RunWhaleRuntimeHost` HTTP RPC, project/session storage, host events, cancellation, and project deletion with disposable projects.
- Production `AgentGoalDialog` and `AgentGoalBar` on Huawei ANG-AN00 (Android 12 / API 31) and iPhone 17 Pro Simulator (iOS 26.5). A temporary route supplied component state and simulated request latency/errors; it was removed after the audit. These checks verify native component behavior, not an on-device end-to-end model run.

## Confirmed defects

### 1. P1 — automatic rounds escape host event streaming and persistence

Reproduction: initialize a session through `agent.run`, then create an idle goal through `agent.goal.create` with a three-round cap. Use a deterministic adapter with a short response delay and wait for the real goal driver to reach its cap.

| Observation after three rounds | Expected | Actual |
| --- | --- | --- |
| In-memory admitted rounds | 3 | 3 |
| Persisted admitted rounds | 3 | 1 |
| Published automatic `turn/end` events | 3 | 0 |
| Persisted goal phase | blocked | active |

The synchronous adapter also reproduced missing host events, although its rounds finished quickly enough to be captured by the creation-time snapshot. Adding response latency exposed the persistence gap.

`MobileHarness.run` removes its session-event listener when its `whenIdle()` wait ends. The host's goal RPC can subsequently arm the independent continuation driver, but it only saves one mutation-time snapshot. Later rounds are not attached to a host run. The saved transcript can therefore miss work and restore a stale goal phase after restart.

Relevant code: [harness run/event lifecycle](packages/dsh-mobile/src/profile.ts), [goal RPC and persistence](packages/node-runtime/src/runtime-host.ts).

Regression: `publishes and persists automatic rounds after creating an idle goal` in [goal-audit.integration.test.ts](packages/node-runtime/test/goal-audit.integration.test.ts).

### 2. P1 — Stop and project deletion do not recognize automatic goal work

Reproduction: initialize a session, create an idle goal, and wait until its first automatic round is admitted. While that round is running, call `agent.cancel` and then `project.delete` against the disposable project.

- Stop returned `{ outcome: 'already-idle', restoredMessages: [] }`.
- Project deletion returned `{ deleted: true }`.
- Direct `MobileHarness.cancel` still recognized and cancelled the running agent.

The host's active-session and project-work tracking covers `agent.run` and the short goal mutation, but not the independent continuation. This permits deletion of a project while its agent is still working. It shares the ownership gap in defect 1.

Relevant code: [run tracking, cancelAgent, and project deletion](packages/node-runtime/src/runtime-host.ts).

Regression: `keeps automatic goal work cancellable and prevents deleting its project` in [goal-audit.integration.test.ts](packages/node-runtime/test/goal-audit.integration.test.ts).

### 3. P2 — admitted rounds do not advance the UI goal projection

Reproduction: project a `goal/change` creation with `roundsStarted: 0`, then append a matching goal-sourced `user/message` with `round: 1`.

Expected `roundsStarted: 1` and a changed projection version; actual `roundsStarted: 0` and an unchanged version. DSH derives admitted-round counts from goal-sourced user messages. The mobile projection only processes `goal/change`, so it misses that progress and does not trigger the corresponding goal refresh.

Relevant code: [agent-goal.ts](apps/mobile/src/utils/agent-goal.ts).

Regression: `advances round progress when a matching automatic goal round is admitted` in [agent-goal.test.ts](apps/mobile/test/agent-goal.test.ts).

## Passing coverage

| Area | Verified behavior |
| --- | --- |
| Slash parsing | Bare command, objective creation, whitespace, exact pause/resume/clear, case-insensitive actions, explicit edit, missing edit objective, lookalike rejection |
| Projection/transcript | In-flight tool creation, matching live edits, session isolation, clear, taskless mutations, stable revision version, goal command transcript handling |
| Lifecycle | Mobile default cap of 64; trimmed objective; edit, pause, resume, clear; duplicate-goal rejection; stale mutation rejection without log mutation |
| Continuation | Sequential rounds; exact round-cap stop; rejected resume without capacity; cap extension and resume; completion and replacement with a new goal identity |
| Model tools | Actual `create_goal`, `get_goal`, and `update_goal` execution; completion during an automatic round; blocking rejected during rounds 1 and 2 and accepted at round 3 |
| Cancellation | Direct harness cancel, pause, and clear during an active request; idle convergence and no queued continuation |
| Recovery/isolation | Active goal replay after restart remains disarmed until explicit resume; independent session state and references |
| RPC validation | Empty objective, invalid caps, unloaded session, wrong project; existing host lifecycle persistence and mutation/deletion exclusion tests |
| Android components | Empty-submit validation; create; pause/resume; edit dialog values and round label; blocked reason; active/disarmed resume; unavailable-session controls; request failure and retry; delete; completed state |
| iPhone simulator components | Create; pending controls; pause/resume; edit/save; long objective layout; blocked reason; active/disarmed resume; unavailable-session controls; request failure and retry; delete; completed state and replacement form |

## Validation results

- `pnpm check`: typechecking passed; **426 ordinary tests passed, 1 expected failure** across 72 test files.
- `pnpm --filter @runwhale/node-runtime exec vitest run test/runtime-host.test.ts test/goal-audit.integration.test.ts`: **39 ordinary tests passed, 2 expected failures**.
- Combined non-overlapping results: **465 ordinary tests passed, 3 expected failures**.
- Added 17 cases: 13 harness lifecycle/tool cases, 3 host integration cases, and 1 projection regression. Of these, 14 pass and 3 demonstrate the defects above.
- `git diff --check`: passed.

`it.fails` deliberately keeps the known regressions visible in test output. Once the implementation is corrected, remove the corresponding marker and retain the assertion. An expected-failure run must not be reported as a fully passing Goal feature.

## Not yet verified

- **Physical iPhone:** both available physical iPhones were offline in `xcrun xctrace list devices`. The running iPhone simulator supplied the iOS component checks. Physical-device acceptance remains NYV.
- **Live-provider end-to-end use on the installed mobile runtime:** deterministic adapters exercised the actual host and harness on the computer; native controls used a component fixture. Background/foreground and process-death behavior during a real mobile goal run remain NYV. Fix the host ownership defects before using that path for acceptance.
- No claim is made about every unrelated node-runtime test; the root `pnpm check` intentionally excludes that package's test suite, so its host and goal integration files were run explicitly.

Production implementation was left unchanged. Temporary device UI fixtures and integration projects were removed; no credentials or user-project contents were added to this report or the new tests.
