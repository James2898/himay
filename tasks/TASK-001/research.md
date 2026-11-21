# Research — Phase 1: Memory & Data Hygiene (TASK-001)

## Open Questions
- **Blocking:** None. (Design decisions Q1.4 and Q1.5 are settled per PM handoff; `MEMORY.md` and `docs/coding-guidelines.md` are absent at repo/worktree root.)
- **Pending Reconciliation** — Call sites of `getCachedUrl` and any existing `URL.createObjectURL` / `URL.revokeObjectURL` calls; exact teardown hook (song switch / unmount) for invoking `stemUrlManager.revokeAll()`. (suggested resolution source: `context.md` — `src/utils/audioCache.ts`, `src/components/Mixer.tsx`, and callers of `getCachedUrl`)
- **Pending Reconciliation** — Exact parameter/return signature and failure/miss semantics of `getCachedUrl` in `src/utils/audioCache.ts`. (suggested resolution source: `context.md` — `src/utils/audioCache.ts`)
- **Pending Reconciliation** — Exact schema/ID of Song 01 (`Langit + Sapat Na At Higit Pa`) in `public/songs.json`, exact `currentTime` unit, and location/values of Song 01's verified pre-computed chord timestamps. (suggested resolution source: `context.md` — `public/songs.json`, `pbi-docs/`, `docs/`)
- **Pending Reconciliation** — Current `ChordMonitor.tsx` prop interface and parent callers, whether secondary/next-chord display exists, exact `localStorage` keys to remove, and `getTransposedLabel` behavior on `"--"` / no-chord labels. (suggested resolution source: `context.md` — `src/components/ChordMonitor.tsx`, `src/components/Mixer.tsx`, parent callers)
- **Pending Reconciliation** — All importers/references to `src/utils/chordScanner.ts` and `handleChordScan`, plus exact boundary between scan-only `AudioContext` decoding and playback-critical `AudioContext` code in `src/components/Mixer.tsx`. (suggested resolution source: `context.md` — `src/utils/chordScanner.ts`, `src/components/Mixer.tsx`, repo-wide grep)
- **Pending Reconciliation** — Available verification commands (`tsc`, `lint`, `test`, `build`) in `package.json`. (suggested resolution source: `context.md` — `package.json`)
