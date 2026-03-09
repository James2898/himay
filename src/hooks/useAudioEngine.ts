import * as React from "react";
import * as Tone from "tone";
import type { Song, Stem } from "../types";
import { getCachedUrl } from "../utils/audioCache";

// Constant to avoid TypeScript 'urls' property errors and for clean iteration
const STEM_KEYS: (keyof Stem)[] = ["vocals", "drums", "bass", "inst"];

export const useAudioEngine = (selectedSong: Song | null) => {
  const players = React.useRef<Tone.Players | null>(null);
  const pitchShift = React.useRef<Tone.PitchShift | null>(null);

  const [isReady, setIsReady] = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [transpose, setTranspose] = React.useState(0);

  React.useEffect(() => {
    pitchShift.current = new Tone.PitchShift(0).toDestination();

    return () => {
      pitchShift.current?.dispose();
    };
  }, []);

  // 1. Initialize / Load Song Stems
  React.useEffect(() => {
    if (!selectedSong) {
      setIsReady(false);
      return;
    }

    let isMounted = true;

    const loadStems = async () => {
      setIsReady(false);

      try {
        // Resolve URLs (Cache-first approach)
        const urls = {
          vocals: await getCachedUrl(selectedSong.stems.vocals),
          drums: await getCachedUrl(selectedSong.stems.drums),
          bass: await getCachedUrl(selectedSong.stems.bass),
          inst: await getCachedUrl(selectedSong.stems.inst),
        };

        if (players.current) {
          players.current.dispose();
        }

        /**
         * We load the players and connect them to the PitchShift node
         * instead of directly to the destination.
         */
        const p = new Tone.Players(urls, () => {
          if (isMounted && pitchShift.current) {
            /**
             * SPLIT ROUTING LOGIC:
             * We loop through each track and decide its destination.
             */
            STEM_KEYS.forEach((key) => {
              const player = p.player(key);

              if (key === "drums") {
                // DRUMS: Bypass pitch shifting to keep transients crisp
                player.toDestination();
                console.log(
                  "Audio Engine: Drums connected to Master (Bypass Shift)",
                );
              } else {
                // MELODIC: Route through the pitch shifter
                player.connect(pitchShift.current!);
                console.log(`Audio Engine: ${key} connected to PitchShift`);
              }
            });

            setIsReady(true);
          }
        });

        players.current = p;
      } catch (err) {
        console.error("Audio Engine Load Error:", err);
      }
    };

    loadStems();

    return () => {
      isMounted = false;
    };
  }, [selectedSong]);

  // 2. Track Progress (Sync UI with Audio Clock)
  React.useEffect(() => {
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
  const togglePlay = React.useCallback(async () => {
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
  const stopPlay = React.useCallback(() => {
    Tone.getTransport().stop();
    players.current?.stopAll();
    Tone.getTransport().seconds = 0;
    setCurrentTime(0);
    setIsPlaying(false); // Kills the glow when stopped
  }, []);

  // 4. Seek Functionality
  const seekTo = React.useCallback(
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

  const changePitch = React.useCallback((semitones: number) => {
    // Clamp between -12 and +12 for sanity
    const clamped = Math.max(-12, Math.min(12, semitones));
    if (pitchShift.current) {
      pitchShift.current.pitch = clamped;
      setTranspose(clamped);
    }
  }, []);

  // 5. Volume & Mute Control
  const updateVolume = React.useCallback(
    (track: keyof Stem | "master", db: number) => {
      if (!isReady || !players.current) return;

      if (track === "master") {
        Tone.getDestination().volume.rampTo(db, 0.1);
      } else {
        if (players.current.has(track)) {
          players.current.player(track).volume.rampTo(db, 0.1);
        }
      }
    },
    [isReady],
  );

  const toggleMute = React.useCallback(
    (track: keyof Stem, shouldMute: boolean) => {
      if (players.current?.has(track)) {
        players.current.player(track).mute = shouldMute;
      }
    },
    [],
  );

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
