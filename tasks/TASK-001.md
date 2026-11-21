# TASK-001 — Phase 1: Memory & Data Hygiene
- **Tier:** 1
- **Date Created:** 2026-11-20
- **Status:** Complete

---

## Feature Summary

Phase 1 eliminates browser memory leaks and redundant client-side audio decoding in the Himay audio engine by introducing centralized Blob Object URL lifecycle management (`StemUrlManager`) in `src/utils/audioCache.ts`, replacing manual client-side chord scanning and `localStorage` caching with static optional chord manifest data (`ChordEntry[]`) on `Song` (piloted on Song 01 in `public/songs.json`), streamlining `ChordMonitor.tsx` to read directly from `selectedSong?.chords` with a graceful `"--"` fallback while preserving chromatic transposition (`getTransposedLabel`), and removing the obsolete chord scanner logic from `Mixer.tsx` and `src/utils/chordScanner.ts`.

---

## Acceptance Criteria

1. **AC-1 (`StemUrlManager` singleton & tracking):** `src/utils/audioCache.ts` implements `StemUrlManager` tracking active object URLs in an internal `Set<string>`, and exports a singleton instance named `stemUrlManager`.
2. **AC-2 (`stemUrlManager.create(blob)`):** Calling `stemUrlManager.create(blob)` calls `URL.createObjectURL(blob)`, adds the resulting URL string to the internal `Set<string>`, and returns that URL string.
3. **AC-3 (`stemUrlManager.revokeAll()`):** Calling `stemUrlManager.revokeAll()` calls `URL.revokeObjectURL(url)` for every tracked URL in the `Set<string>` and clears the `Set<string>`. Calling `revokeAll()` when the set is empty or calling it consecutively is an idempotent no-op that throws no errors and does not re-revoke already-cleared URLs.
4. **AC-4 (`getCachedUrl` integration):** `getCachedUrl` in `src/utils/audioCache.ts` obtains object URLs exclusively via `stemUrlManager.create(blob)` with no direct `URL.createObjectURL` calls bypassing `stemUrlManager`. Failed or empty cache/fetch lookups do not register invalid entries in `stemUrlManager`, and existing return/error contracts of `getCachedUrl` are preserved.
5. **AC-5 (Teardown boundary & multi-stem safety):** `stemUrlManager.revokeAll()` is NOT invoked inside `getCachedUrl` per stem (so loading multiple stems for the same song never revokes sibling stem URLs), and IS invoked at stem teardown boundaries (when switching away from a loaded song's stems and on audio mixer/player unmount — exact call sites reconciled via `context.md`).
6. **AC-6 (`ChordEntry` & `Song` type manifest):** `src/types/index.ts` exports the `ChordEntry` interface (`time: number`, `label: string`) and adds optional `chords?: ChordEntry[]` to the `Song` interface, preserving backward compatibility for songs without `chords`.
7. **AC-7 (Song 01 pilot chord data):** Song 01 (`Langit + Sapat Na At Higit Pa`) in `public/songs.json` includes a `chords` array of verified pre-computed `ChordEntry` objects (`time` as finite `number >= 0` in seconds matching `currentTime`, `label` as non-empty `string` compatible with `getTransposedLabel`), sorted in ascending (non-decreasing) order by `time`. `public/songs.json` remains valid JSON and other songs remain valid with `chords` omitted.
8. **AC-8 (Remove scan UI & `localStorage` caching):** `src/components/ChordMonitor.tsx` removes the `"GENERATE CHORD MAP"` button, the scan progress bar / scanning state UI, and all `localStorage` reads, writes, and removals related to chord map caching.
9. **AC-9 (Direct time-based chord resolution):** `ChordMonitor` derives the active chord directly from `selectedSong?.chords` using `currentTime` (resolving the latest entry with `entry.time <= currentTime`). Seeking backward/forward (`currentTime` jumps) or changing `selectedSong` updates the displayed chord immediately with no stale chord state.
10. **AC-10 (Graceful `"--"` fallback):** When `selectedSong` is null/undefined, `selectedSong.chords` is `undefined` or empty (`[]`), or `currentTime` precedes the first chord entry (`currentTime < chords[0].time`), `ChordMonitor` renders `"--"` gracefully (regardless of active transposition offset) without throwing errors.
11. **AC-11 (Preserve chromatic transposition):** `ChordMonitor` preserves the existing chromatic transposition logic (`getTransposedLabel`) and applies it to valid resolved chord labels before display, while keeping `"--"` (and any no-chord marker per existing `getTransposedLabel` semantics) unaltered. *(See `AM-2` for slash-chord bass note support.)*
12. **AC-12 (Remove scanner logic from `Mixer.tsx`):** `src/components/Mixer.tsx` removes `handleChordScan`, any scan-related state/callbacks passed to `ChordMonitor`, and redundant `AudioContext` / `decodeAudioData` decoding dedicated to chord scanning, while preserving all `AudioContext` / Web Audio logic required for stem playback, mixing, transport, and audio routing.
13. **AC-13 (Deprecate or remove `src/utils/chordScanner.ts`):** `src/utils/chordScanner.ts` is removed (preferred once `context.md` confirms no external callers depend on it) or marked `@deprecated` with zero active imports or references across `src/` (and tests, if any). *(See `AM-4` — confirmed 0 importers; delete `src/utils/chordScanner.ts`.)*
14. **AC-14 (Compile, lint, and build integrity):** TypeScript compilation, linter checks (if configured), and production build scripts defined in `package.json` pass with zero errors after all changes.

---

## Out of Scope

- Populating pre-computed chord timestamps for any song other than Song 01 (`Langit + Sapat Na At Higit Pa`) — settled by Q1.5.
- Building a backend service, CLI generator, or automated build-time audio-to-chord extraction pipeline.
- Modifying `getTransposedLabel`'s transposition algorithm (beyond slash-chord bass note handling required by `AM-2`) or adding new UI controls (chord diagrams, enharmonic toggles, manual chord editing).
- Modifying unrelated `AudioContext` stem playback, mixing, gain/pan/mute/solo controls, or IndexedDB/CacheStorage eviction policies beyond `StemUrlManager` object URL tracking (subsequent phases).

---

## Relevant Files

| File | Purpose |
|------|---------|
| `src/utils/audioCache.ts` | Defines `CACHE_NAME` (`"himay-stems-v1"`), `cacheSongStems`, and `getCachedUrl`; line 28 calls `URL.createObjectURL(blob)` with no `URL.revokeObjectURL()` lifecycle tracking. |
| `src/hooks/useAudioEngine.ts` | Sole runtime playback caller of `getCachedUrl` (`loadStems`, lines 40-45); disposes `Tone.Players` on song reload (lines 47-49) but never revokes prior blob URLs or disposes `players.current` on unmount/deselection. |
| `src/types/index.ts` | Defines `Stem` (lines 1-6) and `Song` (lines 8-14) interfaces; lacks `ChordEntry` and optional `chords?: ChordEntry[]` property. |
| `public/songs.json` | Song manifest (10 entries, `"01"`–`"10"`); Song `"01"` (lines 2-12) omits `"key"` and none of the entries include `"chords"` yet. |
| `src/components/ChordMonitor.tsx` | Holds local `ChordEntry` interface (lines 18-21), `CHROMATIC_SCALE` + `getTransposedLabel` transposition logic (lines 3-16, 60-85), timeline lookup `useMemo`s (lines 88-104), `localStorage` (`chords_${songId}`) persistence, and scan trigger UI. |
| `src/components/Mixer.tsx` | Loads `/songs.json` (lines 46-56), duplicates `"himay-stems-v1"` cache check (lines 58-79) and `NOTES` array (line 15), implements `handleChordScan` with duplicate `AudioContext`/`decodeAudioData` + `getCachedUrl` (lines 91-180), and wires `<ChordMonitor />` (lines 314-320). |
| `src/utils/chordScanner.ts` | Unused module (`0` importers across `src/`) containing `scanTrackForChords` with redundant `new AudioContext()` + `decodeAudioData()` and flawed time-domain peak-as-FFT pitch detection — to be deleted (`AM-4`). |
| `src/styles/ChordMonitor.css` | Styles for `ChordMonitor` performance display (lines 1-110) and setup/scanner UI (`.reset-button`, `.setup-view`, `.gen-btn`, `.scanner-container`, `.progress-track`, `.progress-fill`). |
| `pbi-docs/PBI-20261120-audio-engine-optimization.md` | Authoritative spec for Phase 1 Tasks 1.1–1.3 (lines 55-153), Acceptance Criteria (lines 350-360), and Design Grill decisions Q1.4–Q1.5 (lines 420-421). |
| `tsconfig.app.json` | Enforces `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `verbatimModuleSyntax: true`, and `erasableSyntaxOnly: true` (affects TypeScript imports and class syntax). |
| `package.json` | Defines `build` (`tsc -b && vite build`) and `lint` (`eslint .`) verification scripts; no unit test runner is installed. |

---

## Technical Schema

N/A — no API contract required for this task.

---

## Planning Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| Feature Specification | `tasks/TASK-001/spec.md` | Acceptance criteria + scope |
| Context Bundle | `tasks/TASK-001/context.md` | Reusable components + patterns |
| Research Notes | `tasks/TASK-001/research.md` | Open questions + decisions |

---

## Implementation Notes

- Read `docs/coding-guidelines.md` before writing any code (if present in this project — absent at repo/worktree root per `research.md`).
- Read `docs/tech-stack.md` before choosing any library or package (if present in this project).
- Read `docs/structure.md` before creating any new file or directory (if present in this project).
- **Fallback Behavior:** No backend API is invoked by this feature. When `selectedSong` is unselected or `selectedSong.chords` is `undefined` or `[]` (such as Songs 02+), `ChordMonitor` displays `"--"` gracefully with no manual scan fallback button or error banner (per Settled Decisions Q1.4 and Q1.5).
- **Strict Type-Only Imports (`verbatimModuleSyntax: true`):** Always use `import type { Song, Stem, ChordEntry } from "../types"` (or inline `type` specifiers) for types/interfaces (see `src/hooks/useAudioEngine.ts:3`, `src/components/Mixer.tsx:4`, `src/components/ChannelStrip.tsx:2`).
- **Standard Class Fields (`erasableSyntaxOnly: true`):** `tsconfig.app.json:23` forbids constructor parameter properties (`constructor(private x)`), `enum`s, and `namespace`s. Declare class fields explicitly on the class body in `StemUrlManager` (e.g., `private activeUrls: Set<string> = new Set();`).
- **Named Utility Exports + Cache Fallback:** Guard browser globals (`typeof window === "undefined" || !window.caches`), wrap CacheStorage/Blob ops in `try/catch`, log `console.warn`, and fall back to returning the original CDN `url` (see `src/utils/audioCache.ts:17-36`). Use `CACHE_NAME` instead of hardcoding `"himay-stems-v1"`.
- **Reuse Existing UI & Timeline Patterns:**
  - Promote `ChordEntry` from `src/components/ChordMonitor.tsx:18-21` into `src/types/index.ts` and import it in `ChordMonitor.tsx` (avoid duplicate interface definitions).
  - Reuse `CHROMATIC_SCALE` and `getTransposedLabel` (`src/components/ChordMonitor.tsx:3-16, 60-85`, updated per `AM-2` for slash chords) and the `activeChord`, `prevChord`, `nextChord` `useMemo` timeline lookup hooks (`lines 88-104`) driven by `selectedSong?.chords ?? []` and `currentTime`.
  - Preserve performance layout styling in `src/styles/ChordMonitor.css` lines 1-110 (`.chord-monitor-outer`, `.chord-box-main`, `.performance-layout`, `.chord-primary-center`, `.chord-main-text`, `.chord-prev-preview`, `.chord-next-preview`).
- **Hook Cleanup & Cancellation Guard (`useAudioEngine.ts`):** Preserve the `isMounted` boolean flag across `await` boundaries (`src/hooks/useAudioEngine.ts:33, 89-91`) to avoid applying stale loads after `selectedSong` changes or unmount.
- **Verification Commands:** Run `npm run build` (`tsc -b && vite build`) and `npm run lint` (`eslint .`) in `/home/james2898/projects/himay-phase1` to verify AC-14 (no unit test runner is installed in `package.json`).

### MEMORY.md Prevention Rules (inlined — do not re-read MEMORY.md)

> _Copied verbatim from `context.md` → MEMORY.md Notes. This is the canonical list of past-bug prevention rules for `@fullstack-developer`, `@release-manager`, and `@validator-agent`. They MUST NOT re-read `MEMORY.md` directly; trust this list._

- N/A (`MEMORY.md` does not exist at `/home/james2898/projects/himay/MEMORY.md` or `/home/james2898/projects/himay-phase1/MEMORY.md`).

---

## Amendments (from Context Bundle)

> _Added by `@task-logger` after reconciling `spec.md` against `context.md`. These criteria were not in the original spec but are required based on anti-patterns or contradictions found during codebase exploration._

- **AM-1 (Amends AC-7 — Add missing `"key"` and `"duration"` metadata to Song `"01"` in `public/songs.json`):** `context.md` (Anti-Patterns Flagged) reports that `public/songs.json` lines 2-12 omit `"key"` on Song `"01"` even though `Song` (`src/types/index.ts:12`) requires `key: string` and `Mixer.tsx:85,203` reads `selectedSong.key` directly (`undefined` causes `NOTES.lastIndexOf(undefined)` to return `-1`). Ensure Song `"01"` (`Langit + Sapat Na At Higit Pa`) in `public/songs.json` includes `"key": "G"` and `"duration": 531` alongside the verified `chords` array.
- **AM-2 (Amends AC-11 — Transpose slash-chord bass notes in `getTransposedLabel`):**
  - *Contradiction resolved:* `spec.md` AC-11 / Out of Scope stated not to modify `getTransposedLabel`'s transposition algorithm, whereas `context.md` (Anti-Patterns Flagged & Reuse Candidates) cites `src/components/ChordMonitor.tsx:65` where regex `/^([A-G][b#]?)(.*)$/` only captures and transposes the root note and leaves slash-chord bass notes such as `"/F#"` in `"D/F#"` (specified in PBI lines 110 & 138) un-transposed.
  - *Decision:* Explorer's concrete file:line finding takes precedence so Song 01's slash chords transpose musically accurately while keeping `CHROMATIC_SCALE` and semitone math intact.
  - *Amended AC-11 text:* Preserve `CHROMATIC_SCALE` and the semitone offset algorithm in `getTransposedLabel`, and extend its regex/parsing so slash-chord bass notes (e.g., `"D/F#"`) transpose alongside the root note, while keeping `"--"` (and any no-chord marker per existing semantics) unaltered.
- **AM-3 (Amends AC-4, AC-5, AC-8, AC-12 — Code hygiene, `useAudioEngine` unmount disposal, and `noUnusedLocals` / `no-explicit-any` cleanup):** Derived from `context.md` (Anti-Patterns Flagged & Patterns to Follow):
  1. In `src/utils/audioCache.ts:21`, reference the `CACHE_NAME` constant instead of hardcoding `"himay-stems-v1"`.
  2. In `src/hooks/useAudioEngine.ts`, invoke `stemUrlManager.revokeAll()` and dispose `players.current` both at song switch / deselection boundaries (before loading new stems) and in the hook unmount cleanup.
  3. In `src/components/Mixer.tsx`, remove the now-unused `getCachedUrl` import on line 5 when removing `handleChordScan` (required for `noUnusedLocals: true` in `tsc -b`), and remove the scan-related `eslint-disable-next-line @typescript-eslint/no-explicit-any` / unguarded patterns in `ChordMonitor.tsx:112` and `Mixer.tsx:100` without introducing new `explicit-any` or unguarded `JSON.parse`.
- **AM-4 (Amends AC-13 — Delete `src/utils/chordScanner.ts`):** `context.md` (Relevant Files & Anti-Patterns Flagged) confirms `src/utils/chordScanner.ts` has `0` importers across `src/` and contains redundant `AudioContext`/`decodeAudioData` allocation and broken time-domain peak-as-FFT detection (`line 66`). Delete `src/utils/chordScanner.ts` completely.

---

## Resolved Open Questions

- Call sites of `getCachedUrl` / `URL.createObjectURL` / `URL.revokeObjectURL` and teardown boundary for `stemUrlManager.revokeAll()` → `src/hooks/useAudioEngine.ts` (`loadStems`, lines 40-45) is the sole runtime playback caller of `getCachedUrl` (the only other caller, `handleChordScan` in `Mixer.tsx:91-180`, is removed by AC-12). `src/utils/audioCache.ts:28` is the only `URL.createObjectURL(blob)` call, and no `URL.revokeObjectURL` calls exist. `stemUrlManager.revokeAll()` must be invoked in `src/hooks/useAudioEngine.ts` on song change / deselection (alongside disposing `Tone.Players`) and on unmount cleanup. (source: `context.md` → Relevant Files & Patterns to Follow; PM handoff item 1)
- Parameter/return signature and failure/miss behavior of `getCachedUrl` in `src/utils/audioCache.ts` → `getCachedUrl` (`src/utils/audioCache.ts:17-36`) guards browser globals (`typeof window === "undefined" || !window.caches`), wraps CacheStorage and `Blob` retrieval in `try/catch`, logs `console.warn` on failure, and falls back to returning the original CDN `url` on cache miss or error (calling `stemUrlManager.create(blob)` only when a cached `Blob` is retrieved). (source: `context.md` → Reuse Candidates & Patterns to Follow; PM handoff item 2)
- Song 01 JSON structure, `currentTime` time unit, and chord timestamp source → `public/songs.json` has 10 entries (`"01"`–`"10"`). Song `"01"` (`Langit + Sapat Na At Higit Pa`, lines 2-12) requires `"key": "G"`, `"duration": 531`, and `"chords": ChordEntry[]` with `time` in **seconds** (matching `currentTime`). Verified pre-computed chord timestamps are in `pbi-docs/PBI-20261120-audio-engine-optimization.md` lines 136-141. (source: `context.md` → Relevant Files & Anti-Patterns Flagged; PM handoff item 3)
- `ChordMonitor` props, parent callers, prev/next preview rendering, `localStorage` keys, and `"--"` handling → `<ChordMonitor />` is mounted in `src/components/Mixer.tsx:314-320`. Its updated props are `selectedSong?: Song | null`, `currentTime: number`, `transpose: number` (removing scan/cache/songId props). `ChordMonitor.tsx` (`lines 88-104`) and `ChordMonitor.css` (`lines 1-110`) display the active chord along with `prevChord` and `nextChord` previews. Existing `localStorage` persistence uses key `chords_${songId}` (`lines 47-53`) and is removed. `getTransposedLabel` (`lines 60-85`) keeps `"--"` unaltered (and is updated per `AM-2` for slash chords). (source: `context.md` → Relevant Files, Reuse Candidates, Anti-Patterns Flagged; PM handoff item 4)
- Importers/references to `src/utils/chordScanner.ts` and `handleChordScan`, plus scan vs. playback `AudioContext` boundary in `Mixer.tsx` → `src/utils/chordScanner.ts` has `0` importers across `src/` and is deleted (`AM-4`). `handleChordScan` lives in `src/components/Mixer.tsx:91-180` (with its scan-only `AudioContext` + `decodeAudioData` + `getCachedUrl` call) and connects to `<ChordMonitor />` at lines 314-320; playback-critical audio engine logic resides in `src/hooks/useAudioEngine.ts`. (source: `context.md` → Relevant Files & Anti-Patterns Flagged; PM handoff item 5)
- Configured verification scripts in `package.json` → `package.json` defines `build` (`tsc -b && vite build`) and `lint` (`eslint .`); no unit test runner is installed. (source: `context.md` → Relevant Files; PM handoff item 6)

## Unresolved Pending Reconciliation

- Exact literal `ChordEntry[]` array (`time` and `label` values) for Song `"01"` (`Langit + Sapat Na At Higit Pa`) → Read `pbi-docs/PBI-20261120-audio-engine-optimization.md` lines 136-141 and `public/songs.json` lines 2-12 before editing `public/songs.json`.
- Exact TypeScript parameter/return type signature of `getCachedUrl` → Read `src/utils/audioCache.ts` lines 17-36 before implementing `StemUrlManager` integration.

---

## Resolution

- **Completed:** 2026-11-20
- **Branch:** feature/phase1-cache-chords (explicitly user-mandated)
- **Base branch:** develop
- **Files changed:**
  - `src/utils/audioCache.ts` — Implemented `StemUrlManager` with `create`, scoped `revoke`, and `revokeAll`; exported `stemUrlManager` singleton; integrated into `getCachedUrl` with `CACHE_NAME` constant (AC-1, AC-2, AC-3, AC-4, AC-5, AM-3)
  - `src/types/index.ts` — Exported `ChordEntry` interface and added optional `chords?: ChordEntry[]` to `Song` (AC-6)
  - `public/songs.json` — Added `"key": "G"` and pre-computed `chords` array to Song 01 (`Langit + Sapat Na At Higit Pa`) (AC-7, AM-1)
  - `src/components/ChordMonitor.tsx` — Streamlined props, direct chord resolution from `selectedSong?.chords`, module-scoped `EMPTY_CHORDS`, zero-allocation backward loops for active/prev/next chords, slash chord transposition in internal `getTransposedLabel` (non-exported for Vite Fast Refresh compliance), graceful `"--"` fallback, and removed scan/localStorage logic (AC-8, AC-9, AC-10, AC-11, AC-14, AM-2)
  - `src/components/Mixer.tsx` — Removed `handleChordScan`, scan AudioContext/decodeAudioData, unused `getCachedUrl` import, and scan props to ChordMonitor (AC-12, AM-3)
  - `src/hooks/useAudioEngine.ts` — Parallelized stem URL fetching with `Promise.all`, added scoped `loadedUrls` revocation on cancellation and error, added `stemUrlManager.revokeAll()` and player disposal at song deselection, load start, and unmount boundaries (AC-3, AC-5, AM-3)
  - `src/utils/chordScanner.ts` — Deleted obsolete, unused chord scanner utility (AC-13, AM-4)
  - `src/styles/ChordMonitor.css` — Removed obsolete scan/setup styles while preserving live harmonics and performance display layout
- **Diff Summary:**
  - `src/utils/audioCache.ts` L3–25, L46, L53 — `StemUrlManager` class (`create`, `revoke`, `revokeAll`), singleton export, `CACHE_NAME` constant usage, Blob URL creation via `stemUrlManager.create(blob)` (AC-1, AC-2, AC-3, AC-4, AM-3)
  - `src/types/index.ts` L8–11, L19 — Export `ChordEntry` interface, optional `chords?: ChordEntry[]` on `Song` (AC-6)
  - `public/songs.json` L5, L12–17 — Added `"key": "G"` and 4 verified pre-computed chords for Song 01 (AC-7, AM-1)
  - `src/components/ChordMonitor.tsx` L2, L19–67, L69, L71–75, L77–107, L109–147 — Slash chord root/bass transposition, internal non-exported `getTransposedLabel` (Fast Refresh fix), module-scoped `EMPTY_CHORDS`, zero-allocation timeline lookup loops, `"--"` fallback, removal of scan UI & localStorage (AC-8, AC-9, AC-10, AC-11, AC-14, AM-2)
  - `src/components/Mixer.tsx` L5, L146, L222–226 — Removed unused import, removed `handleChordScan` callback and duplicate scan AudioContext, passed simplified props to `ChordMonitor` (AC-12, AM-3)
  - `src/hooks/useAudioEngine.ts` L4, L34, L49, L52–63, L104–106, L118 — Parallelized URL loading via `Promise.all`, scoped URL revocation on cancellation and player load failure, called `stemUrlManager.revokeAll()` on unmount, deselection, and before loading new stems (AC-3, AC-5, AM-3)
  - `src/styles/ChordMonitor.css` L26–41, L112–167 — Cleaned up obsolete scan/setup styles, preserved performance layout (L1–110)
  - `src/utils/chordScanner.ts` (deleted) — Deleted obsolete unused file (AC-13, AM-4)
- **Notes:** Implementation and Fix Loop Attempt 1 completed strictly within `/home/james2898/projects/himay-phase1` worktree on branch `feature/phase1-cache-chords` (explicitly mandated by user). Fixed `react-refresh/only-export-components` by un-exporting `getTransposedLabel`. Fixed `useMemo` dependency churn by declaring module-scoped `EMPTY_CHORDS`. Optimized `activeChord` lookup to a zero-allocation reverse loop. Added scoped `revoke(url)` method to `StemUrlManager`. Parallelized stem URL fetching with `Promise.all` in `useAudioEngine.ts` and scoped cleanup on cancellation and failure. All ACs satisfied.

---

## Live Verification Report — TASK-001

| # | Case | Expected | Toast / DOM Mutations (recorded) | Network | UI state | Verdict |
|---|------|----------|----------------------------------|---------|----------|---------|
| 1 | Initial load & scanner UI removal (`http://localhost:3001`) | Page renders cleanly; `"GENERATE CHORD MAP"` button, scan progress bar, and scanner DOM elements completely absent; fallback `"--"` shown | None emitted; `localStorageCalls: []` | `GET /` `[200]`, `GET /songs.json` `[200]` (10 songs), Vite assets `[200]` | `title="himay"`, `.logo="HIMAY"`, `.song-picker=""` (11 options), `.chord-main-text="--"`, `hasLiveLabel=false`, `hasGenerateBtn=false`, `foundScannerEls=[]`, `hasGenerateChordMapText=false` | PASS |
| 2 | Song 01 selection & pre-computed chords | Selecting Song `"01"` (`Langit + Sapat Na At Higit Pa`) displays `"LIVE HARMONICS"`, active chord `"G"` at `0:00`, next chord `"D/F#"`, key `"G"`, duration `"8:51"`, zero `localStorage` usage | MutationObserver recorded `.chord-meta-header` (`"LIVE HARMONICS"`) and `.chord-next-preview` (`"D/F#"`); `localStorageCalls: []` | 4 Song 01 Cloudinary MP3 stem `GET`s `[200]` | `selectedValue="01"`, `.live-label="LIVE HARMONICS"`, `.chord-main-text="G"`, `.chord-next-preview="D/F#"`, `.chord-prev-preview=null`, `.util-label="PITCH: 0 KEY: G"`, `.seeker-row .time=["0:00","8:51"]` | PASS |
| 3 | Transposition & timeline seeking verification | `+1`/`+2`/`RESET`/`-1` transpose root & slash bass notes chromatically (`G -> G#`, `D/F# -> D#/G`); seeking `input.seeker-bar` updates active/prev/next chords immediately | None emitted; `localStorageCalls: []` | N/A (client-side state & Tone.js pitch shift) | At `0s`: `+1` => `"G#"` / next `"D#/G"`, `+2` => `"A"` / next `"E/G#"`, `-1` => `"F#"` / next `"C#/F"`. At `10s`: `0` => prev `"G"`, main `"D/F#"`, next `"Em7"`; `+1` => prev `"G#"`, main `"D#/G"`, next `"Fm7"`. At `25s`: `0` => prev `"Em7"`, main `"Cadd9"`, next `null`. Back to `0s`: main `"G"`, next `"D/F#"` | PASS |
| 4 | Graceful fallback on missing chords (Song 02) & deselection | Selecting Song `"02"` (no `chords` array) with `transpose=+1` and `0`, plus deselecting to `""`, displays `"--"` gracefully and hides `"LIVE HARMONICS"` & previews | `mutationsRecorded: []`, `localStorageCalls: []` | 4 Song 02 Cloudinary MP3 stem `GET`s `[200]` | Song `"02"` (`+1`): `.util-label="PITCH: +1 KEY: D"`, `.live-label=null`, `.chord-main-text="--"`, previews `null`, duration `"6:07"`. Song `"02"` (`0`): `.chord-main-text="--"`. Deselected (`""`): `.chord-main-text="--"`, times `["0:00","0:00"]` | PASS |
| 5 | Console audit & sibling controls regression | Zero uncaught JS exceptions, React hydration errors, or broken AudioContext errors; sibling mute toggle works | None emitted | All 43 requests `[200]` (0 failed) | Console total 75 messages: `Errors: 0`, `Warnings: 67` (standard Chrome pre-gesture `AudioContext` suspended warnings from `tone.js`), plus `Audio Engine: vocals/Drums/bass/inst connected...` logs. `VOCALS` mute toggle cycled `"mute-btn active-glow"` → `"mute-btn "` → `"mute-btn active-glow"` | PASS |

**Overall Verdict:** PASS
**Seeded/Cleaned:** No throwaway API/DB entities seeded (static JSON manifest & client-side app); verified `localStorage` keys `[]` and closed Playwright browser cleanly. No pre-existing data touched.
**Personal Data:** Stripped — N/A (no personal data in app or output).
**Screenshots:** Omitted (default).

### Prioritized Manual Verification Guide

| Priority | Target / Flow | Route / Entry Point | Action | Expected Result |
|---|---|---|---|---|
| P1 | Song 01 pre-computed chord monitor & timeline sync | `/` (`http://localhost:3001`) | Select `Langit + Sapat Na At Higit Pa (Key of G + F)` from `.song-picker`, drag `.seeker-bar` through `0:00` → `0:10` → `0:17` → `0:25`, and press Play (`▶`) | `"LIVE HARMONICS"` appears; chords transition `G` → `D/F#` → `Em7` → `Cadd9` with dimmed prev/next previews; audio plays cleanly |
| P1 | Chromatic & slash-chord transposition | `/` (`http://localhost:3001`) | With Song 01 selected, click `+`, `-`, and `RESET` in `.pitch-btns` at `0:00` and `0:10` | Both root and slash bass notes transpose chromatically (`G` → `G#`, `D/F#` → `D#/G` at `+1`; `C#/F` at `-1`) and `RESET` restores `G` / `D/F#` |
| P2 | Missing chords fallback & scanner removal | `/` (`http://localhost:3001`) | Inspect initial load and then select `Don Mon - God is Good All The Time (D)` (Song 02), including with transpose `+1` active | `"GENERATE CHORD MAP"` button and progress bar never appear; `ChordMonitor` displays `"--"` gracefully with no `"LIVE HARMONICS"` badge or errors |
| P3 | Sibling mixer controls & song-switch teardown | `/` (`http://localhost:3001`) | Toggle `VOCALS`/`DRUMS`/`BASS`/`INST` mute buttons, adjust `MASTER` fader, switch between songs, and open `DEBUG` console | Sibling mute/fader controls operate normally; switching songs stops playback, resets position cleanly, and produces zero console errors |
