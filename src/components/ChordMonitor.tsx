import * as React from "react";
import type { ChordEntry, Song } from "../types";

const CHROMATIC_SCALE = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const transposeNote = (note: string, shift: number): string => {
  const normalized = note
    .replace("Eb", "D#")
    .replace("Bb", "A#")
    .replace("Ab", "G#")
    .replace("Db", "C#")
    .replace("Gb", "F#");
  const currentIndex = CHROMATIC_SCALE.indexOf(normalized);
  if (currentIndex === -1) return note;

  let newIndex = (currentIndex + shift) % 12;
  if (newIndex < 0) newIndex += 12;

  return CHROMATIC_SCALE[newIndex];
};

const getTransposedLabel = (
  originalLabel: string | undefined,
  shift: number,
): string => {
  if (!originalLabel || originalLabel === "--") return "--";

  if (originalLabel.includes("/")) {
    const slashIndex = originalLabel.indexOf("/");
    const mainPart = originalLabel.slice(0, slashIndex);
    const bassPart = originalLabel.slice(slashIndex + 1);

    const match = mainPart.match(/^([A-G][b#]?)(.*)$/);
    if (!match) return originalLabel;

    const root = match[1];
    const quality = match[2];
    const transposedRoot = transposeNote(root, shift);

    const bassMatch = bassPart.match(/^([A-G][b#]?)$/);
    const transposedBass = bassMatch
      ? transposeNote(bassMatch[1], shift)
      : bassPart;

    return `${transposedRoot}${quality}/${transposedBass}`;
  }

  const match = originalLabel.match(/^([A-G][b#]?)(.*)$/);
  if (!match) return originalLabel;

  const root = match[1];
  const quality = match[2];
  return `${transposeNote(root, shift)}${quality}`;
};

const EMPTY_CHORDS: ChordEntry[] = [];

export interface ChordMonitorProps {
  selectedSong?: Song | null;
  currentTime: number;
  transpose: number;
}

const ChordMonitor: React.FC<ChordMonitorProps> = ({
  selectedSong,
  currentTime,
  transpose,
}) => {
  const chords = selectedSong?.chords ?? EMPTY_CHORDS;

  // Find current and next chords based on current time
  const activeChord = React.useMemo(() => {
    if (!chords.length) return null;
    for (let i = chords.length - 1; i >= 0; i--) {
      if (chords[i].time <= currentTime) {
        return chords[i];
      }
    }
    return null;
  }, [chords, currentTime]);

  const prevChord = React.useMemo(() => {
    if (!chords.length || !activeChord) return null;
    for (let i = chords.length - 1; i >= 0; i--) {
      if (chords[i].time < activeChord.time) {
        return chords[i];
      }
    }
    return null;
  }, [chords, activeChord]);

  const nextChord = React.useMemo(() => {
    if (!chords.length) return null;
    for (let i = 0; i < chords.length; i++) {
      if (chords[i].time > currentTime) {
        return chords[i];
      }
    }
    return null;
  }, [chords, currentTime]);

  return (
    <div className="chord-monitor-outer">
      {chords.length > 0 && (
        <div className="chord-meta-header">
          <span className="live-label">LIVE HARMONICS</span>
        </div>
      )}

      <div className="chord-box-main">
        <div className="performance-layout">
          {/* Centered current chord */}
          <div className="chord-primary-center">
            <h2 className="chord-main-text">
              {activeChord
                ? getTransposedLabel(activeChord.label, transpose)
                : "--"}
            </h2>
          </div>

          {/* Next chord to the right, dimmed */}
          {nextChord && (
            <div className="chord-next-preview">
              {getTransposedLabel(nextChord.label, transpose)}
            </div>
          )}

          {prevChord && (
            <div className="chord-prev-preview">
              {getTransposedLabel(prevChord.label, transpose)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChordMonitor;
