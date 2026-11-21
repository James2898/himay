# MEMORY.md — Bug Root Causes & Resolutions
> Maintained by `@debug-memory`. Read by agents when PM includes it in the Context Bundle.
> Agents that read: @codebase-explorer, @requirements-engineer, @fullstack-developer, @release-manager, @validator-agent.
> Only `@debug-memory` writes to this file.

---

## UI State

- **BUG-001** | 2026-11-20 | Feature: `Streaming Audio Engine`
  - **Root Cause:** Under TypeScript `"strict": true` (`strictNullChecks`), checking `if (audioElementsRef.current)` does not narrow `.current` inside nested arrow callbacks (such as `STEM_KEYS.forEach(...)`), triggering `TS2531` / `TS18047`.
  - **Resolution:** In `src/hooks/useAudioEngine.ts`, captured `const elements = audioElementsRef.current; if (!elements) return;` in a local variable before entering callbacks/loops.
  - **Prevention:** Always bind `ref.current` to a local `const` and null-check it before referencing it inside `.forEach()`, `.map()`, or async callbacks.

- **BUG-002** | 2026-11-20 | Feature: `Streaming Audio Engine`
  - **Root Cause:** Rapid Play → Pause → Play transitions across asynchronous `Tone.start()` and `Promise.all(elements.play())` calls allowed an older pending promise resolving or rejecting with `AbortError` to clobber newer active playback state.
  - **Resolution:** Added monotonic `playRequestIdRef.current` tracking in `src/hooks/useAudioEngine.ts`, incrementing on stop/pause/unmount and returning early via `if (requestId !== playRequestIdRef.current) return;` after every `await` and at the top of `catch`.
  - **Prevention:** Guard multi-step async playback/state transitions with a monotonic request-ID ref checked after every `await` and before error handling mutates state.

---

## Web Audio & Media

- **BUG-003** | 2026-11-20 | Feature: `Streaming Audio Engine`
  - **Root Cause:** Calling `gainNode.gain.cancelScheduledValues(now)` before reading `gainNode.gain.value` resets the sampled value to the prior committed `setValueAtTime` anchor, causing zipper/click artifacts during fast fader drags.
  - **Resolution:** Updated `src/hooks/useAudioEngine.ts` to sample `const currentGain = gainNode.gain.value;` before calling `gainNode.gain.cancelScheduledValues(now)` and anchoring the next ramp.
  - **Prevention:** Always read `audioParam.value` before calling `cancelScheduledValues(now)` when computing the starting anchor for a new Web Audio ramp.

- **BUG-004** | 2026-11-20 | Feature: `Streaming Audio Engine`
  - **Root Cause:** Calling `stemUrlManager.revokeAll()` at the start of a song switch does not revoke Blob URLs whose `getCachedUrl` calls are still in-flight and resolve after the switch.
  - **Resolution:** Added an explicit `stemUrlManager.revoke(url)` method in `src/utils/audioCache.ts` and updated `src/hooks/useAudioEngine.ts` to revoke any newly resolved Blob URL immediately when `isCancelled` is true.
  - **Prevention:** For async object/Blob URL loads, check cancellation upon resolution and revoke orphaned URLs individually rather than relying solely on batch `revokeAll()` at teardown start.
