# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — 2026-11-20
### Added
- Centralized Blob Object URL lifecycle management (`StemUrlManager` and `stemUrlManager` singleton) in `src/utils/audioCache.ts`, `ChordEntry` interface and optional `chords?: ChordEntry[]` on `Song` in `src/types/index.ts`, and pilot pre-computed chord manifest data (`"key": "G"`, `"duration": 531`, `"chords"`) for Song 01 in `public/songs.json` (`TASK-001`)
  - Affected files: `src/utils/audioCache.ts`, `src/types/index.ts`, `public/songs.json`
### Changed
- Streamlined `ChordMonitor` to resolve active/prev/next chords directly from `selectedSong?.chords` with graceful `"--"` fallback and slash-chord bass note transposition in `getTransposedLabel`, integrated `stemUrlManager` teardown (`revoke` / `revokeAll`) and parallel stem URL resolution in `useAudioEngine`, and removed scan callbacks/props and scanner CSS styles (`TASK-001`)
  - Affected files: `src/components/ChordMonitor.tsx`, `src/hooks/useAudioEngine.ts`, `src/components/Mixer.tsx`, `src/styles/ChordMonitor.css`
### Removed
- Deleted unused client-side chord scanner module (`src/utils/chordScanner.ts`), removed `"GENERATE CHORD MAP"` scan UI, scan `AudioContext`/`decodeAudioData` decoding (`handleChordScan`), and `localStorage` chord map persistence (`TASK-001`)
  - Affected files: `src/utils/chordScanner.ts`, `src/components/ChordMonitor.tsx`, `src/components/Mixer.tsx`, `src/styles/ChordMonitor.css`
