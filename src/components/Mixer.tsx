import * as React from "react";
import ChannelStrip from "./ChannelStrip";
import { useAudioEngine } from "../hooks/useAudioEngine";
import type { Song, Stem } from "../types";
import { cacheSongStems, getCachedUrl } from "../utils/audioCache";
import ChordMonitor from "./ChordMonitor";

const TRACK_COLORS: Record<keyof Stem, string> = {
  vocals: "#ff0055", // Neon Pink
  drums: "#00ff88", // Neon Green
  bass: "#bc13fe", // Neon Purple
  inst: "#ff9900", // Neon Orange
};

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const Mixer: React.FC = () => {
  const [songs, setSongs] = React.useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = React.useState<Song | null>(null);
  const [songKey, setSelectedSongKey] = React.useState<string>("");
  const [isCached, setIsCached] = React.useState<boolean>(false);
  const [masterVolume, setMasterVolume] = React.useState<number>(0);
  const [mutedTracks, setMutedTracks] = React.useState<
    Record<keyof Stem, boolean>
  >({
    vocals: false,
    drums: false,
    bass: false,
    inst: false,
  });

  const {
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
  } = useAudioEngine(selectedSong);

  // Load song list on mount
  React.useEffect(() => {
    fetch("/songs.json")
      .then((res) => res.json())
      .then((data) => {
        const sortedSongs = [...data].sort((a, b) =>
          a.title.localeCompare(b.title),
        );
        setSongs(sortedSongs);
      })
      .catch((err) => console.error("Manifest load error:", err));
  }, []);

  const checkCacheStatus = async (stems: Stem) => {
    if (typeof window === "undefined" || !window.caches) {
      console.warn(
        "Cache API not supported in this browser context (check HTTPS)",
      );
      setIsCached(false);
      return;
    }

    try {
      if (!stems) {
        return;
      }
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
  React.useEffect(() => {
    if (selectedSong) {
      checkCacheStatus(selectedSong.stems);
      setSelectedSongKey(selectedSong.key);
    } else {
      setIsCached(false);
    }
  }, [selectedSong]);

  const handleChordScan = React.useCallback(
    async (updateProgress: (p: number) => void) => {
      if (!selectedSong) return null;

      try {
        const instUrl = await getCachedUrl(selectedSong.stems.bass);
        const response = await fetch(instUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioCtx =
          new // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        audioCtx.close();

        const duration = audioBuffer.duration;
        const sampleRate = audioBuffer.sampleRate;
        const stepSize = 0.25; // High resolution scanning (250ms)
        const chordMap: { time: number; label: string }[] = [];

        // PERSISTENCE LOGIC
        let currentVote = "";
        let voteCounter = 0;
        const REQUIRED_VOTES = 2; // Reduced to 0.5s to capture faster tempo changes

        for (let t = 0; t < duration; t += stepSize) {
          const startSample = Math.floor(t * sampleRate);
          const chunk = audioBuffer
            .getChannelData(0)
            .slice(startSample, startSample + 4096);

          let maxAmp = 0;
          let maxIdx = 0;
          for (let i = 0; i < chunk.length; i++) {
            const amp = Math.abs(chunk[i]);
            if (amp > maxAmp) {
              maxAmp = amp;
              maxIdx = i;
            }
          }

          const freq = maxIdx * (sampleRate / chunk.length);
          const midi = Math.round(12 * Math.log2(freq / 440) + 69);

          // Lower threshold (0.01) to detect quieter notes
          const detectedLabel = maxAmp > 0.01 ? NOTES[midi % 12] : "--";

          // VOTING SYSTEM
          if (detectedLabel === currentVote) {
            voteCounter++;
          } else {
            currentVote = detectedLabel;
            voteCounter = 1;
          }

          // Commit logic: Capture the change once stability is reached
          if (voteCounter === REQUIRED_VOTES) {
            if (
              chordMap.length === 0 ||
              chordMap[chordMap.length - 1].label !== currentVote
            ) {
              // Register chord at the timestamp where the note started being stable
              const startTime = t - stepSize * (REQUIRED_VOTES - 1);
              chordMap.push({
                time: Math.max(0, startTime),
                label: currentVote,
              });
            }
          }

          updateProgress(Math.round((t / duration) * 100));

          // Yield for UI thread responsiveness
          if (Math.floor(t / stepSize) % 40 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        // Fallback: If map is empty (e.g. very dynamic song), return at least the first detected note
        if (chordMap.length === 0 && currentVote !== "") {
          chordMap.push({ time: 0, label: currentVote });
        }

        return chordMap;
      } catch (err) {
        console.error("Scanner Bridge Error:", err);
        throw err;
      }
    },
    [selectedSong],
  );

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

  const handlePitchChange = (transpose: number) => {
    if (!selectedSong) {
      return;
    }
    changePitch(transpose);

    const newIdx = transpose + NOTES.lastIndexOf(selectedSong?.key);

    let newKey = NOTES.at(newIdx);

    if (newKey === undefined) {
      if (newIdx > 11) {
        newKey = NOTES.at(newIdx - 12);
      }
    }

    if (!newKey) {
      console.log("Error on Change Key");
      return;
    }

    setSelectedSongKey(newKey);
  };

  const handleDownload = async () => {
    if (selectedSong && !isCached) {
      try {
        const stems = selectedSong.stems as unknown as Record<string, string>;
        alert(`${selectedSong.title} is now available offline!`);
        await cacheSongStems(stems);
        setIsCached(true);
      } catch (error) {
        alert("Download failed");
        console.log(error);
      }
    }
  };

  const handleToggleMute = (trackId: keyof Stem) => {
    const newState = !mutedTracks[trackId];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setMutedTracks((prev: any) => ({ ...prev, [trackId]: newState }));
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

      <ChordMonitor
        songId={selectedSong?.id}
        currentTime={currentTime}
        transpose={transpose}
        isReady={isReady}
        onStartScan={handleChordScan}
      />

      <div className="console-bed">
        <div className="transpose-utility">
          <span className="util-label">
            PITCH: {transpose > 0 ? `+${transpose}` : transpose} KEY: {songKey}
          </span>
          <div className="pitch-btns">
            <button onClick={() => handlePitchChange(transpose - 1)}>-</button>
            <button onClick={() => handlePitchChange(0)}>RESET</button>
            <button onClick={() => handlePitchChange(transpose + 1)}>+</button>
          </div>
        </div>
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
