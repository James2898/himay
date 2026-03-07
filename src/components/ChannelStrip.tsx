import React from "react";
import { type Stem } from "../types";

interface ChannelStripProps {
  label: string;
  trackId: keyof Stem;
  isMuted: boolean;
  onToggleMute: (trackId: keyof Stem) => void;
  onVolumeChange: (trackId: keyof Stem | "master", db: number) => void;
  trackColor: string;
}

const ChannelStrip: React.FC<ChannelStripProps> = ({
  label,
  trackId,
  onVolumeChange,
  isMuted,
  onToggleMute,
  trackColor,
}) => {
  const [volume, setVolume] = React.useState<number>(-10); // Matches defaultValue

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    onVolumeChange(trackId, val);
  };

  return (
    <div className={`channel-strip ${isMuted ? "muted" : ""}`}>
      {/* 1. Dynamic Glow: Define the color as a CSS variable inline */}
      <div
        className="track-readout"
        style={{ color: trackColor, textShadow: `0 0 5px ${trackColor}` }}
      >
        {volume > -60 ? `${volume.toFixed(0)}dB` : "-∞"}
      </div>
      <div
        className="fader-track glow-track"
        style={{ "--glow-color": trackColor } as React.CSSProperties}
      >
        <input
          type="range"
          min="-60"
          max="6"
          step="1"
          defaultValue="-10"
          className="fader-input"
          onChange={(e) => {
            if (!isMuted) {
              // Only update if not muted
              onVolumeChange(trackId, parseFloat(e.target.value));
            }
          }}
          disabled={isMuted}
        />
      </div>

      {/* 2. Dynamic Mute Glow: Add 'active' class when NOT muted */}
      <button
        className={`mute-btn ${!isMuted ? "active-glow" : ""}`}
        onClick={() => onToggleMute(trackId)}
      >
        {label}
      </button>
    </div>
  );
};

export default ChannelStrip;
