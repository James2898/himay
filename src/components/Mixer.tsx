import React, { useState, useEffect } from "react";
import ChannelStrip from "./ChannelStrip";
import { useAudioEngine } from "../hooks/useAudioEngine";
import type { Song, Stem } from "../types";
import { cacheSongStems } from "../utils/audioCache";

const TRACK_COLORS: Record<keyof Stem, string> = {
  vocals: "#ff0055", // Neon Pink
  drums: "#00ff88", // Neon Green
  bass: "#bc13fe", // Neon Purple
  inst: "#ff9900", // Neon Orange
};

const Mixer: React.FC = () => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [isCached, setIsCached] = useState<boolean>(false);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [masterVolume, setMasterVolume] = useState<number>(0);
  const [mutedTracks, setMutedTracks] = useState<Record<keyof Stem, boolean>>({
    vocals: false,
    drums: false,
    bass: false,
    inst: false,
  });

  const checkCacheStatus = async (stems: Stem) => {
    // 1. Guard against missing Cache API
    if (typeof window === "undefined" || !window.caches) {
      console.warn(
        "Cache API not supported in this browser context (check HTTPS)",
      );
      setIsCached(false);
      return;
    }

    try {
      if (!stems) return;
      const cache = await caches.open("himay-stems-v1");
      const urls = Object.values(stems);
      const matches = await Promise.all(urls.map((url) => cache.match(url)));
      setIsCached(matches.every((match) => match !== undefined));
    } catch (error) {
      console.error("Cache check failed:", error);
      setIsCached(false);
    }
  };

  // Trigger cache check whenever the selected song changes
  useEffect(() => {
    if (selectedSong) {
      checkCacheStatus(selectedSong.stems);
    } else {
      setIsCached(false);
    }
  }, [selectedSong]);

  const {
    isReady,
    isPlaying,
    currentTime,
    togglePlay,
    stopPlay,
    seekTo,
    updateVolume,
    toggleMute,
  } = useAudioEngine(selectedSong);

  // Load song list on mount
  useEffect(() => {
    fetch("/songs.json")
      .then((res) => res.json())
      .then((data) => setSongs(data))
      .catch((err) => console.error("Manifest load error:", err));
  }, []);

  const handleSongChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const songId = e.target.value;
    const song = songs.find((s) => s.id === songId) || null;

    setSelectedSong(song);

    stopPlay();

    if (song) {
      checkCacheStatus(song.stems).catch(console.error);
    } else {
      setIsCached(false);
    }
  };

  const handleDownload = async () => {
    if (selectedSong) {
      try {
        // Option 1 casting
        const stems = selectedSong.stems as unknown as Record<string, string>;
        await cacheSongStems(stems);
        alert(`${selectedSong.title} is now available offline!`);
      } catch (error) {
        alert("Failed to save song. Check connection.");
      }
    }
  };

  const handleToggleMute = (trackId: keyof Stem) => {
    const newState = !mutedTracks[trackId];
    setMutedTracks((prev) => ({ ...prev, [trackId]: newState }));
    toggleMute(trackId, newState);
  };

  const handleMasterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setMasterVolume(val);
    updateVolume("master", val);
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="mixer-container">
      <header className="mixer-header-inline">
        <h1 className="logo">HIMAY</h1>
        <select
          className="song-picker"
          onChange={handleSongChange}
          value={selectedSong?.id || ""}
        >
          <option value="">Select Song...</option>
          {songs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </header>

      <div className="transport-center">
        <button
          className={`transport-btn download ${isCached ? "cached" : ""}`}
          onClick={handleDownload}
          title={isCached ? "Saved Offline" : "Save Offline"}
          disabled={!selectedSong || !isReady || isCached}
        >
          {isCached ? "✓" : "↓"}
        </button>
        <button
          className="transport-btn stop"
          onClick={stopPlay}
          disabled={!isReady}
        >
          ■
        </button>

        <button
          className={`transport-btn play ${isPlaying ? "active-play" : ""}`}
          onClick={togglePlay}
          disabled={!isReady || !selectedSong}
        >
          {!selectedSong ? "▶" : isReady ? (isPlaying ? "Ⅱ" : "▶") : "..."}
        </button>
      </div>

      <div className="seeker-row">
        <span className="time">{formatTime(currentTime)}</span>
        <input
          type="range"
          className="seeker-bar"
          min="0"
          max={selectedSong?.duration || 100}
          step="0.1"
          value={currentTime}
          onChange={(e) => seekTo(parseFloat(e.target.value))}
        />
        <span className="time">
          {selectedSong ? formatTime(selectedSong.duration) : "0:00"}
        </span>
      </div>

      <div className="console-bed">
        <div className="stems-container">
          {(["vocals", "drums", "bass", "inst"] as (keyof Stem)[]).map((id) => (
            <ChannelStrip
              key={id}
              label={id.toUpperCase()}
              trackId={id}
              isMuted={mutedTracks[id]}
              onToggleMute={handleToggleMute}
              onVolumeChange={updateVolume}
              trackColor={TRACK_COLORS[id]}
            />
          ))}
        </div>

        <div className="master-row-container">
          <div className="master-label-wrapper">
            <span className="master-label">MASTER</span>
            <span className="volume-value">
              {masterVolume > -60 ? `${masterVolume.toFixed(0)}dB` : "-∞"}
            </span>
          </div>
          <input
            type="range"
            className="master-horizontal-fader"
            min="-60"
            max="6"
            step="0.5"
            defaultValue="0"
            onChange={handleMasterChange}
          />
        </div>
      </div>
    </div>
  );
};

export default Mixer;
