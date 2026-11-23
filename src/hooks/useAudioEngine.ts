import * as React from "react";
import * as Tone from "tone";
import type { Song, Stem } from "../types";
import { getCachedUrl, stemUrlManager } from "../utils/audioCache";

const STEM_KEYS: (keyof Stem)[] = ["vocals", "drums", "bass", "inst"];
const DEFAULT_STEM_DB = -10;
const MIN_AUDIBLE_DB = -60;
const SYNC_INTERVAL_MS = 100;
const DRIFT_LIMIT_SECONDS = 0.03; // 30ms
const RESUME_TIMEOUT_MS = 450;
const RESUME_TOAST_MESSAGE = "Audio paused by device — tap Play to resume";
const RESUME_TOAST_DURATION_MS = 5000;
const DEFAULT_SEEK_OFFSET_SECONDS = 5;

const MEDIA_SESSION_ARTWORK: MediaImage[] = [
  { src: "/favicon.svg", sizes: "512x512", type: "image/svg+xml" },
];
const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "seekto",
  "seekbackward",
  "seekforward",
];

const hasMediaSessionSupport = (): boolean =>
  typeof navigator !== "undefined" &&
  "mediaSession" in navigator &&
  typeof MediaMetadata !== "undefined";

const safeSetMediaActionHandler = (
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void => {
  if (!hasMediaSessionSupport()) {
    return;
  }
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Older WebViews may not support optional actions like seekbackward/seekforward
  }
};

const clearAllMediaSessionHandlers = (): void => {
  if (!hasMediaSessionSupport()) {
    return;
  }
  MEDIA_SESSION_ACTIONS.forEach((action) => {
    safeSetMediaActionHandler(action, null);
  });
};

const resolveMasterKey = (
  elements: Record<keyof Stem, HTMLAudioElement>,
): keyof Stem => {
  const drumsEl = elements.drums;
  const instEl = elements.inst;
  const isDrumsDelayedOrMissing =
    !drumsEl ||
    !drumsEl.src ||
    drumsEl.error !== null ||
    drumsEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
    (drumsEl.paused &&
      instEl &&
      !instEl.paused &&
      instEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);

  return isDrumsDelayedOrMissing ? "inst" : "drums";
};

const dbToLinear = (db: number): number => {
  if (db <= MIN_AUDIBLE_DB) {
    return 0;
  }
  return Tone.dbToGain(db);
};

export const useAudioEngine = (selectedSong: Song | null) => {
  const audioElementsRef = React.useRef<Record<keyof Stem, HTMLAudioElement> | null>(null);
  const sourceNodesRef = React.useRef<Record<keyof Stem, MediaElementAudioSourceNode> | null>(null);
  const gainNodesRef = React.useRef<Record<keyof Stem, GainNode> | null>(null);
  const pitchShiftRef = React.useRef<Tone.PitchShift | null>(null);

  const volumesRef = React.useRef<Record<keyof Stem, number>>({
    vocals: DEFAULT_STEM_DB,
    drums: DEFAULT_STEM_DB,
    bass: DEFAULT_STEM_DB,
    inst: DEFAULT_STEM_DB,
  });

  const mutedRef = React.useRef<Record<keyof Stem, boolean>>({
    vocals: false,
    drums: false,
    bass: false,
    inst: false,
  });

  const isPlayingRef = React.useRef<boolean>(false);
  const playRequestIdRef = React.useRef<number>(0);
  const loadIdRef = React.useRef<number>(0);
  const visibilityAttemptIdRef = React.useRef<number>(0);
  const syncIntervalRef = React.useRef<number | null>(null);
  const songDurationRef = React.useRef<number>(0);
  const currentTimeRef = React.useRef<number>(0);
  const isMountedRef = React.useRef<boolean>(true);
  const resumeToastTimerRef = React.useRef<number | null>(null);
  const togglePlayRef = React.useRef<() => Promise<void>>(async () => {});
  const seekToRef = React.useRef<(time: number) => void>(() => {});

  const [isReady, setIsReady] = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [transpose, setTranspose] = React.useState(0);
  const [resumeNotice, setResumeNotice] = React.useState<string | null>(null);

  const clearResumeNotice = React.useCallback(() => {
    if (resumeToastTimerRef.current !== null) {
      window.clearTimeout(resumeToastTimerRef.current);
      resumeToastTimerRef.current = null;
    }
    setResumeNotice(null);
  }, []);

  const showResumeNotice = React.useCallback(() => {
    if (resumeToastTimerRef.current !== null) {
      window.clearTimeout(resumeToastTimerRef.current);
      resumeToastTimerRef.current = null;
    }
    setResumeNotice(RESUME_TOAST_MESSAGE);
    resumeToastTimerRef.current = window.setTimeout(() => {
      resumeToastTimerRef.current = null;
      if (isMountedRef.current) {
        setResumeNotice(null);
      }
    }, RESUME_TOAST_DURATION_MS);
  }, []);

  // 1. Initialize Persistent Web Audio Nodes & HTMLAudioElements on mount
  React.useEffect(() => {
    isMountedRef.current = true;
    const rawCtx = Tone.getContext().rawContext as unknown as AudioContext;
    const ps = new Tone.PitchShift(0);
    ps.toDestination();
    pitchShiftRef.current = ps;

    const elements: Partial<Record<keyof Stem, HTMLAudioElement>> = {};
    const sources: Partial<Record<keyof Stem, MediaElementAudioSourceNode>> = {};
    const gains: Partial<Record<keyof Stem, GainNode>> = {};

    STEM_KEYS.forEach((key) => {
      const el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";

      const src = rawCtx.createMediaElementSource(el);
      const gain = rawCtx.createGain();

      // Initialize gain with stored target volume / mute state
      const initialDb = volumesRef.current[key];
      const initialGain = mutedRef.current[key] ? 0 : dbToLinear(initialDb);
      gain.gain.setValueAtTime(initialGain, rawCtx.currentTime);

      src.connect(gain);

      if (key === "drums") {
        // AM-1: drums connects directly to Tone.getDestination() to bypass pitch shift
        // while remaining under Tone.getDestination().volume master fader control
        Tone.connect(gain, Tone.getDestination());
      } else {
        // Melodic stems route through Tone.PitchShift
        Tone.connect(gain, ps);
      }

      elements[key] = el;
      sources[key] = src;
      gains[key] = gain;
    });

    audioElementsRef.current = elements as Record<keyof Stem, HTMLAudioElement>;
    sourceNodesRef.current = sources as Record<keyof Stem, MediaElementAudioSourceNode>;
    gainNodesRef.current = gains as Record<keyof Stem, GainNode>;

    return () => {
      // Cleanup for unmount / StrictMode remount (AM-2)
      isMountedRef.current = false;
      isPlayingRef.current = false;
      // Invalidate any in-flight play requests on unmount
      // eslint-disable-next-line react-hooks/exhaustive-deps
      playRequestIdRef.current++;

      if (resumeToastTimerRef.current !== null) {
        window.clearTimeout(resumeToastTimerRef.current);
        resumeToastTimerRef.current = null;
      }

      if (syncIntervalRef.current !== null) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }

      STEM_KEYS.forEach((key) => {
        const el = elements[key];
        if (el) {
          el.pause();
          el.removeAttribute("src");
          el.load();
        }
        sources[key]?.disconnect();
        gains[key]?.disconnect();
      });

      ps.dispose();
      audioElementsRef.current = null;
      sourceNodesRef.current = null;
      gainNodesRef.current = null;
      pitchShiftRef.current = null;
      stemUrlManager.revokeAll();
    };
  }, []);

  // 2. Song Change / Load Management
  React.useEffect(() => {
    songDurationRef.current = selectedSong?.duration ?? 0;

    // Reset pitch shift and transpose to 0 on song change
    if (pitchShiftRef.current) {
      pitchShiftRef.current.pitch = 0;
    }
    setTranspose(0);

    // Cancel active playback and invalidate sync loop
    if (syncIntervalRef.current !== null) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    const currentLoadId = ++loadIdRef.current;
    playRequestIdRef.current++;

    isPlayingRef.current = false;
    currentTimeRef.current = 0;
    clearResumeNotice();
    setIsPlaying(false);
    setIsReady(false);
    setCurrentTime(0);

    // Pause elements and reset currentTime
    const elements = audioElementsRef.current;
    if (elements) {
      STEM_KEYS.forEach((key) => {
        const el = elements[key];
        el.pause();
        el.currentTime = 0;
        el.removeAttribute("src");
        el.load();
      });
    }

    // AM-3: Detach old src before revoking old blob URLs
    stemUrlManager.revokeAll();

    if (!selectedSong) {
      return;
    }

    let isCancelled = false;
    const loadListenersCleanup: (() => void)[] = [];

    const loadStems = async () => {
      try {
        // Parallel stem URL resolution via Promise.all (AM-3)
        const [vocalsUrl, drumsUrl, bassUrl, instUrl] = await Promise.all([
          getCachedUrl(selectedSong.stems.vocals),
          getCachedUrl(selectedSong.stems.drums),
          getCachedUrl(selectedSong.stems.bass),
          getCachedUrl(selectedSong.stems.inst),
        ]);

        if (isCancelled || currentLoadId !== loadIdRef.current) {
          [vocalsUrl, drumsUrl, bassUrl, instUrl].forEach((u) => stemUrlManager.revoke(u));
          return;
        }

        const stemUrls: Record<keyof Stem, string> = {
          vocals: vocalsUrl,
          drums: drumsUrl,
          bass: bassUrl,
          inst: instUrl,
        };

        const currentElements = audioElementsRef.current;
        if (!currentElements) {
          [vocalsUrl, drumsUrl, bassUrl, instUrl].forEach((u) => stemUrlManager.revoke(u));
          return;
        }

        // Ready barrier across all 4 stems (AC-5, AC-15)
        const stemReadyPromises = STEM_KEYS.map((key) => {
          return new Promise<boolean>((resolve) => {
            const el = currentElements[key];
            const url = stemUrls[key];

            if (!el || !url) {
              resolve(false);
              return;
            }

            let resolved = false;

            const onCanPlay = () => {
              if (resolved) return;
              resolved = true;
              cleanup();
              resolve(true);
            };

            const onError = (e: Event) => {
              if (resolved) return;
              resolved = true;
              console.error(`Audio Engine: Error loading stem "${key}":`, e);
              cleanup();
              resolve(false);
            };

            const cleanup = () => {
              el.removeEventListener("canplaythrough", onCanPlay);
              el.removeEventListener("error", onError);
            };

            loadListenersCleanup.push(cleanup);

            el.addEventListener("canplaythrough", onCanPlay, { once: true });
            el.addEventListener("error", onError, { once: true });

            el.src = url;
            el.load();

            // Account for elements already at HAVE_ENOUGH_DATA
            if (el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
              if (!resolved) {
                resolved = true;
                cleanup();
                resolve(true);
              }
            }
          });
        });

        const results = await Promise.all(stemReadyPromises);

        if (isCancelled || currentLoadId !== loadIdRef.current) {
          return;
        }

        const allReady = results.every(Boolean);
        if (allReady) {
          setIsReady(true);
        } else {
          console.warn("Audio Engine: Not all stems loaded successfully");
          setIsReady(false);
        }
      } catch (err) {
        if (isCancelled || currentLoadId !== loadIdRef.current) {
          return;
        }
        console.error("Audio Engine Load Error:", err);
        setIsReady(false);
      }
    };

    loadStems();

    return () => {
      isCancelled = true;
      loadListenersCleanup.forEach((fn) => fn());
    };
  }, [selectedSong, clearResumeNotice]);

  // 3. Master-Slave 100ms Synchronization Loop (AC-10, AC-11)
  React.useEffect(() => {
    if (!isPlaying) {
      if (syncIntervalRef.current !== null) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      return;
    }

    const runSync = () => {
      const elements = audioElementsRef.current;
      if (!elements) return;

      const masterKey = resolveMasterKey(elements);
      const masterEl = elements[masterKey];

      if (!masterEl || !masterEl.src || masterEl.error) {
        return;
      }

      // Natural track completion (AC-11)
      if (masterEl.ended) {
        isPlayingRef.current = false;
        STEM_KEYS.forEach((k) => elements[k]?.pause());
        setIsPlaying(false);
        return;
      }

      const masterTime = masterEl.currentTime;
      if (Number.isFinite(masterTime)) {
        currentTimeRef.current = masterTime;
        setCurrentTime(masterTime);

        // Snap slave stems if drift > 30ms (0.03s)
        STEM_KEYS.forEach((key) => {
          if (key === masterKey) return;
          const slaveEl = elements[key];
          if (!slaveEl || !slaveEl.src || slaveEl.error) return;
          if (slaveEl.seeking || slaveEl.ended) return;

          const drift = Math.abs(slaveEl.currentTime - masterTime);
          if (drift > DRIFT_LIMIT_SECONDS) {
            slaveEl.currentTime = masterTime;
          }
        });
      }
    };

    const intervalId = window.setInterval(runSync, SYNC_INTERVAL_MS);
    syncIntervalRef.current = intervalId;

    const handleEnded = (key: keyof Stem) => {
      const elements = audioElementsRef.current;
      if (!elements) return;

      const masterKey = resolveMasterKey(elements);

      const allEnded = STEM_KEYS.every((k) => {
        const el = elements[k];
        return !el || !el.src || el.ended;
      });

      // Only stop the song if the master stem has ended OR all active stems have ended
      if (key === masterKey || allEnded) {
        isPlayingRef.current = false;
        STEM_KEYS.forEach((k) => elements[k]?.pause());
        setIsPlaying(false);
      }
    };

    const elements = audioElementsRef.current;
    const endedListeners: Partial<Record<keyof Stem, () => void>> = {};
    if (elements) {
      STEM_KEYS.forEach((k) => {
        const listener = () => handleEnded(k);
        endedListeners[k] = listener;
        elements[k]?.addEventListener("ended", listener);
      });
    }

    return () => {
      clearInterval(intervalId);
      if (syncIntervalRef.current === intervalId) {
        syncIntervalRef.current = null;
      }
      if (elements) {
        STEM_KEYS.forEach((k) => {
          const listener = endedListeners[k];
          if (listener) {
            elements[k]?.removeEventListener("ended", listener);
          }
        });
      }
    };
  }, [isPlaying]);

  // 4. Playback Controls (AC-8, AC-9, AC-12, AC-13, AM-5)
  const togglePlay = React.useCallback(async () => {
    if (!isReady || !audioElementsRef.current) {
      console.warn("Audio not ready yet");
      return;
    }

    // AM-5: Imperative playback-intent guard
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      playRequestIdRef.current++;

      const elements = audioElementsRef.current;
      if (elements) {
        STEM_KEYS.forEach((k) => elements[k]?.pause());
      }
      setIsPlaying(false);
      return;
    }

    clearResumeNotice();
    isPlayingRef.current = true;
    const requestId = ++playRequestIdRef.current;

    try {
      if (Tone.getContext().state !== "running") {
        await Tone.start();
      }

      if (requestId !== playRequestIdRef.current) {
        return;
      }

      if (!isPlayingRef.current) {
        const elements = audioElementsRef.current;
        if (elements) {
          STEM_KEYS.forEach((k) => elements[k]?.pause());
        }
        setIsPlaying(false);
        return;
      }

      const elements = audioElementsRef.current;
      if (!elements) return;

      await Promise.all(STEM_KEYS.map((k) => elements[k].play()));

      if (requestId !== playRequestIdRef.current) {
        return;
      }

      if (!isPlayingRef.current) {
        STEM_KEYS.forEach((k) => elements[k]?.pause());
        setIsPlaying(false);
        return;
      }

      setIsPlaying(true);
    } catch (error) {
      if (requestId !== playRequestIdRef.current) {
        return;
      }

      console.error("Playback failed or was blocked:", error);
      isPlayingRef.current = false;
      const elements = audioElementsRef.current;
      if (elements) {
        STEM_KEYS.forEach((k) => elements[k]?.pause());
      }
      setIsPlaying(false);
    }
  }, [isReady, clearResumeNotice]);

  const stopPlay = React.useCallback(() => {
    isPlayingRef.current = false;
    playRequestIdRef.current++;
    clearResumeNotice();

    if (syncIntervalRef.current !== null) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    if (audioElementsRef.current) {
      STEM_KEYS.forEach((k) => {
        const el = audioElementsRef.current?.[k];
        if (el) {
          el.pause();
          el.currentTime = 0;
        }
      });
    }

    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, [clearResumeNotice]);

  const seekTo = React.useCallback(
    (time: number) => {
      // AC-9: Safely no-op when !isReady
      if (!isReady || !audioElementsRef.current) {
        return;
      }

      if (!Number.isFinite(time)) {
        return;
      }

      const elements = audioElementsRef.current;
      const songDuration = songDurationRef.current;
      const fallbackDuration = elements.drums?.duration;
      const duration =
        Number.isFinite(songDuration) && songDuration > 0
          ? songDuration
          : Number.isFinite(fallbackDuration) && (fallbackDuration ?? 0) > 0
            ? (fallbackDuration as number)
            : 0;

      // AC-12: Clamping [0, duration]
      const clampedTime =
        duration > 0
          ? Math.max(0, Math.min(duration, time))
          : Math.max(0, time);

      STEM_KEYS.forEach((k) => {
        const el = elements[k];
        if (el && Number.isFinite(clampedTime)) {
          el.currentTime = clampedTime;
        }
      });

      currentTimeRef.current = clampedTime;
      setCurrentTime(clampedTime);
    },
    [isReady],
  );

  const changePitch = React.useCallback((semitones: number) => {
    const clamped = Math.max(-12, Math.min(12, semitones));
    if (pitchShiftRef.current) {
      pitchShiftRef.current.pitch = clamped;
    }
    setTranspose(clamped);
  }, []);

  // 5. Volume & Mute Control (AC-6, AC-7, AM-4)
  const updateVolume = React.useCallback(
    (track: keyof Stem | "master", db: number) => {
      // AM-4: Do NOT return early if !isReady
      if (track === "master") {
        const targetDb = db <= MIN_AUDIBLE_DB ? -Infinity : db;
        Tone.getDestination().volume.rampTo(targetDb, 0.1);
        return;
      }

      volumesRef.current[track] = db;

      if (mutedRef.current[track]) {
        return;
      }

      const gainNode = gainNodesRef.current?.[track];
      if (gainNode) {
        const targetGain = dbToLinear(db);
        const rawCtx = Tone.getContext().rawContext;
        const now = rawCtx.currentTime;
        const currentGain = gainNode.gain.value;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(currentGain, now);
        gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.05);
      }
    },
    [],
  );

  const toggleMute = React.useCallback(
    (track: keyof Stem, shouldMute: boolean) => {
      // AM-4: Do NOT return early if !isReady
      mutedRef.current[track] = shouldMute;

      const gainNode = gainNodesRef.current?.[track];
      if (gainNode) {
        const targetGain = shouldMute ? 0 : dbToLinear(volumesRef.current[track]);
        const rawCtx = Tone.getContext().rawContext;
        const now = rawCtx.currentTime;
        const currentGain = gainNode.gain.value;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(currentGain, now);
        gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.05);
      }
    },
    [],
  );

  // 6. Mobile Resilience: MediaSession API & Background Auto-Resume
  const getCurrentMasterTime = React.useCallback((): number => {
    const elements = audioElementsRef.current;
    if (!elements) {
      return currentTimeRef.current;
    }
    const masterKey = resolveMasterKey(elements);
    const masterEl = elements[masterKey];
    const masterTime = masterEl?.currentTime;
    return typeof masterTime === "number" && Number.isFinite(masterTime)
      ? masterTime
      : currentTimeRef.current;
  }, []);

  React.useEffect(() => {
    togglePlayRef.current = togglePlay;
    seekToRef.current = seekTo;
  }, [togglePlay, seekTo]);

  React.useEffect(() => {
    if (!hasMediaSessionSupport()) {
      return;
    }

    if (!selectedSong) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      clearAllMediaSessionHandlers();
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: selectedSong.title,
      artist: "Himay Rehearsal Player",
      album: selectedSong.key ? `Key of ${selectedSong.key}` : "Himay Stems",
      artwork: MEDIA_SESSION_ARTWORK,
    });
    navigator.mediaSession.playbackState = isPlayingRef.current
      ? "playing"
      : "paused";

    safeSetMediaActionHandler("play", () => {
      if (!isPlayingRef.current) {
        void togglePlayRef.current();
      }
    });
    safeSetMediaActionHandler("pause", () => {
      if (isPlayingRef.current) {
        void togglePlayRef.current();
      }
    });
    safeSetMediaActionHandler("seekto", (details) => {
      if (
        details.seekTime !== undefined &&
        Number.isFinite(details.seekTime)
      ) {
        seekToRef.current(details.seekTime);
      }
    });
    safeSetMediaActionHandler("seekbackward", (details) => {
      const offset =
        details.seekOffset !== undefined &&
        Number.isFinite(details.seekOffset) &&
        details.seekOffset > 0
          ? details.seekOffset
          : DEFAULT_SEEK_OFFSET_SECONDS;
      const baseTime = getCurrentMasterTime();
      seekToRef.current(Math.max(0, baseTime - offset));
    });
    safeSetMediaActionHandler("seekforward", (details) => {
      const offset =
        details.seekOffset !== undefined &&
        Number.isFinite(details.seekOffset) &&
        details.seekOffset > 0
          ? details.seekOffset
          : DEFAULT_SEEK_OFFSET_SECONDS;
      const baseTime = getCurrentMasterTime();
      const duration = songDurationRef.current;
      const targetTime =
        Number.isFinite(duration) && duration > 0
          ? Math.min(duration, Math.max(0, baseTime + offset))
          : Math.max(0, baseTime + offset);
      seekToRef.current(targetTime);
    });

    return () => {
      if (hasMediaSessionSupport()) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
        clearAllMediaSessionHandlers();
      }
    };
  }, [selectedSong, getCurrentMasterTime]);

  React.useEffect(() => {
    if (!hasMediaSessionSupport()) {
      return;
    }

    if (!selectedSong) {
      navigator.mediaSession.playbackState = "none";
      return;
    }

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [selectedSong, isPlaying]);

  React.useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const triggerAutoplayBlockedFallback = (
      expectedLoadId: number,
      expectedPlayRequestId: number,
      expectedAttemptId: number,
    ) => {
      if (
        !isMountedRef.current ||
        expectedLoadId !== loadIdRef.current ||
        expectedPlayRequestId !== playRequestIdRef.current ||
        expectedAttemptId !== visibilityAttemptIdRef.current ||
        !isPlayingRef.current
      ) {
        return;
      }

      isPlayingRef.current = false;
      playRequestIdRef.current++;

      const elements = audioElementsRef.current;
      if (elements) {
        STEM_KEYS.forEach((k) => elements[k]?.pause());
      }

      setIsPlaying(false);
      if (hasMediaSessionSupport()) {
        navigator.mediaSession.playbackState = "paused";
      }
      showResumeNotice();
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible" || !isPlayingRef.current) {
        return;
      }

      const activeLoadId = loadIdRef.current;
      const activePlayRequestId = playRequestIdRef.current;
      const activeAttemptId = ++visibilityAttemptIdRef.current;

      const rawCtx = Tone.getContext()?.rawContext as
        | (AudioContext & { resume?: () => Promise<void> })
        | undefined;

      const rawState = rawCtx ? (rawCtx.state as string) : "";
      const needsContextResume =
        Boolean(rawCtx) &&
        (rawState === "suspended" || rawState === "interrupted");

      if (needsContextResume && rawCtx && typeof rawCtx.resume === "function") {
        let timeoutId: number | null = null;
        try {
          const resumeResult = await Promise.race<"resumed" | "timeout">([
            rawCtx.resume().then(() => "resumed" as const),
            new Promise<"timeout">((resolve) => {
              timeoutId = window.setTimeout(
                () => resolve("timeout"),
                RESUME_TIMEOUT_MS,
              );
            }),
          ]);

          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
          }

          if (
            !isMountedRef.current ||
            activeLoadId !== loadIdRef.current ||
            activePlayRequestId !== playRequestIdRef.current ||
            activeAttemptId !== visibilityAttemptIdRef.current ||
            !isPlayingRef.current
          ) {
            return;
          }

          if (
            resumeResult === "timeout" ||
            (rawCtx.state as string) !== "running"
          ) {
            triggerAutoplayBlockedFallback(
              activeLoadId,
              activePlayRequestId,
              activeAttemptId,
            );
            return;
          }
        } catch (err) {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
          }
          console.warn("Autoplay policy blocked background resume:", err);
          triggerAutoplayBlockedFallback(
            activeLoadId,
            activePlayRequestId,
            activeAttemptId,
          );
          return;
        }
      }

      if (
        !isMountedRef.current ||
        activeLoadId !== loadIdRef.current ||
        activePlayRequestId !== playRequestIdRef.current ||
        activeAttemptId !== visibilityAttemptIdRef.current ||
        !isPlayingRef.current
      ) {
        return;
      }

      // AM-2: Inspect active stem <audio> elements in case mobile OS paused them while rawCtx stayed "running"
      const elements = audioElementsRef.current;
      if (!elements) {
        return;
      }

      const pausedStems = STEM_KEYS.filter((k) => {
        const el = elements[k];
        return Boolean(el && el.src && !el.ended && el.paused);
      });

      if (pausedStems.length === 0) {
        return;
      }

      const targetTime = getCurrentMasterTime();
      STEM_KEYS.forEach((k) => {
        const el = elements[k];
        if (!el || !el.src || el.ended || el.seeking) {
          return;
        }
        if (Math.abs(el.currentTime - targetTime) > DRIFT_LIMIT_SECONDS) {
          el.currentTime = targetTime;
        }
      });

      let stemTimeoutId: number | null = null;
      try {
        const stemResumeResult = await Promise.race<"resumed" | "timeout">([
          Promise.all(pausedStems.map((k) => elements[k].play())).then(
            () => "resumed" as const,
          ),
          new Promise<"timeout">((resolve) => {
            stemTimeoutId = window.setTimeout(
              () => resolve("timeout"),
              RESUME_TIMEOUT_MS,
            );
          }),
        ]);

        if (stemTimeoutId !== null) {
          window.clearTimeout(stemTimeoutId);
          stemTimeoutId = null;
        }

        if (
          !isMountedRef.current ||
          activeLoadId !== loadIdRef.current ||
          activePlayRequestId !== playRequestIdRef.current ||
          activeAttemptId !== visibilityAttemptIdRef.current ||
          !isPlayingRef.current
        ) {
          return;
        }

        const stillPaused = pausedStems.some((k) => {
          const el = elements[k];
          return Boolean(el && el.src && !el.ended && el.paused);
        });

        if (stemResumeResult === "timeout" || stillPaused) {
          triggerAutoplayBlockedFallback(
            activeLoadId,
            activePlayRequestId,
            activeAttemptId,
          );
        }
      } catch (err) {
        if (stemTimeoutId !== null) {
          window.clearTimeout(stemTimeoutId);
          stemTimeoutId = null;
        }
        console.warn("Autoplay policy blocked stem audio resume:", err);
        triggerAutoplayBlockedFallback(
          activeLoadId,
          activePlayRequestId,
          activeAttemptId,
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [getCurrentMasterTime, showResumeNotice]);

  return {
    isReady,
    isPlaying,
    currentTime,
    transpose,
    resumeNotice,
    togglePlay,
    stopPlay,
    seekTo,
    updateVolume,
    toggleMute,
    changePitch,
  };
};
