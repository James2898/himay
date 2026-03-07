import { useRef, useState, useEffect, useCallback } from "react";
import * as Tone from "tone";
import type { Song, Stem } from "../types";
import { getCachedUrl } from "../utils/audioCache";

// Constant to avoid TypeScript 'urls' property errors and for clean iteration
const STEM_KEYS: (keyof Stem)[] = ["vocals", "drums", "bass", "inst"];

export const useAudioEngine = (selectedSong: Song | null) => {
  const players = useRef<Tone.Players | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // 1. Initialize / Load Song Stems
  useEffect(() => {
    if (!selectedSong) {
      setIsReady(false);
      return;
    }

    let isMounted = true;

    const loadStems = async () => {
      console.log("1. Starting loadStems");
      setIsReady(false);

      // Define the actual loading logic as a reusable helper
      const executeLoad = async (
        stems: Record<string, string>,
        isRetry = false,
      ) => {
        if (players.current) players.current.dispose();

        const newPlayers = new Tone.Players().toDestination();

        try {
          for (const key of STEM_KEYS) {
            console.log(`- ${isRetry ? "Retry" : "Load"} ${key}...`);
            await newPlayers.add(key, stems[key]);
          }

          await Tone.loaded();

          if (isMounted) {
            players.current = newPlayers;
            console.log("5. SUCCESS: Engine Ready");
            setIsReady(true);
          }
        } catch (err) {
          if (!isRetry) {
            console.warn("Cache load failed, trying raw CDN...");
            await executeLoad(selectedSong.stems, true); // Fallback to original stems
          } else {
            console.error("CDN Fallback also failed:", err);
          }
        }
      };

      try {
        console.log("2. Resolving URLs...");
        const cachedStems = {
          vocals: await getCachedUrl(selectedSong.stems.vocals),
          drums: await getCachedUrl(selectedSong.stems.drums),
          bass: await getCachedUrl(selectedSong.stems.bass),
          inst: await getCachedUrl(selectedSong.stems.inst),
        };

        console.log("3. Attempting cache/blob load...");
        await executeLoad(cachedStems);
      } catch (err: any) {
        console.log("Outer Catch: Attempting raw CDN fallback...");
        await executeLoad(selectedSong.stems, true);
      }
    };

    loadStems();

    return () => {
      isMounted = false;
    };
  }, [selectedSong]);

  // 2. Track Progress (Sync UI with Audio Clock)
  useEffect(() => {
    let animationFrame: number;

    const updateClock = () => {
      if (isPlaying) {
        setCurrentTime(Tone.getTransport().seconds);
      }
      animationFrame = requestAnimationFrame(updateClock);
    };

    animationFrame = requestAnimationFrame(updateClock);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying]);

  // 3. Playback Controls
  const togglePlay = useCallback(async () => {
    if (!isReady || !players.current) {
      console.warn("Audio not ready yet");
      return;
    }
    try {
      // Force Resume for iOS
      if (Tone.getContext().state !== "running") {
        await Tone.start();
      }

      // Toggle state FIRST so the UI reflects the change immediately on touch
      setIsPlaying((prev) => !prev);

      if (!isPlaying) {
        // Start Logic
        const startTime = Tone.getTransport().seconds;
        STEM_KEYS.forEach((track) => {
          players.current?.player(track).start(0, startTime);
        });
        Tone.getTransport().start();
        setIsPlaying(true);
      } else {
        // Stop Logic
        Tone.getTransport().pause();
        players.current?.stopAll();
        setIsPlaying(false);
      }
    } catch (error) {
      console.error("Playback failed on mobile:", error);
      setIsPlaying(false);
    }
  }, [isPlaying, isReady]);

  // Also update stopPlay to clear the glow
  const stopPlay = useCallback(() => {
    Tone.getTransport().stop();
    players.current?.stopAll();
    Tone.getTransport().seconds = 0;
    setCurrentTime(0);
    setIsPlaying(false); // Kills the glow when stopped
  }, []);

  // 4. Seek Functionality
  const seekTo = useCallback(
    (time: number) => {
      Tone.getTransport().seconds = time;
      setCurrentTime(time);

      // If it's already playing, we need to restart players at the new time
      if (isPlaying && players.current) {
        players.current.stopAll();
        STEM_KEYS.forEach((track) => {
          players.current?.player(track).start(0, time);
        });
      }
    },
    [isPlaying],
  );

  // 5. Volume & Mute Control
  const updateVolume = useCallback(
    (track: keyof Stem | "master", db: number) => {
      // 1. If not ready, DO NOT touch the audio params
      if (!isReady || !players.current) return;

      try {
        if (track === "master") {
          const dest = Tone.getDestination();
          // Check if the volume param is actually accessible
          if (dest && dest.volume && dest.volume.rampTo) {
            dest.volume.rampTo(db, 0.1);
          }
        } else {
          // Ensure player exists before accessing volume
          if (players.current.has(track)) {
            const p = players.current.player(track);
            if (p && p.volume && p.volume.rampTo) {
              p.volume.rampTo(db, 0.1);
            }
          }
        }
      } catch (e) {
        // Catching the AudioParam error here prevents the UI from freezing
        console.warn("Suppressed AudioParam error during transition.");
      }
    },
    [isReady], // This ensures the function knows when the engine is locked
  );

  const toggleMute = useCallback((track: keyof Stem, shouldMute: boolean) => {
    if (players.current?.has(track)) {
      players.current.player(track).mute = shouldMute;
    }
  }, []);

  useEffect(() => {
    const unlock = async () => {
      if (Tone.getContext().state !== "running") {
        await Tone.start();
        console.log("Audio Context Unlocked");
      }
    };

    // Listen for the very first touch on the phone screen
    window.addEventListener("touchstart", unlock, { once: true });
    return () => window.removeEventListener("touchstart", unlock);
  }, []);

  return {
    isReady,
    isPlaying,
    currentTime,
    togglePlay,
    stopPlay,
    seekTo,
    updateVolume,
    toggleMute,
  };
};
