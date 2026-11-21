# TASK-002 — Phase 2: Streaming Audio Engine Transition (`useAudioEngine.ts`)

- **Tier:** 1
- **Date Created:** 2026-11-20
- **Status:** In Progress

---

## Feature Summary

Refactor `src/hooks/useAudioEngine.ts` in place to replace memory-heavy `Tone.Players` (~750MB PCM decode causing Android WebView OOM crashes) with low-memory streaming HTML5 `<audio>` elements connected via Web Audio `MediaElementAudioSourceNode` (`createMediaElementSource`), targeting <30MB RAM usage while preserving crisp drum transients and Tone.js pitch shifting. Melodic stems (`vocals`, `bass`, `inst`) route through individual `GainNode`s into a shared `Tone.PitchShift`, while `drums` routes through its own `GainNode` directly to `Tone.getDestination()`, bypassing pitch shifting. Playback readiness is gated on `canplaythrough` across all 4 stems, synchronized via a `100ms` master-slave drift correction loop (`drums` primary, `inst` fallback, `>30ms` snap threshold), smoothly controlled via `GainNode.gain` ramping, and cleaned up with `stemUrlManager.revokeAll()` (adding a fallback stub / `StemUrlManager` export in `src/utils/audioCache.ts` if not yet exported).

---

## Acceptance Criteria

1. **AC-1 (Hook Signature & In-Place Refactor):** `src/hooks/useAudioEngine.ts` is refactored in place preserving its existing input parameter signature (`<must match codebase convention — see context.md "Patterns to Follow">`) and returning the exact object shape consumed by `Mixer.tsx`: `{ isReady, isPlaying, currentTime, transpose, togglePlay, stopPlay, seekTo, updateVolume, toggleMute, changePitch }`. `Tone.Players` and full-file PCM buffer decoding are completely removed.
2. **AC-2 (Persistent Elements, Nodes & Single `createMediaElementSource`):** On hook mount, persistent refs are initialized for 4 `<audio>` (`HTMLAudioElement`) elements (`vocals`, `bass`, `inst`, `drums`), 4 `MediaElementAudioSourceNode`s, 4 `GainNode`s, and 1 `Tone.PitchShift` instance. `createMediaElementSource(el)` is invoked strictly once per `<audio>` element on the active Web Audio context (`Tone.getContext().rawContext` or matching Tone wrapper), guarded against React StrictMode double-mount so `InvalidStateError` is never thrown.
3. **AC-3 (Split-Graph Audio Routing):** Melodic stem source nodes (`vocals`, `bass`, `inst`) connect through their respective `GainNode`s into the shared `Tone.PitchShift` node (`<must match codebase convention — see context.md "Patterns to Follow">` for `PitchShift` options), which routes to `Tone.getDestination()`. The `drums` source node connects through its `GainNode` directly to `Tone.getDestination()` (or raw audio destination), completely bypassing `Tone.PitchShift`. Calling `changePitch` updates `Tone.PitchShift.pitch` and `transpose` state (`<must match codebase convention — see context.md "Patterns to Follow">`) without affecting or delaying the `drums` signal path. *(See **AM-1** below: `drums` `GainNode` MUST route to `Tone.getDestination()`, not `rawCtx.destination`.)*
4. **AC-4 (Song Change Reuse & Cleanup Order):** On song change, the hook reuses the existing 4 `<audio>` elements, 4 `MediaElementAudioSourceNode`s, 4 `GainNode`s, and `Tone.PitchShift` rather than recreating Web Audio nodes. Before loading the new song URLs, active playback is halted (`isPlaying = false`), `isReady` resets to `false`, `currentTime` resets to `0`, all `<audio>` elements are paused and reset, active timers/listeners from the prior load are cleared, `stemUrlManager.revokeAll()` is called cleanly without revoking newly supplied URLs (`<must match codebase convention — see context.md "Patterns to Follow">`), and each element's `.src` is updated to the new stem URL (configured to prevent CORS tainting/silence if remote URLs are used). *(See **AM-3** below for exact detach-before-revoke and parallel `Promise.all` ordering.)*
5. **AC-5 (`canplaythrough` Ready Barrier & Stale-Load Guard):** On song load, the hook tracks `canplaythrough` readiness individually per stem (`vocals`, `bass`, `inst`, `drums`), also accounting for elements already at `readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA` at listener attachment time. `isReady` transitions to `true` only after all 4 `<audio>` elements for the current load generation report `canplaythrough`. Repeated `canplaythrough` events from a single stem (e.g., after seeking) do not satisfy other stems, and stale events from superseded song loads are ignored.
6. **AC-6 (Track Volume & Mute Smooth Ramping):** `updateVolume` and `toggleMute` control individual stem gains via each stem's `GainNode.gain` using smooth Web Audio ramping (`cancelScheduledValues` + `setValueAtTime` anchor + `linearRampToValueAtTime` or `setTargetAtTime`) so no click or zipper artifacts occur. Muting a stem ramps its `GainNode.gain` smoothly to `0` while preserving its stored target volume; unmuting ramps `GainNode.gain` smoothly back to the stored volume converted from the codebase's volume unit (`<must match codebase convention — see context.md "Patterns to Follow">`) to linear gain. Updating volume while muted updates the stored volume without outputting audio until unmuted (`<must match codebase convention — see context.md "Patterns to Follow">`). *(See **AM-4** below.)*
7. **AC-7 (Master Volume Control):** Master volume adjustments (and master mute, if supported via `<must match codebase convention — see context.md "Patterns to Follow">`) operate on `Tone.getDestination()` (`<must match codebase convention — see context.md "Patterns to Follow">`) without overwriting individual stem `GainNode` balances.
8. **AC-8 (Playback Start, Mobile Autoplay / `Tone.start()` & Play-Pause Race Safety):** Calling `togglePlay()` while paused and `isReady === true` awaits `Tone.start()` (resuming suspended Web Audio contexts on user gesture for mobile browsers / Android WebView) and invokes `.play()` across the `<audio>` elements, transitioning `isPlaying` to `true` only while playback intent remains active and playback succeeds. If the user pauses, stops, or switches songs while `Tone.start()` or `el.play()` promises are still pending, or if `el.play()` rejects (e.g., `NotAllowedError` / `AbortError`), all elements are cleanly paused, `isPlaying` stays/reverts to `false`, and no unhandled promise rejections occur. *(See **AM-5** below.)*
9. **AC-9 (Controls Invoked While Loading / `!isReady`):** When `isReady === false`: invoking `togglePlay()` does not start playback (`isPlaying` remains `false`, elements remain paused, and no deferred auto-play occurs when `canplaythrough` later completes); invoking `stopPlay()` keeps `isPlaying = false` and `currentTime = 0`; invoking `seekTo()` safely no-ops without throwing `InvalidStateError` or assigning `NaN` to `el.currentTime`.
10. **AC-10 (100ms Master-Slave Sync Loop & Fallback Clock):** While `isPlaying === true`, a `100ms` interval drives `currentTime` state updates from the master clock and enforces cross-stem synchronization. `drums` is the primary master clock; if `drums` is missing (no `src` / unloaded / errored) or delayed (`readyState < HTMLMediaElement.HAVE_FUTURE_DATA` or paused while `inst` is ready and playing), the clock falls back to `inst`. For each active, non-seeking slave stem whose drift exceeds `30ms` (`Math.abs(slave.currentTime - masterTime) > 0.03`), the loop snaps `slave.currentTime = masterTime`.
11. **AC-11 (Sync Loop Teardown & Natural Track End):** The `100ms` sync interval executes only while `isPlaying === true` and is immediately cleared on pause, `stopPlay()`, song change, hook unmount, or natural track completion (`ended`). Track completion updates playback state according to `<must match codebase convention — see context.md "Patterns to Follow">` without leaving active intervals or triggering continuous drift-snap loops on ended elements.
12. **AC-12 (Seeking While Paused vs While Playing & Clamping):** When `isReady === true`, `seekTo(seconds)` clamps the requested timestamp to `[0, duration]` (guarding against non-finite `duration`), applies the clamped timestamp to `el.currentTime` across all loaded `<audio>` elements, and updates `currentTime` state immediately. When paused (`isPlaying === false`), elements remain paused, `isPlaying` remains `false`, and the `100ms` sync loop does not start. When playing (`isPlaying === true`), playback continues from the seeked timestamp with stems remaining synchronized within `30ms`.
13. **AC-13 (`stopPlay()` Reset):** Calling `stopPlay()` clears the `100ms` sync interval, pauses all 4 `<audio>` elements, resets `el.currentTime = 0` on every element, sets `isPlaying = false`, and resets `currentTime` state to `0`.
14. **AC-14 (Cache Teardown, Unmount Disposal & `audioCache.ts` Fallback Stub):** On hook unmount, all intervals and listeners are cleared, all `<audio>` elements are paused and detached (`removeAttribute('src')` + `load()`), `Tone.PitchShift` and Web Audio nodes are disconnected/disposed, and `stemUrlManager.revokeAll()` is called. `src/utils/audioCache.ts` exports `stemUrlManager` with a `revokeAll()` method (providing a safe fallback stub in `src/utils/audioCache.ts` if not yet exported by Phase 1).
15. **AC-15 (Stem Load Error Handling):** If an `<audio>` element fires an `error` event during load or lacks a valid URL, the hook handles the failure gracefully without unhandled exceptions, prevents falsely marking `isReady = true` (`<must match codebase convention — see context.md "Patterns to Follow">`), and cleans up cleanly on subsequent song change or unmount.

---

## Out of Scope

- Refactoring `Mixer.tsx` UI layout, styling, fader components, or changing the `useAudioEngine` return contract.
- Full Phase 1 IndexedDB/OPFS stem pre-caching, download queue, or cache eviction implementation beyond adding a fallback `stemUrlManager.revokeAll()` stub in `src/utils/audioCache.ts` if missing.
- Replacing `Tone.PitchShift` with a custom `AudioWorklet` or SoundTouch DSP processor.
- Backend audio transcoding, HLS/DASH adaptive streaming manifests, or server-side CORS header changes.
- Waveform visualization, tempo stretching, recording, or audio export features.

### Fallback Behaviors (from Feature Specification)

- **Missing `stemUrlManager` in `src/utils/audioCache.ts`:** If Phase 1 has not yet exported `stemUrlManager` from `src/utils/audioCache.ts`, export a fallback stub `{ revokeAll: () => {} }` (or `StemUrlManager` tracking `create(blob)` + `revokeAll()`) so song-change and unmount teardown execute safely without runtime or TypeScript errors.
- **Unready / Failed Stem Load (`isReady === false`):** Playback controls (`togglePlay`, `stopPlay`, `seekTo`) in `useAudioEngine` safely prevent playback/seeking when `isReady === false`. Note that `Mixer.tsx:300-308` does NOT disable the seeker bar `<input type="range">` when `!isReady` or `!selectedSong`, so `seekTo` must safely no-op.
- **Autoplay Gesture Blocked:** When `Tone.start()` or `el.play()` is rejected due to mobile autoplay policy, `useAudioEngine` pauses any started elements, keeps `isPlaying = false`, and awaits the next user tap without entering an inconsistent playing state.

---

## Relevant Files

| File | Purpose |
|---|---|
| `src/hooks/useAudioEngine.ts` | Target file to refactor in place (`Tone.Players` -> persistent `<audio>` + `MediaElementAudioSourceNode` + split-graph routing + master-slave sync) |
| `src/components/Mixer.tsx` | Sole consumer of `useAudioEngine(selectedSong)`; defines exact return contract, master fader (`dB`), mute map, seeker, and song-change flow |
| `src/components/ChannelStrip.tsx` | Stem fader UI (`-60` to `+6` dB, default `-10` dB) and mute toggle; calls `updateVolume(trackId, db)` directly |
| `src/utils/audioCache.ts` | Provides `getCachedUrl(url)`; currently lacks `stemUrlManager` / `URL.revokeObjectURL` cleanup |
| `src/types/index.ts` | Defines `Stem` (`vocals \| drums \| bass \| inst`) and `Song` interfaces |
| `public/songs.json` | Song manifest (10 Cloudinary MP3 stem songs; exposes missing `key` on song `"01"` edge case) |
| `src/main.tsx` | Wraps `<App />` in React 19 `<StrictMode>` (double-invokes mount effects in dev) |
| `pbi-docs/PBI-20261120-audio-engine-optimization.md` | Authoritative Phase 2 spec & `/design-grill` decisions (`Q1.1`–`Q1.6`) |
| `tsconfig.app.json` | Enforces `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters` |
| `eslint.config.js` | Enforces `eslint-plugin-react-hooks` `flat.recommended` (`^7.0.1`) |

---

## Technical Schema

N/A — no API contract required for this task.

---

## Planning Artifacts

| Artifact | Path | Description |
|---|---|---|
| Feature Specification | `tasks/TASK-002/spec.md` | Acceptance criteria + scope |
| Context Bundle | `tasks/TASK-002/context.md` | Reusable components + patterns |
| Research Notes | `tasks/TASK-002/research.md` | Open questions + decisions |

---

## Implementation Notes

- Read `docs/coding-guidelines.md` before writing any code (if present in this project).
- Read `docs/tech-stack.md` before choosing any library or package (if present in this project).
- Read `docs/structure.md` before creating any new file or directory (if present in this project).
- **Exact Hook Signature & Return Contract (`src/hooks/useAudioEngine.ts` <-> `src/components/Mixer.tsx:32-43`):**
  - Input: `useAudioEngine(selectedSong: Song | null)`
  - Stem key tuple: `STEM_KEYS: (keyof Stem)[] = ["vocals", "drums", "bass", "inst"]`
  - Return object:
    - `isReady: boolean`
    - `isPlaying: boolean`
    - `currentTime: number`
    - `transpose: number`
    - `togglePlay: () => Promise<void>` (or `() => void | Promise<void>`)
    - `stopPlay: () => void`
    - `seekTo: (time: number) => void`
    - `updateVolume: (track: keyof Stem | "master", db: number) => void`
    - `toggleMute: (track: keyof Stem, shouldMute: boolean) => void`
    - `changePitch: (semitones: number) => void` (clamped to `[-12, 12]`, updates `pitchShift.current.pitch = clamped` and `transpose` state)
- **Fader Units, dB-to-Gain Conversion & Persistent Fader State (`ChannelStrip.tsx` & `Mixer.tsx`):**
  - UI faders pass **dB**, NOT linear `0..1` gain:
    - Stems (`ChannelStrip.tsx:21, 36, 42-48`): `[-60, 6]`, step `1`, `defaultValue="-10"`, `-60` renders as `"-∞"`.
    - Master (`Mixer.tsx:22, 242-246, 350-362`): `[-60, 6]`, step `0.5`, `defaultValue="0"`, `-60` renders as `"-∞"`.
  - Stem `GainNode.gain` linear conversion: `db <= -60 ? 0 : Tone.dbToGain(db)` (or `Math.pow(10, db / 20)`). Note `+6 dB` equals linear gain `~1.995` — do **not** clamp linear gain to `1.0`.
  - Smooth ramping on stem `GainNode.gain`: use `gainParam.cancelScheduledValues(now)`, `gainParam.setValueAtTime(gainParam.value, now)`, then `gainParam.linearRampToValueAtTime(targetGain, now + 0.02)` (or `setTargetAtTime`).
  - Master volume (`updateVolume("master", db)`): operate on `Tone.getDestination().volume` (Tone's `.volume` takes **dB** directly: `-Infinity` when `db <= -60`, else `db`; ramp via `.rampTo(...)` or set `.value`).
  - Persist stem target dB (`default -10` dB per stem) and mute flags across song changes; `ChannelStrip` does not re-emit `onVolumeChange` on mount, unmute, or song switch.
- **Web Audio Split-Graph & React 19 StrictMode (`src/main.tsx:13`):**
  - Pinned packages (`package-lock.json`): `tone@^15.1.22` + `standardized-audio-context@25.3.77`. No new dependencies needed.
  - Inside the mount `useEffect`, create 4 fresh `HTMLAudioElement`s (`el.crossOrigin = "anonymous"`, `el.preload = "auto"`), create 4 `MediaElementAudioSourceNode`s via `rawCtx.createMediaElementSource(el)`, 4 `GainNode`s, and 1 `Tone.PitchShift`.
  - Connect melodic stems (`vocals`, `bass`, `inst`): `source -> gain -> Tone.PitchShift -> Tone.getDestination()`.
  - Connect `drums`: `source -> gain -> Tone.getDestination()` (bypasses `Tone.PitchShift` while obeying `Tone.getDestination().volume` master control).
  - StrictMode cleanup on unmount: clear intervals/listeners, `el.pause()`, `el.removeAttribute("src")`, `el.load()`, disconnect `source`/`gain` nodes, dispose `Tone.PitchShift`, clear refs, and call `stemUrlManager.revokeAll()`.
- **Song Loading, `canplaythrough` Barrier, 100ms Sync Loop:**
  - Use a load generation / cancellation ref (`loadIdRef`) to discard stale async `getCachedUrl` resolutions and stale `canplaythrough` / `error` callbacks.
  - Track `canplaythrough` individually per stem (`Set` or boolean map per `loadId`), also checking `el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA` immediately after setting `el.src` and attaching listeners.
  - `100ms` sync interval (`window.setInterval(..., 100)`): runs only while `isPlaying === true`; reads `masterTime` from `drums` (falling back to `inst` if `drums` has no `src`/errored, `readyState < HTMLMediaElement.HAVE_FUTURE_DATA`, or is paused while `inst` is ready and playing); updates `currentTime` state; for each active non-seeking slave stem where `Math.abs(slave.currentTime - masterTime) > 0.03`, snaps `slave.currentTime = masterTime`.
- **Audio Cache (`src/utils/audioCache.ts`):**
  - `getCachedUrl(url)` returns `"blob:..."` or remote Cloudinary CDN URL.
  - Export `stemUrlManager` (with `create(blob: Blob): string` tracking created URLs and `revokeAll(): void` revoking and clearing them) and route `getCachedUrl` through `stemUrlManager.create(blob)`. Use `CACHE_NAME` instead of hardcoded `"himay-stems-v1"` when touching `getCachedUrl`.
- **TypeScript & ESLint Constraints:**
  - `tsconfig.app.json`: `strict`, `verbatimModuleSyntax` (use `import type { Song, Stem } from "../types"`), `erasableSyntaxOnly` (no `enum` or constructor parameter properties), `noUnusedLocals`, `noUnusedParameters`.
  - `eslint.config.js`: `eslint-plugin-react-hooks` `flat.recommended` (`^7.0.1`).

### MEMORY.md Prevention Rules (inlined — do not re-read MEMORY.md)

> _Copied verbatim from `context.md` → MEMORY.md Notes. This is the canonical list of past-bug prevention rules for `@fullstack-developer`, `@release-manager`, and `@validator-agent`. They MUST NOT re-read `MEMORY.md` directly; trust this list._

- `MEMORY.md` does not exist in the worktree (`docs/structure.md` and `docs/coding-guidelines.md` are also absent; `docs/` contains only `IMPLEMENTATION_ROADMAP.md`). The primary primary repository was not read per worktree isolation directive.

---

## Amendments (from Context Bundle)

> _Added by `@task-logger` after reconciling `spec.md` against `context.md`. These criteria were not in the original spec but are required based on anti-patterns or MEMORY.md notes found during codebase exploration._

- **AM-1 (Resolves AC-3 Contradiction — `drums` Must Connect to `Tone.getDestination()`, Not `rawCtx.destination`):** AC-3 stated `drums` connects to `"Tone.getDestination() (or raw audio destination)"`. Per `context.md` Exact Seams §4 & Anti-Patterns Flagged (`src/hooks/useAudioEngine.ts:19, 66, 72, 185` vs `pbi-docs/PBI-20261120-audio-engine-optimization.md:201`), master volume operates via `Tone.getDestination().volume`. Connecting `drums` directly to `rawCtx.destination` bypasses `Tone.getDestination()` so the master fader would not affect drums. **Substituted requirement:** `drums` `GainNode` MUST connect to `Tone.getDestination()` (e.g., via `Tone.connect(drumsGain, Tone.getDestination())`), never directly to `rawCtx.destination` alone.
- **AM-2 (React 19 StrictMode Safe Mount/Cleanup Lifecycle):** Per `context.md` Exact Seams §5 (`src/main.tsx:13`), `<StrictMode>` double-invokes mount `useEffect` in dev, and `rawCtx.createMediaElementSource(el)` throws `InvalidStateError` if called twice on the same `HTMLAudioElement`. Create fresh `<audio>` elements inside the mount `useEffect`, and in cleanup pause them, clear `src` (`removeAttribute("src")` + `load()`), disconnect all nodes, and dispose `Tone.PitchShift` so remount never reuses a bound `<audio>` element.
- **AM-3 (Parallel Stem URL Resolution & Detach-Before-Revoke Order):** Per `context.md` Anti-Patterns Flagged (`src/hooks/useAudioEngine.ts:40-45`, `src/utils/audioCache.ts:28`) and Exact Seams §3, resolve all 4 stem URLs in parallel via `Promise.all` (never sequential `await`s). On song change, pause and detach old `<audio>` elements (`el.pause()`, `el.removeAttribute("src")`, `el.load()`) and invoke `stemUrlManager.revokeAll()` **before** invoking `getCachedUrl(...)` for the new song so old `blob:` URLs are detached prior to revocation and newly minted `blob:` URLs are never revoked.
- **AM-4 (Pre-Ready Volume/Mute Updates & `-10 dB` Default):** Per `context.md` Exact Seams §2 (`src/hooks/useAudioEngine.ts:182`, `ChannelStrip.tsx:21, 50-55`, `Mixer.tsx:182-195`), do NOT return early in `updateVolume` or `toggleMute` when `!isReady`. Initialize each stem's stored target volume to `-10` dB (matching `ChannelStrip` `defaultValue="-10"`) and update both stored refs and persistent `GainNode`s regardless of `isReady`, so `toggleMute(track, false)` restores the stored target dB instead of `0 dB` (`1.0`).
- **AM-5 (Play-State Race & Stale-Closure Prevention in `togglePlay`):** Per `context.md` Anti-Patterns Flagged (`src/hooks/useAudioEngine.ts:122-137`), do NOT call `setIsPlaying((prev) => !prev)` and then branch on a stale `isPlaying` closure. Maintain an imperative playback-intent ref (`isPlayingRef` / attempt token) and derive `isPlaying` state strictly from verified `Tone.start()` + `Promise.all(play())` completion or synchronous `pause()`.
- **AM-6 (Strict TS / React Hooks Lint & `CACHE_NAME` Cleanup):** Per `context.md` Relevant Files (`tsconfig.app.json`, `eslint.config.js`) and Anti-Patterns (`src/utils/audioCache.ts:21`), use `import type`, avoid non-erasable TypeScript syntax (`enum`, parameter properties), keep `react-hooks` rules satisfied, and replace the hardcoded `"himay-stems-v1"` string in `audioCache.ts:21` with the `CACHE_NAME` constant if editing `getCachedUrl`.

---

## Resolved Open Questions

- **Hook Input & URL Resolution Order:** `useAudioEngine(selectedSong: Song | null)` resolves `selectedSong.stems[stem]` (`vocals | drums | bass | inst`) internally via `getCachedUrl` in `src/utils/audioCache.ts` using `Promise.all`. Detaching old `<audio>` `src` and calling `stemUrlManager.revokeAll()` before `getCachedUrl` prevents revoking incoming `blob:` URLs. (Source: `context.md` → Exact Seams §1, §3)
- **Parameter Types, Volume Units, `changePitch` & Master API:** `STEM_KEYS = ["vocals", "drums", "bass", "inst"]`; `updateVolume(track: keyof Stem | "master", db: number)` receives dB (`[-60, 6]`, `-60` = silence); stem `GainNode.gain` converts via `Tone.dbToGain(db)` (with `db <= -60 ? 0 : ...`, `+6 dB ≈ 1.995`); master controls `Tone.getDestination().volume` in dB; `toggleMute(track: keyof Stem, shouldMute: boolean)` is stem-only; `changePitch(semitones: number)` clamps to `[-12, 12]`. (Source: `context.md` → Exact Seams §1, §2, §4 & Reuse Candidates)
- **`audioCache.ts` State & CORS Requirement:** `src/utils/audioCache.ts` currently exports only `cacheSongStems` and `getCachedUrl` (no `stemUrlManager` yet). `getCachedUrl` returns `"blob:..."` or remote CDN HTTP URLs (`public/songs.json`), so `<audio>` elements must set `crossOrigin = "anonymous"` before assigning `.src`. Export `stemUrlManager` (`create` + `revokeAll`) in `src/utils/audioCache.ts`. (Source: `context.md` → Exact Seams §3 & Relevant Files)
- **Volume/Mute Persistence Across Song Changes:** `Mixer.tsx:182-195` does not reset `mutedTracks`, `masterVolume`, or `ChannelStrip` sliders (`defaultValue="-10"`) on song switch, so `useAudioEngine` must preserve stored stem target dB (initial `-10` dB) and mute states across song changes. (Source: `context.md` → Exact Seams §2)

## Unresolved Pending Reconciliation

- **Existing `ended`, `error`, and `transpose`-Reset Conventions:** `context.md` did not capture how the existing `src/hooks/useAudioEngine.ts` handles natural track end (`ended` — e.g. reset `currentTime` to `0` vs pause at `duration`), partial/missing stem errors, or whether `transpose` resets to `0` on song change. Developer must read `src/hooks/useAudioEngine.ts` before coding to confirm existing behavior. (Suggested grep/read target: `src/hooks/useAudioEngine.ts`)
- **`Tone.PitchShift` Constructor Options & `Tone.connect` TypeScript Types:** `node_modules` is absent in the worktree, and `context.md` did not quote the exact `new Tone.PitchShift({...})` options or verify `Tone.getContext().rawContext` (`AnyAudioContext` vs `AudioContext` from `standardized-audio-context`) type compatibility with `Tone.connect(nativeGainNode, pitchShift)`. Developer must read `src/hooks/useAudioEngine.ts` for existing `PitchShift` options and run `tsc -b` to verify Tone v15 types. (Suggested grep/read target: `src/hooks/useAudioEngine.ts`, `node_modules/tone`)

---

## Live Verification

### Live Verification Report — TASK-002

| # | Case | Expected | Toast / Events (recorded) | Network | UI state | Verdict |
|---|------|----------|---------------------------|---------|----------|---------|
| 1 | Initial Load & Song Selection (`"02"`) | Renders `HIMAY`, song dropdown (11 options), disabled Play initially; selecting Song `"02"` clears `canplaythrough` barrier across 4 stems and enables Play (`▶`) | `0` error toasts; `0` JS/audio errors | `GET /songs.json` `[200]`; 4x Cloudinary MP3 stems `[206]` | `playBtnDisabled: false`, `playBtnText: "▶"`, duration `6:07` (`max="367"`), `PITCH: 0 KEY: D` | PASS |
| 2 | Playback Transport & Play/Pause State | Clicking Play enters playing state (`Ⅱ`, `active-play`) and advances timer; clicking Pause restores `▶` and stops timer | `0` error toasts; `0` JS/audio errors | Streaming MP3 range `[206]` | Playing: `playBtnText: "Ⅱ"`, `active-play`, timer `0:00` -> `0:04` (`4.2`) -> `0:09` (`9.1`); Paused: `playBtnText: "▶"`, timer held steady at `16.9` (`0:16`) over `1200ms` | PASS |
| 3 | Channel Volume & Mute (`VOCALS`, `DRUMS`, `BASS`, `INST`, `MASTER`) | Toggling mute adds `.muted` and disables channel fader; unmuting restores glow; adjusting faders updates dB/-∞ readouts | `0` error toasts; `0` JS/audio errors | N/A (client Web Audio `GainNode` & `Tone.Destination` ramps) | `VOCALS` & `DRUMS` muted (`hasMutedClass: true`, `sliderDisabled: true`) and unmuted cleanly; `BASS` `-24dB` -> `-∞`, `INST` `3dB`, `MASTER` `-6dB` | PASS |
| 4 | Pitch Shifting / Transpose (`+`, `-`, `RESET`) | Clicking `+` / `-` / `RESET` updates `transpose` indicator (`+1`, `0`, `-1`) and computed key | `0` error toasts; `0` JS/audio errors | N/A (client `Tone.PitchShift.pitch`) | `PITCH: 0 KEY: D` -> `PITCH: +1 KEY: D#` -> `PITCH: 0 KEY: D` -> `PITCH: -1 KEY: C#` -> `PITCH: 0 KEY: D` | PASS |
| 5 | Seeking (Paused & Playing) + Stop Reset | Seeking while paused updates `currentTime` without starting playback; seeking while playing jumps and advances synchronously; Stop resets to `0:00` | `0` error toasts; `0` JS/audio errors | Streaming MP3 range `[206]` | Paused seek `30` (`0:30`, `stayedPaused: true`); resumed playing to `35.7` (`0:35`), seeked while playing to `60.2` (`1:00`) -> advanced synchronously to `61.7` (`1:01`) after `1500ms` (`"Ⅱ"`); Stop reset to `0` (`0:00`, `"▶"`) | PASS |
| 6 | Song Switch (`"02"` -> `"01"`) & Console/Audio Error Audit | Reuses persistent `<audio>`/`MediaElementAudioSourceNode`s cleanly on song switch, handles missing `key`, zero `InvalidStateError` or unhandled rejections | `0` JS errors; `0` unhandled rejections; `0` console errors; `67` pre-gesture Web Audio autoplay warnings only | 4x Song `"01"` Cloudinary MP3 stems `[206]` | Song `"01"` ready (`8:51`, `"▶"`, `PITCH: 0 KEY:`), persisted fader readouts (`-∞`, `3dB`, `-6dB`), MediaSession album `"Himay Rehearsal Player"`, played to `0:06` & stopped cleanly | PASS |

**Overall Verdict:** PASS
**Seeded/Cleaned:** N/A (read-only static song manifest + Cloudinary streaming stems; no backend entities created or mutated).
**Personal Data:** None present — song IDs/titles and DOM/network status evidence only.
**Screenshots:** Omitted (default).

### Prioritized Manual Verification Guide

| Priority | Target / Flow | Route / Entry Point | Action | Expected Result |
|---|---|---|---|---|
| P1 | Core Streaming Playback & Sync | `http://localhost:5173/` | Select Song `"02"`, wait for `▶` to enable, click `▶`, listen across 15s, seek to `1:00`, click `■` | All 4 stems play in tight sync (`<30ms`), seek jumps cleanly without stutter, Stop resets timer to `0:00` |
| P1 | Split-Graph Pitch Shifting & Channel Mixing | `http://localhost:5173/` | While playing, click `+` twice (`PITCH: +2`), mute `VOCALS`, lower `BASS` fader, adjust `MASTER` fader | Melodic stems pitch up cleanly while `DRUMS` stays unshifted/punchy; `MASTER` scales all stems including drums |
| P2 | Song Switch & Missing-Key Edge Case | `http://localhost:5173/` | While playing Song `"02"`, select Song `"01"` (`Langit + Sapat Na At Higit Pa`), wait for `▶`, press Play | Playback halts on switch, `PITCH` resets to `0`, existing channel fader settings persist, Song `"01"` loads and plays without errors |
| P3 | Mobile / Background Resilience & Offline Cache | `http://localhost:5173/` | Click `↓` to cache stems offline, switch browser tabs during playback, return to tab | Download marks `✓` after caching; returning to tab resumes `AudioContext` cleanly without console errors |

## Resolution

- **Completed:** 2026-11-20
- **Branch:** feature/phase2-streaming-engine
- **Base branch:** main
- **Files changed:**
  - `src/utils/audioCache.ts` — Added `StemUrlManager` and exported singleton `stemUrlManager` with `create(blob)`, `revoke(url)`, and `revokeAll()`; updated `getCachedUrl` to use `stemUrlManager.create(blob)` and replaced hardcoded cache name with `CACHE_NAME`.
  - `src/hooks/useAudioEngine.ts` — Refactored in place to replace `Tone.Players` with streaming HTML5 `<audio>` elements and `MediaElementAudioSourceNode`s; implemented split-graph audio routing, React 19 StrictMode lifecycle handling, `canplaythrough` ready barrier, 100ms master-slave sync loop, smooth volume/mute ramping, and mobile resilience. Resolved Fix Loop 1 review/validation blockers (TS strict null narrowing, race condition in `togglePlay`, blob URL leak on aborted loads, stem ended premature termination, audio ramp anchor clicks, visibility change error handling, and MediaSession key fallback).
- **Diff Summary:**
  - `src/utils/audioCache.ts` L3–28 — Export `StemUrlManager` with `create`, `revoke`, and `revokeAll`, and singleton `stemUrlManager` (AC-14, AM-6, Fix Loop 1)
  - `src/utils/audioCache.ts` L50 — Replace hardcoded `"himay-stems-v1"` string with `CACHE_NAME` constant (AM-6)
  - `src/utils/audioCache.ts` L57 — Route cached blob URL creation through `stemUrlManager.create(blob)` (AC-14, AM-6)
  - `src/hooks/useAudioEngine.ts` L4 — Import `stemUrlManager` from `../utils/audioCache` (AC-14)
  - `src/hooks/useAudioEngine.ts` L7–17 — Declare stem keys, initial dB (`-10`), silence threshold (`-60`), sync timing constants, and `dbToLinear` converter (AC-6, AC-10)
  - `src/hooks/useAudioEngine.ts` L20–42 — Persistent refs for 4 `<audio>` elements, 4 sources, 4 gains, 1 pitchShift, fader state, playback intent, and generation counters (AC-2, AM-4, AM-5)
  - `src/hooks/useAudioEngine.ts` L50–121 — Mount effect: initialize Web Audio graph, split routing (`drums` to `Tone.getDestination()`, melodic to `PitchShift`), and StrictMode disposal with request invalidation (AC-2, AC-3, AM-1, AM-2, Fix Loop 1)
  - `src/hooks/useAudioEngine.ts` L123–295 — Song change effect: detach-before-revoke, parallel URL resolution with leak cleanup on cancel, and per-stem `canplaythrough` ready barrier with error/stale guards (AC-4, AC-5, AC-14, AC-15, AM-3, Fix Loop 1)
  - `src/hooks/useAudioEngine.ts` L297–401 — 100ms master-slave synchronization loop (`drums` primary, `inst` fallback, `30ms` drift snap) and master/all-ended track completion with TS strict null safety (AC-10, AC-11, Fix Loop 1)
  - `src/hooks/useAudioEngine.ts` L403–520 — Playback transport controls (`togglePlay`, `stopPlay`, `seekTo`, `changePitch`) with `Tone.start()`, play-pause race safety with superseded request early-exit, `!isReady` guards, and range clamping (AC-1, AC-8, AC-9, AC-12, AC-13, AM-5, Fix Loop 1)
  - `src/hooks/useAudioEngine.ts` L522–588 — Smooth volume and mute ramping on `GainNode.gain` reading `currentGain` before cancellation, stored target dB persistence across song changes, and master volume control (AC-6, AC-7, AM-4, Fix Loop 1)
  - `src/hooks/useAudioEngine.ts` L590–660 — Mobile resilience: `MediaSession` metadata with song key fallback, idempotent action handlers, and `visibilitychange` auto-resume with `Tone.start()` and element pause cleanup (Fix Loop 1)
- **Notes:**
  - `Tone.Players` and all full-file PCM buffer decoding have been completely removed, preventing Android WebView OOM crashes.
  - Drums connect directly to `Tone.getDestination()` via `Tone.connect(gain, Tone.getDestination())`, keeping drum transients punchy and unshifted while remaining fully responsive to master volume changes.
  - Resolved all Review & Validation blockers and quality warnings from round 1:
    1. Fixed strict TypeScript TS2531/TS18047 null-check error in `handleEnded` by capturing `elements` and null-checking upfront.
    2. Fixed race condition in `togglePlay` by returning early on superseded requests (`requestId !== playRequestIdRef.current`) without clobbering state or pausing elements; added request invalidation on unmount.
    3. Added `revoke(url)` to `StemUrlManager` and clean up newly created blob URLs if song loading is cancelled during resolution.
    4. Fixed premature track termination on shorter stems: `handleEnded` only stops the song if the master stem or all active stems have ended.
    5. Fixed Web Audio ramp anchor clicks: reads `currentGain` before `cancelScheduledValues(now)` in both `updateVolume` and `toggleMute`.
    6. Improved `visibilitychange` error path by using `await Tone.start()` and pausing `<audio>` elements if resume fails.
    7. Handled missing song key in MediaSession album metadata and made action handlers idempotent.
  - In accordance with the project instructions and safety guards, no git commits or autonomous branch switches were made; all files are staged in the worktree on branch `feature/phase2-streaming-engine`.
