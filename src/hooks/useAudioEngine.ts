import { useRef, useState, useEffect, useCallback } from "react";
import * as Tone from "tone";
import type { Song, Stem } from "../types";

// Constant to avoid TypeScript 'urls' property errors and for clean iteration
const STEM_KEYS: (keyof Stem)[] = ["vocals", "drums", "bass", "inst"];

export const useAudioEngine = (selectedSong: Song | null) => {
  const players = useRef<Tone.Players | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // 1. Initialize / Load Song Stems
  useEffect(() => {
    if (!selectedSong) return;

    setIsReady(false);
    setIsPlaying(false);
    Tone.getTransport().stop();
    Tone.getTransport().seconds = 0;

    // Clean up previous players to prevent memory leaks
    if (players.current) {
      players.current.dispose();
    }

    players.current = new Tone.Players(
      {
        vocals: selectedSong.stems.vocals,
        drums: selectedSong.stems.drums,
        bass: selectedSong.stems.bass,
        inst: selectedSong.stems.inst,
      },
      () => {
        console.log("All CDN Stems Loaded");
        setIsReady(true);
      },
    ).toDestination();

    return () => {
      players.current?.dispose();
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
    const context = Tone.getContext();
    if (context.state !== "running") {
      await Tone.start();
    }

    if (isPlaying) {
      Tone.getTransport().pause();
      players.current?.stopAll();
      setIsPlaying(false); // CRITICAL: Ensure state is updated to false
    } else {
      const startTime = Tone.getTransport().seconds;
      STEM_KEYS.forEach((track) => {
        players.current?.player(track).start(0, startTime);
      });
      Tone.getTransport().start();
      setIsPlaying(true); // CRITICAL: Ensure state is updated to true
    }
  }, [isPlaying]);

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
      if (track === "master") {
        // Controls the final output gain of the app
        Tone.getDestination().volume.rampTo(db, 0.1);
      } else if (players.current?.has(track)) {
        players.current.player(track).volume.rampTo(db, 0.1);
      }
    },
    [],
  );

  const toggleMute = useCallback((track: keyof Stem, shouldMute: boolean) => {
    if (players.current?.has(track)) {
      players.current.player(track).mute = shouldMute;
    }
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
