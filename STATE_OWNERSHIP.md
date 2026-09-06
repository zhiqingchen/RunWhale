# State ownership

Studio composes Agent UI from `useAgentSession`, `useAgentComposer`, and `useAgentViewport`. Session events and session records supply running, Plan, and Goal presentation. Model and SSH settings retain their shared settings shell.

The pure Native Preview catalog lives in `packages/mobile-protocol/src/native-preview-modules.json`. It supplies the existing Expo template dependency subset. `pnpm native-modules:verify` checks the catalog against Studio and the embedded module store. Runtime artifact versions remain pinned by `upstreams.lock.json`.

Each loaded runtime Agent session has one `AgentSessionExecution`. Its observer outlives individual prompts, and manual turns and automatic Goal work share event publication and the serialized checkpoint writer. Project protection ends after execution, cancellation cleanup, and final persistence. `host.suspend` drains active sessions and stops Preview while leaving Node alive. Restored Goals require explicit resume.

Native Studio persists version 3 project metadata and unresolved editor drafts in AsyncStorage. Runtime project files are authoritative; file listings and opened contents are held in memory. Draft checkpoints are serialized immediately. Runtime writes are serialized and debounced by 300 ms, using the version returned by `project.read`. Agent and Preview admissions flush pending writes and reject unresolved drafts. Apply reads the current runtime version before attempting the replacement; discard retains the runtime file.

Migration journals legacy-only project restoration before creating runtime directories. An unchanged scaffold created by migration can be replaced with the legacy project; existing runtime content is retained and differing or missing legacy files become recovered drafts. New chunk generations are read back before their manifest is published and verified. An interruption retries migration from the retained legacy snapshot. Legacy storage is retained as a recovery backup and is no longer updated on native. Recovered drafts never enter user project directories or Preview bundles unless explicitly applied.

Browser Studio retains its local snapshot provider. Templates are seeded during project creation, and routine Agent or Preview operations do not upload or download complete projects.
