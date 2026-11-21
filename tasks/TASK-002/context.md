# Context Bundle — Phase 2 Streaming Audio Engine (`useAudioEngine.ts`)

## Relevant Files
| File | Why It's Relevant |
|---|---|
| `/home/james2898/projects/himay-phase2/src/hooks/useAudioEngine.ts` | Target file to refactor in place (`Tone.Players` -> persistent `<audio>` + `MediaElementAudioSourceNode` + split-graph routing + master-slave sync) |
| `/home/james2898/projects/himay-phase2/src/components/Mixer.tsx` | Sole consumer of `useAudioEngine(selectedSong)`; defines exact return contract, master fader (`dB`), mute map, seeker, and song-change flow |
| `/home/james2898/projects/himay-phase2/src/components/ChannelStrip.tsx` | Stem fader UI (`-60` to `+6` dB, default `-10` dB) and mute toggle; calls `updateVolume(trackId, db)` directly |
| `/home/james2898/projects/himay-phase2/src/utils/audioCache.ts` | Provides `getCachedUrl(url)`; currently lacks `stemUrlManager` / `URL.revokeObjectURL` cleanup |
| `/home/james2898/projects/himay-phase2/src/types/index.ts` | Defines `Stem` (`vocals \| drums \| bass \| inst`) and `Song` interfaces |
| `/home/james2898/projects/himay-phase2/public/songs.json` | Song manifest (10 Cloudinary MP3 stem songs; exposes missing `key` on song `"01"` edge case) |
| `/home/james2898/projects/himay-phase2/src/main.tsx` | Wraps `<App />` in React 19 `<StrictMode>` (double-invokes mount effects in dev) |
| `/home/james2898/projects/himay-phase2/pbi-docs/PBI-20261120-audio-engine-optimization.md` | Authoritative Phase 2 spec & `/design-grill` decisions (`Q1.1`–`Q1.6`) |
| `/home/james2898/projects/himay-phase2/tsconfig.app.json` | Enforces `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters` |
| `/home/james2898/projects/himay-phase2/eslint.config.js` | Enforces `eslint-plugin-react-hooks` `flat.recommended` (`^7.0.1`) |

## Exact Seams

### 1. Hook Return Contract (`src/hooks/useAudioEngine.ts:204-215` <-> `src/components/Mixer.tsx:32-43`)
- Input: `(selectedSong: Song | null)`
- Return object (must stay backwards-compatible per PBI `Q1.1`):
  - `isReady: boolean`
  - `isPlaying: boolean`
  - `currentTime: number`
  - `transpose: number`
  - `togglePlay: () => Promise<void>` (or `() => void | Promise<void>`)
  - `stopPlay: () => void`
  - `seekTo: (time: number) => void`
  - `updateVolume: (track: keyof Stem | "master", db: number) => void`
  - `toggleMute: (track: keyof Stem, shouldMute: boolean) => void`
  - `changePitch: (semitones: number) => void`
-Note for Phase 3 (`Q1.6` auto-resume toast): `Mixer.tsx:32-43` currently has no toast state/component; any new optional field returned by `useAudioEngine` (e.g., resume notice) must not break existing destructuring.

### 2. Volume & Mute Parameter Shapes (`Mixer.tsx` & `ChannelStrip.tsx` <-> `useAudioEngine.ts`)
- **Units are dB, NOT linear gain:**
  - `ChannelStrip.tsx:21, 36, 42-48`: stem fader range is `min="-60"`, `max="6"`, `step="1"`, `defaultValue="-10"`. `-60` renders as `"-∞"`. Calls `onVolumeChange(trackId, val)` where `trackId: keyof Stem` and `val` is dB (`[-60, 6]`).
  - `Mixer.tsx:22, 242-246, 350-362`: master fader range is `min="-60"`, `max="6"`, `step="0.5"`, `defaultValue="0"`. `-60` renders as `"-∞"`. Calls `updateVolume("master", val)`.
  - Conversion needed for Web Audio `GainNode.gain`: `Tone.dbToGain(db)` (or `db <= -60 ? 0 : Math.pow(10, db / 20)` — note `+6 dB` is linear gain `~1.995`, not clamped to `1.0`).
- **Initial & Persisted Fader State:**
  - `ChannelStrip` starts at `-10 dB` (`defaultValue="-10"`) and does NOT call `onVolumeChange` on mount, on unmute, or on song change (`Mixer.tsx:182-195` does not reset `mutedTracks`, `masterVolume`, or `ChannelStrip` sliders when switching songs).
  - `ChannelStrip.tsx:50-55` disables the slider while `isMuted` is true. Therefore `useAudioEngine` must store each stem's active dB/gain (initialized to `-10 dB` to match `ChannelStrip` UI, or `-10 dB` gain when unmuted) so `toggleMute(track, false)` restores the pre-mute gain instead of resetting to `0 dB` (`1.0`).
  - `useAudioEngine.ts:182` previously returned early on `updateVolume` if `!isReady`; with persistent `GainNode`s created on mount, allowing `updateVolume` / `toggleMute` to update stored gain refs even before song load prevents lost fader moves before `isReady`.

### 3. Audio Cache & Blob URL Lifecycle (`src/utils/audioCache.ts:1-36`)
- Currently exports **only** `cacheSongStems` and `getCachedUrl` (no `stemUrlManager` or `StemUrlManager` exists on `feature/phase2-streaming-engine` yet, because `feature/phase1-cache-chords` points to the same base commit `5a18761`).
- `getCachedUrl(url)` (`line 28`) currently calls `URL.createObjectURL(blob)` directly and returns either `"blob:..."` or the original CDN `url`.
- **Fallback/Stub Seam:** Either:
  1. Export `StemUrlManager` / `stemUrlManager` (with `create(blob)` + `revokeAll()`) in `src/utils/audioCache.ts` and route `getCachedUrl` through `stemUrlManager.create(blob)` (matching PBI Task 1.1), **or**
  2. Keep `audioCache.ts` untouched if Phase 2 must stay isolated from Phase 1, and track returned `blob:` URLs inside `useAudioEngine.ts` (revoking via `URL.revokeObjectURL(u)` when `u.startsWith("blob:")` on song change/unmount, or importing/stubbing a local `revokeAll()` helper).
  - Beware: if revoking old blob URLs on song change while `<audio>` elements still reference them, assign new `el.src` (or clear `el.removeAttribute("src")` / `el.src = ""`) before revoking the old `blob:` URLs so the old blob is detached first.

### 4. Tone.js (`^15.1.22`) & Web Audio Split-Graph Routing
- `package-lock.json:3376,3322` pins `tone@15.1.22` + `standardized-audio-context@25.3.77`.
- **Master Volume / Split-Graph Seam (Critical Discrepancy in PBI):**
  - Currently `useAudioEngine.ts:19, 66, 72, 185` routes `drums` -> `Tone.getDestination()` and melodic stems -> `Tone.PitchShift` -> `Tone.getDestination()`, and `updateVolume("master", db)` ramps `Tone.getDestination().volume`.
  - PBI Task 2.2 prose (`line 177`) says route `drums` GainNode to `Tone.getDestination()`, **but the snippet at `line 201` writes `gain.connect(rawCtx.destination)`**. If `drums` connects to `rawCtx.destination` directly while `pitchShift` connects to `Tone.getDestination()`, `Tone.getDestination().volume` (`updateVolume("master", db)`) will **not** control `drums`! Route `drums` GainNode through `Tone.getDestination()` (or route both `drums` and `pitchShift` through a shared native master `GainNode` -> `rawCtx.destination`) so `"master"` volume controls all 4 stems.
- **Unverified in this worktree (`node_modules` absent):** `node_modules/tone` is not installed in `/home/james2898/projects/himay-phase2`. Verify `Tone.getContext().rawContext` TypeScript type (`AnyAudioContext` vs `AudioContext` from `standardized-audio-context`) and `Tone.connect(nativeGainNode, pitchShift)` runtime/type compatibility when running `tsc -b`.
- **Platform / Browser Built-ins (Lean Change):** Standard Web Audio (`GainNode`, `MediaElementAudioSourceNode`, `AudioContext`), `HTMLAudioElement` (`canplaythrough`, `currentTime`, `play`, `pause`), `URL.revokeObjectURL`, `navigator.mediaSession`, and `document.visibilitychange` are all native platform APIs — zero new packages needed.

### 5. Song Switching, Seeker & StrictMode Lifecycle (`Mixer.tsx` & `main.tsx`)
- `Mixer.tsx:182-195`: `handleSongChange` calls `setSelectedSong(song)` and `stopPlay()` together.
- `Mixer.tsx:300-308`: Seeker bar `<input type="range">` is NOT disabled when `!isReady` or `!selectedSong`; `seekTo` must clamp/guard safely when elements aren't loaded or `Number.isFinite(el.duration)` is false.
- `src/main.tsx:13`: `<StrictMode>` double-invokes mount `useEffect` in dev. `rawCtx.createMediaElementSource(el)` throws `InvalidStateError` if called twice on the same `HTMLAudioElement`. Creating fresh `<audio>` elements inside the mount effect (and pausing/clearing `src` + disconnecting nodes + disposing `PitchShift` in cleanup) avoids reusing an already-bound `HTMLAudioElement` across StrictMode remounts.

## Reuse Candidates
- `src/hooks/useAudioEngine.ts:7` (`STEM_KEYS: (keyof Stem)[] = ["vocals", "drums", "bass", "inst"]`) — keep exact stem key tuple for iteration across elements/gains/sync.
- `src/hooks/useAudioEngine.ts:170-177` (`changePitch`) — clamping `[-12, 12]` and `pitchShift.current.pitch = clamped` logic applies unchanged.
- `src/utils/audioCache.ts:17-36` (`getCachedUrl`) — already handles CacheStorage lookup (`"himay-stems-v1"`), CDN fallback, and SSR/non-HTTPS `window.caches` guard.
- `src/types/index.ts:1-14` (`Stem`, `Song`) — reuse directly as hook input and key typing.
- `tone` (`Tone.dbToGain`, `Tone.connect`, `Tone.start`, `Tone.PitchShift`, `Tone.getContext().rawContext`, `Tone.getDestination()`) + native Web Audio `GainNode.gain.linearRampToValueAtTime` and `HTMLAudioElement` — already installed/native; no new dependencies needed.

## Patterns to Follow
- **Explicit Type Imports & Erasable Syntax:** See `src/hooks/useAudioEngine.ts:3` (`import type { Song, Stem } from "../types";`) — required by `tsconfig.app.json:14,23` (`verbatimModuleSyntax`, `erasableSyntaxOnly`, so no constructor parameter properties or `enum`s).
- **Ref-backed Audio Graph + Async Cancellation Flag:** See `src/hooks/useAudioEngine.ts:10-11, 33, 89-91` — store imperative audio objects in `React.useRef`, guard async stem loading against unmount/stale song switches with a cancellation flag (`let isCancelled = false`), and reset `isReady`/`isPlaying` cleanly.
- **Uncontrolled Range Inputs with dB Readout:** See `src/components/ChannelStrip.tsx:21, 42-48` and `src/components/Mixer.tsx:22, 354-362` — UI faders speak dB (`-60` to `+6`), `-60` means silence (`-∞`).

## Anti-Patterns Flagged
- `src/hooks/useAudioEngine.ts:122-137`: `togglePlay` calls `setIsPlaying((prev) => !prev)` then branches on stale closure `if (!isPlaying)` and calls `setIsPlaying(true/false)` again — do not replicate; derive state transitions cleanly from actual `play()`/`pause()` outcome or a ref/async state guard.
- `src/hooks/useAudioEngine.ts:40-45`: Awaits `getCachedUrl` sequentially per stem (`vocals`, then `drums`, then `bass`, then `inst`) instead of `Promise.all` — avoid sequential awaits when resolving the 4 stem URLs.
- `src/hooks/useAudioEngine.ts:89-91`: Cleanup only sets `isMounted = false` without aborting in-flight load readiness or revoking prior Blob URLs — ensure song switches pause/reset active elements, ignore stale `canplaythrough` listeners, and revoke replaced `blob:` URLs.
- `src/utils/audioCache.ts:28`: Unmanaged `URL.createObjectURL(blob)` without revocation leaks memory across song switches; line 21 also hardcodes `"himay-stems-v1"` instead of `CACHE_NAME` (`line 1`).
- `src/components/Mixer.tsx:99-103, 203` & `src/utils/chordScanner.ts:13-15`: Duplicate standalone `AudioContext` allocations and `NOTES.lastIndexOf(selectedSong?.key)` (unsafe when `key` is absent on Song `01`, returning `-1`) — out of scope for Phase 2 engine refactor, do not touch or replicate.
- `pbi-docs/PBI-20261120-audio-engine-optimization.md:201`: Snippet connects `drums` `GainNode` to `rawCtx.destination` instead of `Tone.getDestination()`, which would bypass `Tone.getDestination().volume` master fader control (`useAudioEngine.ts:185`) — do not replicate.

## MEMORY.md Notes
- `MEMORY.md` does not exist in `/home/james2898/projects/himay-phase2` (`docs/structure.md` and `docs/coding-guidelines.md` are also absent; `docs/` contains only `IMPLEMENTATION_ROADMAP.md`). The primary repository `/home/james2898/projects/himay` was not read per worktree isolation directive.
