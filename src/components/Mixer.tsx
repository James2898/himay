import React, { useState, useEffect } from "react";
import ChannelStrip from "./ChannelStrip";
import { useAudioEngine } from "../hooks/useAudioEngine";
import type { Song, Stem } from "../types";

const TRACK_COLORS: Record<keyof Stem, string> = {
  vocals: "#ff0055", // Neon Pink
  drums: "#00ff88", // Neon Green
  bass: "#bc13fe", // Neon Purple
  inst: "#ff9900", // Neon Orange
};

const Mixer: React.FC = () => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [masterVolume, setMasterVolume] = useState<number>(0);
  const [mutedTracks, setMutedTracks] = useState<Record<keyof Stem, boolean>>({
    vocals: false,
    drums: false,
    bass: false,
    inst: false,
  });

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

  useEffect(() => {
    fetch("/songs.json")
      .then((res) => res.json())
      .then((data) => setSongs(data));
  }, []);

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
          onChange={(e) =>
            setSelectedSong(songs.find((s) => s.id === e.target.value) || null)
          }
        >
          <option value="">Select Song...</option>
          {songs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </header>

      {/* LINE 2: Transport Centered */}
      <div className="transport-center">
        <button className="transport-btn stop" onClick={stopPlay}>
          ■
        </button>

        {/* The 'active-play' class is added when music is currently playing */}
        <button
          className={`transport-btn play ${isPlaying ? "active-play" : ""}`}
          onClick={togglePlay}
          disabled={!isReady}
        >
          {isPlaying ? "Ⅱ" : "▶"}
        </button>
      </div>

      {/* LINE 3: Seeker Full Width */}
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

      {/* CONSOLE: Stems Top, Master Bottom */}
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
              /* Pass the unique color down */
              trackColor={TRACK_COLORS[id]}
            />
          ))}
        </div>

        <div className="master-row-container">
          <div className="master-label-wrapper">
            <span className="master-label">MASTER</span>
            {/* Dynamic Value Display */}
            <span className="volume-value">
              {masterVolume > -60 ? `${masterVolume.toFixed(1)}dB` : "-∞"}
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
