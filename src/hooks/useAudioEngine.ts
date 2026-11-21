import * as React from "react";
import * as Tone from "tone";
import type { Song, Stem } from "../types";
import { getCachedUrl, stemUrlManager } from "../utils/audioCache";

const STEM_KEYS: (keyof Stem)[] = ["vocals", "drums", "bass", "inst"];
const DEFAULT_STEM_DB = -10;
const MIN_AUDIBLE_DB = -60;
const SYNC_INTERVAL_MS = 100;
const DRIFT_LIMIT_SECONDS = 0.03; // 30ms

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
  const syncIntervalRef = React.useRef<number | null>(null);
  const songDurationRef = React.useRef<number>(0);

  const [isReady, setIsReady] = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [transpose, setTranspose] = React.useState(0);

  // 1. Initialize Persistent Web Audio Nodes & HTMLAudioElements on mount
  React.useEffect(() => {
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
      isPlayingRef.current = false;
      playRequestIdRef.current++;

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
  }, [selectedSong]);

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

      const drumsEl = elements.drums;
      const instEl = elements.inst;

      // Elect master clock: drums is primary; fallback to inst if drums is delayed or missing
      const isDrumsDelayedOrMissing =
        !drumsEl ||
        !drumsEl.src ||
        drumsEl.error !== null ||
        drumsEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
        (drumsEl.paused && instEl && !instEl.paused && instEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);

      const masterKey: keyof Stem = isDrumsDelayedOrMissing ? "inst" : "drums";
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

      const drumsEl = elements.drums;
      const instEl = elements.inst;
      const isDrumsDelayedOrMissing =
        !drumsEl ||
        !drumsEl.src ||
        drumsEl.error !== null ||
        drumsEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
        (drumsEl.paused && instEl && !instEl.paused && instEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);

      const masterKey: keyof Stem = isDrumsDelayedOrMissing ? "inst" : "drums";

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
  }, [isReady]);

  const stopPlay = React.useCallback(() => {
    isPlayingRef.current = false;
    playRequestIdRef.current++;

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

    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

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
  React.useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !selectedSong
    ) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: selectedSong.title,
      artist: "Himay Rehearsal Player",
      album: selectedSong.key ? `Key of ${selectedSong.key}` : "Himay Rehearsal Player",
      artwork: [
        { src: "/favicon.svg", sizes: "512x512", type: "image/svg+xml" },
      ],
    });

    navigator.mediaSession.setActionHandler("play", () => {
      if (!isPlayingRef.current) {
        togglePlay();
      }
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (isPlayingRef.current) {
        togglePlay();
      }
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) {
        seekTo(details.seekTime);
      }
    });

    return () => {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("seekto", null);
      }
    };
  }, [selectedSong, togglePlay, seekTo]);

  React.useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && isPlayingRef.current) {
        const rawCtx = Tone.getContext().rawContext;
        if (rawCtx.state === "suspended") {
          try {
            await Tone.start();
          } catch (err) {
            console.warn("Autoplay policy blocked background resume:", err);
            isPlayingRef.current = false;
            const elements = audioElementsRef.current;
            if (elements) {
              STEM_KEYS.forEach((k) => elements[k]?.pause());
            }
            setIsPlaying(false);
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return {
    isReady,
    isPlaying,
    currentTime,
    transpose,
    togglePlay,
    stopPlay,
    seekTo,
    updateVolume,
    toggleMute,
    changePitch,
  };
};
