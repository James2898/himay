# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Centralized Blob Object URL lifecycle management (`StemUrlManager` and `stemUrlManager` singleton with `create`, `revoke`, `revokeAll`, and `urls` getter) in `src/utils/audioCache.ts` (`TASK-001`, `TASK-002`)
  - Affected files: `src/utils/audioCache.ts`
- Added `ChordEntry` interface and optional `chords?: ChordEntry[]` on `Song` in `src/types/index.ts`, and pilot pre-computed chord manifest data (`"key": "G"`, `"duration": 531`, `"chords"`) for Song 01 in `public/songs.json` (`TASK-001`)
  - Affected files: `src/types/index.ts`, `public/songs.json`

### Changed
- Refactored `useAudioEngine` in place from `Tone.Players` (full PCM buffer decoding ~750MB) to low-memory streaming HTML5 `<audio>` elements connected via `MediaElementAudioSourceNode` (<30MB RAM), split-graph routing (`drums` direct to `Tone.getDestination()`, melodic stems through `Tone.PitchShift`), `canplaythrough` ready barrier, `100ms` master-slave drift synchronization (`drums` primary, `inst` fallback, `>30ms` snap), smooth `GainNode` dB ramping, React 19 StrictMode lifecycle safety, play/pause race protection, and mobile `MediaSession` / `visibilitychange` resilience (`TASK-002`)
  - Affected files: `src/hooks/useAudioEngine.ts`, `src/utils/audioCache.ts`
- Streamlined `ChordMonitor` to resolve active/prev/next chords directly from `selectedSong?.chords` with graceful `"--"` fallback and slash-chord bass note transposition in `getTransposedLabel`, integrated `stemUrlManager` teardown (`revoke` / `revokeAll`) and parallel stem URL resolution in `useAudioEngine`, and removed scan callbacks/props and scanner CSS styles (`TASK-001`)
  - Affected files: `src/components/ChordMonitor.tsx`, `src/hooks/useAudioEngine.ts`, `src/components/Mixer.tsx`, `src/styles/ChordMonitor.css`

### Removed
- Deleted unused client-side chord scanner module (`src/utils/chordScanner.ts`), removed `"GENERATE CHORD MAP"` scan UI, scan `AudioContext`/`decodeAudioData` decoding (`handleChordScan`), and `localStorage` chord map persistence (`TASK-001`)
  - Affected files: `src/utils/chordScanner.ts`, `src/components/ChordMonitor.tsx`, `src/components/Mixer.tsx`, `src/styles/ChordMonitor.css`
