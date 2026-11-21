# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — 2026-11-20

### Added
- Added `StemUrlManager` and `stemUrlManager` singleton (`create`, `revoke`, `revokeAll`) in `audioCache.ts` for managed Blob URL lifecycle cleanup (`TASK-002`)
  - Affected files: `src/utils/audioCache.ts`

### Changed
- Refactored `useAudioEngine` in place from `Tone.Players` (full PCM buffer decoding) to low-memory streaming HTML5 `<audio>` elements connected via `MediaElementAudioSourceNode`, split-graph routing (`drums` direct to `Tone.getDestination()`, melodic stems through `Tone.PitchShift`), `canplaythrough` ready barrier, `100ms` master-slave drift synchronization (`drums` primary, `inst` fallback, `>30ms` snap), smooth `GainNode` dB ramping, React 19 StrictMode lifecycle safety, play/pause race protection, and mobile `MediaSession` / `visibilitychange` resilience (`TASK-002`)
  - Affected files: `src/hooks/useAudioEngine.ts`, `src/utils/audioCache.ts`
