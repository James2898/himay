# MEMORY.md — Bug Root Causes & Resolutions

> Maintained by `@debug-memory`. Read by agents when PM includes it in the Context Bundle.
> Agents that read: @codebase-explorer, @requirements-engineer, @fullstack-developer, @release-manager, @validator-agent.
> Only `@debug-memory` writes to this file.

---

## Architecture

- **BUG-001** | 2026-11-20 | Feature: `ChordMonitor (Phase 1: Memory & Data Hygiene)`
  - **Root Cause:** Exporting a non-component helper (`getTransposedLabel`) from a React component `.tsx` file violated ESLint `react-refresh/only-export-components` under Vite React Fast Refresh.
  - **Resolution:** Removed the `export` keyword from `getTransposedLabel` in `src/components/ChordMonitor.tsx` so only the component (and TypeScript types) are exported.
  - **Prevention:** Never export non-component runtime functions or constants from `.tsx` component files; keep internal helpers unexported or move shared utilities to a `.ts` module.

## UI State

- **BUG-002** | 2026-11-20 | Feature: `Audio Engine Blob URL Lifecycle (Phase 1: Memory & Data Hygiene)`
  - **Root Cause:** Calling global singleton `stemUrlManager.revokeAll()` inside the aborted/error branch of async `loadStems` in `src/hooks/useAudioEngine.ts` created a cross-song race condition that wiped active Blob URLs created by a newly selected song.
  - **Resolution:** Added scoped `revoke(url: string)` to `StemUrlManager` in `src/utils/audioCache.ts` and updated `loadStems` in `src/hooks/useAudioEngine.ts` to track `loadedUrls` per invocation and revoke only those URLs when `!isMounted` or on catch.
  - **Prevention:** In async React effects that allocate resources on a shared manager/singleton, track allocations per invocation and clean up only that invocation's resources after an `await` rather than calling a global `revokeAll()`.

## Performance

- **BUG-003** | 2026-11-20 | Feature: `ChordMonitor Memoization (Phase 1: Memory & Data Hygiene)`
  - **Root Cause:** Using an inline array fallback (`selectedSong?.chords ?? []`) inside `ChordMonitor` created a new array reference on every 60fps render frame, breaking `useMemo` dependencies (`activeChord`, `prevChord`) and triggering static ESLint memoization errors.
  - **Resolution:** Hoisted `const EMPTY_CHORDS: ChordEntry[] = [];` to module scope in `src/components/ChordMonitor.tsx` and used `selectedSong?.chords ?? EMPTY_CHORDS`.
  - **Prevention:** Hoist empty fallback arrays/objects (`[]`, `{}`) to module-level constants whenever they feed `useMemo`, `useCallback`, `useEffect`, or memoized child props.
