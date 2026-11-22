# Research — Mobile OS & WebView Resilience (Phase 3)

## Open Questions
- **Pending Reconciliation** — What is the exact return interface and internal structure of `togglePlay`, `seekTo`, `isPlaying`, `selectedSong`, `currentTime`, and `duration` in `src/hooks/useAudioEngine.ts` (including whether `togglePlay` already calls `Tone.start()` and whether `seekTo` clamps `[0, duration]`)? (suggested resolution source: `context.md` analysis of `src/hooks/useAudioEngine.ts`)
- **Pending Reconciliation** — What is the exact TypeScript definition of `selectedSong` (required vs optional `title` and `key` properties)? (suggested resolution source: `context.md` types / `src/hooks/useAudioEngine.ts`)
- **Pending Reconciliation** — Does `useAudioEngine.ts` or `src/components/Mixer.tsx` already expose or render a toast/status/error mechanism, or should an additive optional field (e.g., `resumeNotice` / `toastMessage`) be added to `useAudioEngine` and rendered in `Mixer.tsx`? (suggested resolution source: `context.md` analysis of `src/hooks/useAudioEngine.ts` and `src/components/Mixer.tsx`)
- **Pending Reconciliation** — What is the exact TypeScript type of `Tone.getContext().rawContext` in the installed `tone` version, and how are `Tone.Transport` / stem players paused without resetting position? (suggested resolution source: `context.md` dependencies and `src/hooks/useAudioEngine.ts`)
- **Pending Reconciliation** — Does `public/favicon.svg` exist to match the MediaSession artwork path `"/favicon.svg"`? (suggested resolution source: `context.md` `public/` file listing)
