# Context Bundle — Phase 1: Memory & Data Hygiene (`TASK-001`)

## Relevant Files

| File | Why It's Relevant |
|------|------------------|
| `src/utils/audioCache.ts` | Defines `CACHE_NAME` (`"himay-stems-v1"`), `cacheSongStems`, and `getCachedUrl`; line 28 calls `URL.createObjectURL(blob)` with no `URL.revokeObjectURL()` lifecycle tracking. |
| `src/hooks/useAudioEngine.ts` | Sole runtime playback caller of `getCachedUrl` (`loadStems`, lines 40-45); disposes `Tone.Players` on song reload (lines 47-49) but never revokes prior blob URLs or disposes `players.current` on unmount/deselection. |
| `src/types/index.ts` | Defines `Stem` (lines 1-6) and `Song` (lines 8-14) interfaces; lacks `ChordEntry` and optional `chords?: ChordEntry[]` property. |
| `public/songs.json` | Song manifest (10 entries, `"01"`–`"10"`); Song `"01"` (lines 2-12) omits `"key"` and none of the entries include `"chords"` yet. |
| `src/components/ChordMonitor.tsx` | Holds local `ChordEntry` interface (lines 18-21), `CHROMATIC_SCALE` + `getTransposedLabel` transposition logic (lines 3-16, 60-85), timeline lookup `useMemo`s (lines 88-104), `localStorage` (`chords_${songId}`) persistence, and scan trigger UI. |
| `src/components/Mixer.tsx` | Loads `/songs.json` (lines 46-56), duplicates `"himay-stems-v1"` cache check (lines 58-79) and `NOTES` array (line 15), implements `handleChordScan` with duplicate `AudioContext`/`decodeAudioData` + `getCachedUrl` (lines 91-180), and wires `<ChordMonitor />` (lines 314-320). |
| `src/utils/chordScanner.ts` | Unused module (`0` importers across `src/`) containing `scanTrackForChords` with redundant `new AudioContext()` + `decodeAudioData()` and flawed time-domain peak-as-FFT pitch detection. |
| `src/styles/ChordMonitor.css` | Styles for `ChordMonitor` performance display (lines 1-110) and setup/scanner UI (`.reset-button`, `.setup-view`, `.gen-btn`, `.scanner-container`, `.progress-track`, `.progress-fill`). |
| `pbi-docs/PBI-20261120-audio-engine-optimization.md` | Authoritative spec for Phase 1 Tasks 1.1–1.3 (lines 55-153), Acceptance Criteria (lines 350-360), and Design Grill decisions Q1.4–Q1.5 (lines 420-421). |
| `tsconfig.app.json` | Enforces `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `verbatimModuleSyntax: true`, and `erasableSyntaxOnly: true` (affects TypeScript imports and class syntax). |
| `package.json` | Defines `build` (`tsc -b && vite build`) and `lint` (`eslint .`) verification scripts; no unit test runner is installed. |

## Reuse Candidates

- `src/components/ChordMonitor.tsx` lines 3-16 & 60-85 (`CHROMATIC_SCALE` and `getTransposedLabel`) — reuse directly for semitone transposition math when rendering pre-computed manifest chords (note: extend regex if supporting slash-chord bass notes like `"D/F#"` from the PBI).
- `src/components/ChordMonitor.tsx` lines 88-104 (`activeChord`, `prevChord`, `nextChord` `useMemo` hooks) — reuse timeline chord lookup pattern, substituting `chords ?? []` prop for internal `chordMap` state.
- `src/utils/audioCache.ts` line 1 (`CACHE_NAME = "himay-stems-v1"`) & lines 17-36 (`getCachedUrl`) — reuse CacheStorage name constant and fallback-to-CDN error handling when wrapping URL creation in `StemUrlManager`.
- `src/types/index.ts` — promote `ChordEntry` from `src/components/ChordMonitor.tsx` lines 18-21 into `src/types/index.ts` so `Song.chords?: ChordEntry[]` and `ChordMonitor` share one canonical type (avoiding duplicate interface definitions).
- Standard Web Platform APIs (`URL.createObjectURL`, `URL.revokeObjectURL`, native `Set<string>`) — covers `StemUrlManager` without new dependencies.
- `src/styles/ChordMonitor.css` lines 1-110 (`.chord-monitor-outer`, `.chord-box-main`, `.performance-layout`, `.chord-primary-center`, `.chord-main-text`, `.chord-prev-preview`, `.chord-next-preview`) — keep existing performance layout styling for chord display and `"--"` fallback state.

## Patterns to Follow

- **Strict Type-Only Imports (`verbatimModuleSyntax: true`):** See `src/hooks/useAudioEngine.ts:3` and `src/components/Mixer.tsx:4` — always use `import type { Song, Stem } from "../types"` (or inline `type` specifier as in `src/components/ChannelStrip.tsx:2`) for types/interfaces.
- **Standard Class Fields (`erasableSyntaxOnly: true`):** In `tsconfig.app.json:23`, TypeScript forbids constructor parameter properties (`constructor(private x)`), `enum`s, and `namespace`s. Declare class fields explicitly on the class body (e.g., `private activeUrls: Set<string> = new Set();` as shown in PBI `StemUrlManager` snippet).
- **Named Utility Exports + Cache Fallback:** See `src/utils/audioCache.ts:17-36` — guard browser globals (`typeof window === "undefined" || !window.caches`), wrap CacheStorage/Blob ops in `try/catch`, log `console.warn`, and fall back to the original CDN `url`.
- **Clean Props & Component Styling:** See `src/components/ChannelStrip.tsx:4-20` and `src/components/ChordMonitor.tsx:23-39` — typed props interface/type above functional component, CSS imported once in `src/main.tsx:4-9`.
- **Hook Cleanup & Cancellation Guard:** See `src/hooks/useAudioEngine.ts:33,89-91` — async effects in `useAudioEngine` use an `isMounted` boolean flag across `await` boundaries to avoid applying stale loads after `selectedSong` changes or unmount.
- **No Unused Imports/Locals (`noUnusedLocals: true`):** When removing `handleChordScan` from `src/components/Mixer.tsx`, also remove the now-unused `getCachedUrl` import on line 5 (`tsc -b` will fail otherwise).

## Anti-Patterns Flagged

- `src/utils/audioCache.ts` line 28: Calls `URL.createObjectURL(blob)` without tracking or calling `URL.revokeObjectURL()`, leaking retained stem blobs across song changes. (Also line 21 hardcodes `"himay-stems-v1"` instead of referencing `CACHE_NAME` on line 1.)
- `src/components/Mixer.tsx` lines 71 & 91-180: Duplicates `caches.open("himay-stems-v1")` (line 71), duplicates `CHROMATIC_SCALE` as `NOTES` (line 15), calls `checkCacheStatus` twice per song selection (`useEffect` line 84 and `handleSongChange` line 191), and implements `handleChordScan` inline with a second `AudioContext` + `decodeAudioData` + unrevoked `getCachedUrl(selectedSong.stems.bass)` call.
- `src/utils/chordScanner.ts` lines 1-70: Dead/unused file (`0` importers) with commented-out `Tone` import (line 1), duplicate `NOTES` array (line 3), redundant `new AudioContext()` + `decodeAudioData` allocation (lines 13-14), and broken time-domain peak-index treated as FFT bin (`maxIdx * (sampleRate / buffer.length)` on line 66).
- `src/components/ChordMonitor.tsx` lines 47-53, 112, 116, 127: Uses `localStorage` (`chords_${songId}`) with unguarded `JSON.parse(saved)` (line 49), fails to reset `chordMap` when `songId` becomes `undefined` (lines 46-53), and uses `eslint-disable-next-line @typescript-eslint/no-explicit-any` (line 112; also in `src/components/Mixer.tsx` lines 100 & 237) — do not replicate `explicit-any` or unguarded `JSON.parse`.
- `src/components/ChordMonitor.tsx` line 65 (`getTransposedLabel`): Regex `/^([A-G][b#]?)(.*)$/` only captures and transposes the root note; for slash chords such as `"D/F#"` (specified in PBI lines 110 & 138), `/F#` is treated as part of `quality` and left un-transposed.
- `public/songs.json` lines 2-12 (Song `"01"`): Omits `"key"` property even though `Song` interface (`src/types/index.ts:12`) requires `key: string` and `Mixer.tsx:85,203` reads `selectedSong.key` directly (producing `undefined` / `NOTES.lastIndexOf(undefined)` = `-1`).

## MEMORY.md Notes

N/A (`MEMORY.md` does not exist at `/home/james2898/projects/himay/MEMORY.md` or `/home/james2898/projects/himay-phase1/MEMORY.md`).
