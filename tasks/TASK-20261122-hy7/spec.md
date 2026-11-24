# Spec — Mobile OS & WebView Resilience (Phase 3)

## Feature Summary
Implement Phase 3 (Mobile OS & WebView Resilience) of the Himay Audio Engine Optimization in `src/hooks/useAudioEngine.ts` and `src/components/Mixer.tsx`. The feature integrates the Web `MediaSession` API (song metadata, hardware play/pause/seek action handlers, and playback state syncing) to keep backgrounded Android/Messenger WebView playback alive and controllable from OS lock-screen and headset controls, and adds a `document.visibilitychange` auto-resume listener with a touch-unlock fallback toast when browser autoplay policies block background resumption.

## Acceptance Criteria
1. **MediaSession Capability Guard (`MEMORY.md` BUG-004):** Before accessing `navigator.mediaSession` or `MediaMetadata`, check `typeof navigator !== "undefined"`, `"mediaSession" in navigator`, and `typeof MediaMetadata !== "undefined"`. Environments without `MediaSession` support MUST skip registration safely without throwing runtime errors or interrupting audio playback.
2. **MediaSession Metadata Sync:** Whenever `selectedSong` changes to a valid song, set `navigator.mediaSession.metadata` to a `new MediaMetadata({...})` with:
   - `title`: `selectedSong.title`
   - `artist`: `"Himay Rehearsal Player"`
   - `album`: `selectedSong.key ? `Key of ${selectedSong.key}` : "Himay Stems"`
   - `artwork`: module-hoisted constant `[{ src: "/favicon.svg", sizes: "512x512", type: "image/svg+xml" }]` (pending reconciliation of `/favicon.svg` path in `public/`).
3. **MediaSession Cleanup on Null/Unmount:** When `selectedSong` becomes null/unset or on hook unmount, clear `navigator.mediaSession.metadata = null`, set `navigator.mediaSession.playbackState = "none"`, and clear registered action handlers (`setActionHandler(action, null)` wrapped in per-action `try/catch`).
4. **No Frame-Rate Metadata Churn (`MEMORY.md` BUG-003):** `MediaMetadata` instantiation and action handler registration MUST NOT re-run on high-frequency playback time updates (`currentTime` frames); metadata registration is triggered by `selectedSong` changes, and `playbackState` updates are isolated to `isPlaying` / `selectedSong` changes.
5. **Hardware `"play"` Handler:** Register `navigator.mediaSession.setActionHandler("play", ...)` to start/resume playback using current engine state (calling play/toggle only when `!isPlaying` so a duplicate OS `"play"` signal while already playing does not pause playback), without stale closure state.
6. **Hardware `"pause"` Handler:** Register `navigator.mediaSession.setActionHandler("pause", ...)` to pause playback using current engine state (calling pause/toggle only when `isPlaying` so a duplicate OS `"pause"` signal while already paused does not start playback), without stale closure state.
7. **Hardware `"seekto"` Handler:** Register `navigator.mediaSession.setActionHandler("seekto", (details) => ...)` so that when `details.seekTime !== undefined` and is a valid finite number, playback seeks via `seekTo` (clamped to `[0, duration]` — reconciliation pending on whether `seekTo` clamps internally).
8. **Hardware `"seekbackward"` & `"seekforward"` Handlers:** Register `"seekbackward"` and `"seekforward"` action handlers that seek relative to the current playback position by `details.seekOffset ?? 5` seconds (`Math.max(0, currentTime - offset)` backward; clamped to `[0, duration]` forward when duration > 0), with each `setActionHandler` call guarded in `try/catch` so unsupported optional actions on older WebViews do not abort registration of `"play"`, `"pause"`, and `"seekto"`.
9. **Playback State Sync:** Keep `navigator.mediaSession.playbackState` synchronized to:
   - `"none"` when `!selectedSong` or on unmount.
   - `"playing"` when `selectedSong` is present and `isPlaying === true`.
   - `"paused"` when `selectedSong` is present and `isPlaying === false`.
10. **`visibilitychange` Listener Lifecycle:** Register a `document.addEventListener("visibilitychange", ...)` listener (when `typeof document !== "undefined"`) in `useAudioEngine.ts` and remove it cleanly on cleanup/unmount.
11. **Auto-Resume Attempt on Foreground Return:** When `document.visibilityState === "visible"` and audio was actively playing (`isPlaying === true`), check `Tone.getContext().rawContext`:
    - If `rawCtx` exists and `rawCtx.state === "suspended"` (or `(rawCtx.state as string) === "interrupted"`), attempt `await rawCtx.resume()`.
    - If `isPlaying === false` or `rawCtx.state === "running"`, take no action (do NOT auto-start audio and do NOT display any resume toast).
12. **Auto-Resume Success Path:** If `rawCtx.resume()` succeeds and `rawCtx.state === "running"` (and the invocation is still active/mounted and `isPlaying` remains true), keep `isPlaying === true` and continue playback seamlessly with no resume toast displayed.
13. **Autoplay-Blocked Fallback (Q1.6):** If `rawCtx.resume()` rejects, times out while still not `"running"` (bounded wait, e.g., ≤ 500ms to catch mobile browsers where `resume()` hangs without user gesture), or resolves with `rawCtx.state !== "running"`:
    - Cleanly pause Tone transport/stem playback at the current position (without resetting playback position to `0`) so stems stay synchronized for subsequent resume.
    - Revert `isPlaying` to `false` (returning the UI Play button to "Play" state and syncing `navigator.mediaSession.playbackState` to `"paused"`).
    - Expose/trigger the brief status/toast message: `"Audio paused by device — tap Play to resume"`.
14. **Async Stale-State Guard (`MEMORY.md` BUG-002):** Guard the async `visibilitychange` resume flow against component unmount, song changes, or manual play/pause toggles occurring while `rawCtx.resume()` is awaiting, so stale resolutions or timeouts never overwrite current playback state or show a stale toast.
15. **Touch Unlock & Toast Lifecycle:** Tapping Play in `src/components/Mixer.tsx` executes `Tone.start()` and resumes all stem audio elements cleanly from the paused position. The `"Audio paused by device — tap Play to resume"` toast/indicator dismisses immediately when playback resumes or `selectedSong` changes, and auto-dismisses after a brief timeout (e.g., 5 seconds) with proper timer cleanup on unmount/re-trigger.
16. **Interface Backward Compatibility (Q1.1):** Refactor `src/hooks/useAudioEngine.ts` in place, preserving its existing return interface and behavior for `src/components/Mixer.tsx`; any new state exposed for the resume toast/status MUST be additive and backward-compatible (exact field/UI integration pending reconciliation with `context.md`).
17. **UI Toast Indicator & Fast Refresh Hygiene (`MEMORY.md` BUG-001):** Render `"Audio paused by device — tap Play to resume"` cleanly and non-intrusively in `src/components/Mixer.tsx` (using `role="status"` / `aria-live="polite"`, respecting existing UI patterns in `context.md`), without exporting non-component helpers/constants from `.tsx` files.
18. **Build & Lint Quality Gate:** Running `npm --prefix . run build` and `npm --prefix . run lint` completes with exit code 0, 0 TypeScript errors, and 0 ESLint warnings.

## Out of Scope
- Periodic `navigator.mediaSession.setPositionState` updates on animation frames (not requested in Phase 3 PBI/spec).
- Service Worker background audio caching or modifications to `CacheStorage` / offline stem caching logic (covered by Phase 1/2).
- Changes to `ChordMonitor`, transposition logic, stem volume/mute/solo controls, or song catalog schemas.
- Extracting `useAudioEngine.ts` into a separate engine class or breaking its existing return interface (Q1.1).
- Any edits, builds, or operations inside `primary-workspace` (strictly confined to ``).

## Fallback Behaviors
- **Missing `navigator.mediaSession` or `MediaMetadata` API:** Guard with `"mediaSession" in navigator && typeof MediaMetadata !== "undefined"`; skip OS metadata/handler wiring silently while preserving full in-app audio playback.
- **Unsupported individual `MediaSessionAction`:** Wrap each `setActionHandler` registration/cleanup in `try/catch` so unsupported optional actions (e.g., `"seekbackward"`, `"seekforward"`, `"seekto"` on older WebViews) do not break `"play"`/`"pause"` registration.
- **Missing or empty `selectedSong.key`:** Fall back `MediaMetadata.album` to `"Himay Stems"`.
- **Missing/closed `Tone.getContext().rawContext`:** Skip `.resume()` safely without throwing.
- **Autoplay policy blocks background `rawCtx.resume()`:** Revert `isPlaying = false` (Play button reverts to "Play", `playbackState = "paused"`), pause transport cleanly at current position, and display brief toast `"Audio paused by device — tap Play to resume"` so the user triggers `Tone.start()` on tap.

## Resolved Ambiguities
- **`MediaMetadata.album` when `selectedSong.key` is absent:** Raw user request specifies ``selectedSong.key ? `Key of ${selectedSong.key}` : "Himay Stems"``, resolving PBI §5 Task 3.1's unguarded template string.
- **Background auto-resume blocked UX (Q1.6):** Settled Design Decision Q1.6 specifies reverting `isPlaying = false` (button returns to "Play") and displaying a brief toast `"Audio paused by device — tap Play to resume"`, superseding the earlier placeholder in PBI Task 3.2 ("Show a non-intrusive 'Tap to Resume' overlay on the play button").
- **Hook integration strategy (Q1.1):** Settled Design Decision Q1.1 specifies refactoring `src/hooks/useAudioEngine.ts` in place while preserving its existing return interface for `src/components/Mixer.tsx`.
- **Idempotent OS play/pause handlers:** Guard `"play"` to fire only when `!isPlaying` and `"pause"` to fire only when `isPlaying`, avoiding inverted toggles if the OS emits redundant media events.
- **Silent or hanging `rawCtx.resume()` on mobile WebViews:** Handle rejected promises, bounded resume timeout while still suspended/interrupted, and resolved non-`"running"` context state identically as autoplay-blocked fallbacks.
- **Codebase safety patterns (`MEMORY.md`):** Guard browser APIs upfront (BUG-004), prevent async post-await cross-state races (BUG-002), hoist constant arrays/objects to module scope (BUG-003), and avoid exporting non-component helpers from `.tsx` files (BUG-001).
