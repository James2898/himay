# Context Bundle — Phase 3: Messenger WebView & Mobile OS Resilience

## Relevant Files
| File | Why It's Relevant |
|------|------------------|
| `src/hooks/useAudioEngine.ts` | Target hook; already contains partial Phase 3 scaffold at lines 589–657 (`MediaSession` metadata/handlers and `visibilitychange` handler) alongside `isPlayingRef`, `audioElementsRef`, `togglePlay`, `stopPlay`, and `seekTo` |
| `src/components/Mixer.tsx` | Sole consumer of `useAudioEngine(selectedSong)` (lines 34–45) and owner of the `.transport-center` Play button (lines 223–229); currently has no toast/status UI for Q1.6 resume notification |
| `src/types/index.ts` | Defines `Song` (`id`, `title`, `duration`, `key`, `stems`, `chords?`) and `Stem` interfaces consumed by `useAudioEngine` |
| `src/index.css` | Defines CSS theme variables (`--studio-gray`, `--neon-accent`, `--tape-yellow`, `--text-dim`) and `body { overflow: hidden; }` (lines 5–28) affecting toast/overlay placement |
| `src/styles/Mixer.css` | Styles `.mixer-container` (`max-width: 420px`) where non-blocking mobile toast/status styling belongs or aligns |
| `src/styles/Transport.css` | Styles `.transport-center`, `.transport-btn`, and `.transport-btn.active-play` (lines 5–47) |
| `src/main.tsx` | Imports global stylesheets (lines 3–9) and wraps `<App />` in React 19 `<StrictMode>` (lines 12–15) |
| `index.html` | App head metadata; `<link rel="icon">` currently points to `/vite.svg` (line 5), not `/favicon.svg` |
| `public/songs.json` | 10-song manifest; all entries `"01"`–`"10"` include `"key"` (`"G"`, `"D"`, `"E"`, `"C"`) |
| `public/vite.svg` | Only SVG icon asset currently in `public/` (`public/favicon.svg` referenced at `useAudioEngine.ts:604` does not exist) |
| `src/components/DebugConsole.tsx` | Fixed bottom-left debug UI at `zIndex: 9999` (lines 34–63); intercepts `console.log` and `console.error` only (lines 8–21) |
| `pbi-docs/PBI-20261120-audio-engine-optimization.md` | Authoritative Phase 3 spec (lines 269–324) and settled `/design-grill` decision `Q1.6` (line 422) |
| `tsconfig.app.json` | Enforces `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| `eslint.config.js` | Enforces `eslint-plugin-react-hooks` `flat.recommended` (`^7.0.1`) and `eslint-plugin-react-refresh` `vite` |
| `package.json` | Pins `react@^19.2.0`, `tone@^15.1.22`; defines `build` (`tsc -b && vite build`) and `lint` (`eslint .`); no test runner installed |

## Reuse Candidates
- `src/hooks/useAudioEngine.ts` lines 589–657 — Existing Phase 3 scaffold already wires `navigator.mediaSession.metadata`, idempotent `"play"`/`"pause"`/`"seekto"` action handlers using `isPlayingRef.current` + `togglePlay` + `seekTo`, and a `document.visibilitychange` listener calling `await Tone.start()` with fallback pause/state reset. Extend this in place rather than creating a duplicate hook.
- `src/hooks/useAudioEngine.ts` lines 399–468 (`togglePlay`) and 493–530 (`seekTo`) — `togglePlay` already guards `!isReady`, awaits `Tone.start()` when `Tone.getContext().state !== "running"`, and calls `elements[k].play()` across `STEM_KEYS`; `seekTo` already validates finite numbers, resolves duration safely, clamps `[0, duration]`, and syncs all 4 stems.
- `src/hooks/useAudioEngine.ts` lines 6, 39, 43, 299–308 (`STEM_KEYS`, `isPlayingRef`, `songDurationRef`, master-clock `drums`/`inst` selection) — Reuse for reading current master playback position in `"seekbackward"`/`"seekforward"` handlers without adding `currentTime` to `useEffect` dependencies (which would re-register MediaSession handlers every 100ms), and for checking/resuming stem `<audio>` elements on visibility return.
- `src/components/Mixer.tsx` lines 34–45 — Preserve existing destructured keys from `useAudioEngine(selectedSong)` and add any optional resume toast/status state cleanly without breaking callers.
- Native browser/platform APIs (`navigator.mediaSession`, `MediaMetadata`, `document.visibilitychange`, `HTMLAudioElement`, `Tone.start()`, `AudioContext.resume()`) — Already built into browser DOM/Web Audio/Tone.js (`^15.1.22`); no new packages needed.

## Patterns to Follow
- **Idempotent MediaSession Action Handlers via Refs:** See `src/hooks/useAudioEngine.ts:608-622` — check `isPlayingRef.current` before calling `togglePlay()` inside `"play"` and `"pause"` handlers so repeated OS lock-screen events never accidentally invert play/pause state; clean up handlers (`setActionHandler(..., null)`) in effect teardown (`lines 624-630`).
- **Imperative Intent + Safe Async Resume/Pause Teardown:** See `src/hooks/useAudioEngine.ts:405-467, 634-651` — update `isPlayingRef.current` synchronously alongside `setIsPlaying(...)`, pause all `STEM_KEYS` elements when playback fails or cannot resume, and guard browser globals (`typeof navigator === "undefined"`, `!("mediaSession" in navigator)`).
- **Strict TypeScript & React Refresh Rules:** See `src/hooks/useAudioEngine.ts:3` and `src/components/ChordMonitor.tsx:35, 69` — use `import type` (`verbatimModuleSyntax`), keep helper constants/functions non-exported in component files (`react-refresh/only-export-components`), and avoid accessing `.current` during render or violating `eslint-plugin-react-hooks` `flat.recommended`.
- **Dark Studio Theme & Non-Clipping Overlay Layout:** See `src/index.css:5-28`, `src/styles/Mixer.css:5-14`, and `src/components/DebugConsole.tsx:34-63` — use existing CSS variables (`--studio-gray`, `--neon-accent`, `--tape-yellow`) and ensure any Q1.6 toast fits within the `420px` mobile width and is not clipped by `body { overflow: hidden; }`.

## Anti-Patterns Flagged
- `src/hooks/useAudioEngine.ts:604`: Sets MediaSession artwork to `{ src: "/favicon.svg", sizes: "512x512", type: "image/svg+xml" }`, but `public/favicon.svg` does not exist (`public/` only has `songs.json` and `vite.svg`, matching `index.html:5`) — add `public/favicon.svg` or point artwork to an existing asset.
- `src/hooks/useAudioEngine.ts:602`: Sets album fallback to `"Himay Rehearsal Player"` when `selectedSong.key` is falsy, diverging from the requested `"Himay Stems"` fallback, and lines 590–597 exit early when `!selectedSong` without clearing `navigator.mediaSession.metadata` or setting `navigator.mediaSession.playbackState = "none"`.
- `src/hooks/useAudioEngine.ts:590-657`: Omits `navigator.mediaSession.playbackState` synchronization (`"playing" | "paused" | "none"`), omits optional `"seekbackward"`/`"seekforward"` handlers, and on blocked `visibilitychange` resume (lines 640–648) omits the Q1.6 user-facing toast (`"Audio paused by device — tap Play to resume"`).
- `src/hooks/useAudioEngine.ts:635-650`: `visibilitychange` handler only checks `rawCtx.state === "suspended"` and relies on `Tone.start()` throwing; it does not handle WebViews where `rawCtx.state` remains `"suspended"` / `"interrupted"` without throwing or where mobile OS paused the `<audio>` elements directly while `rawCtx` stayed `"running"`.
- `src/components/Mixer.tsx:135, 148`: Uses blocking `window.alert(...)` for cache errors — do not replicate `window.alert` for Q1.6's brief non-blocking resume toast.
- `src/components/Mixer.tsx:86, 102`: Invokes `checkCacheStatus` twice per song switch (`useEffect` and `handleSongChange`) — existing anti-pattern, do not replicate.
- `src/styles/Mixer.css:11`: Sets `width: 100vh;` alongside `max-width: 420px;` — existing layout quirk, do not copy into new toast styles.

## MEMORY.md Notes
- N/A (`MEMORY.md`, `docs/structure.md`, and `docs/coding-guidelines.md` do not exist in ``; `primary-workspace` was not inspected per worktree isolation directive).
