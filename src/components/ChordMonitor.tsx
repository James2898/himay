import * as React from "react";

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

interface ChordEntry {
  time: number;
  label: string;
}

type ChordMonitorProps = {
  songId: string | undefined;
  currentTime: number;
  transpose: number;
  isReady: boolean;
  onStartScan: (
    updateProgress: (p: number) => void,
  ) => Promise<ChordEntry[] | null>;
};

const ChordMonitor = ({
  songId,
  currentTime,
  transpose,
  isReady,
  onStartScan,
}: ChordMonitorProps) => {
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState(0);
  const [chordMap, setChordMap] = React.useState<ChordEntry[]>([]);

  // Load existing chords from storage on mount or song change
  React.useEffect(() => {
    if (songId) {
      const saved = localStorage.getItem(`chords_${songId}`);
      if (saved) {
        setChordMap(JSON.parse(saved));
      } else {
        setChordMap([]);
      }
    }
    // Reset scanning state if song changes
    setIsScanning(false);
    setScanProgress(0);
  }, [songId]);

  // Utility to handle transposition logic for display
  const getTransposedLabel = (
    originalLabel: string | undefined,
    shift: number,
  ) => {
    if (!originalLabel || originalLabel === "--") return "--";
    const match = originalLabel.match(/^([A-G][b#]?)(.*)$/);
    if (!match) return originalLabel;

    const root = match[1];
    const quality = match[2];

    // Normalize flats/sharps
    const normalizedRoot = root
      .replace("Eb", "D#")
      .replace("Bb", "A#")
      .replace("Ab", "G#")
      .replace("Db", "C#")
      .replace("Gb", "F#");
    const currentIndex = CHROMATIC_SCALE.indexOf(normalizedRoot);
    if (currentIndex === -1) return originalLabel;

    let newIndex = (currentIndex + shift) % 12;
    if (newIndex < 0) newIndex += 12;

    return CHROMATIC_SCALE[newIndex] + quality;
  };

  // Find current and next chords based on current time
  const activeChord = React.useMemo(() => {
    if (!chordMap.length) return null;
    return [...chordMap].reverse().find((c) => c.time <= currentTime);
  }, [chordMap, currentTime]);

  const nextChord = React.useMemo(() => {
    if (!chordMap.length) return null;
    return chordMap.find((c) => c.time > currentTime);
  }, [chordMap, currentTime]);

  // Manual Trigger for Scanning
  const handleGenerate = async () => {
    if (!isReady || !songId) return;
    setIsScanning(true);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await onStartScan((p: any) => setScanProgress(p));
      if (result) {
        setChordMap(result);
        localStorage.setItem(`chords_${songId}`, JSON.stringify(result));
      }
    } catch (err) {
      console.error("Chord analysis failed:", err);
    } finally {
      setIsScanning(false);
    }
  };

  const clearMap = () => {
    if (window.confirm("Remove chord map for this song?")) {
      localStorage.removeItem(`chords_${songId}`);
      setChordMap([]);
    }
  };

  return (
    <div className="chord-monitor-outer">
      {/* HEADER: Outside and to the top right */}
      {chordMap.length > 0 && (
        <div className="chord-meta-header">
          <span className="live-label">LIVE HARMONICS</span>
          <button className="reset-button" onClick={clearMap}>
            RESET
          </button>
        </div>
      )}

      <div className="chord-box-main">
        {chordMap.length > 0 ? (
          <div className="performance-layout">
            {/* Centered current chord */}
            <div className="chord-primary-center">
              <h2 className="chord-main-text">
                {getTransposedLabel(activeChord?.label, transpose)}
              </h2>
            </div>

            {/* Next chord to the right, dimmed */}
            {nextChord && (
              <div className="chord-next-preview">
                {getTransposedLabel(nextChord?.label, transpose)}
              </div>
            )}

            {/* Beat pulse indicator positioned near the center */}
            <div className="pulse-indicator" />
          </div>
        ) : (
          <div className="setup-view">
            {isScanning ? (
              <div className="scanner-container">
                <div className="scanner-header">
                  <span>MAPPING FREQUENCIES...</span>
                  <span>{scanProgress}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                className={`gen-btn ${!isReady ? "disabled" : ""}`}
                onClick={handleGenerate}
                disabled={!isReady}
              >
                ◈ GENERATE CHORD MAP
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChordMonitor;
