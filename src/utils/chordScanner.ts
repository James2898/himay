// import * as Tone from "tone";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const scanTrackForChords = async (
  audioUrl: string,
  onProgress: (percent: number) => void,
) => {
  // 1. Fetch & Decode (Works with Blob URLs from your cache)
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();

  const tempCtx = new AudioContext();
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  tempCtx.close();

  const duration = audioBuffer.duration;
  const sampleRate = audioBuffer.sampleRate;
  const stepSize = 0.5; // Detect every 0.5s
  const chordMap: { time: number; label: string }[] = [];

  // 2. Scan Loop
  for (let t = 0; t < duration; t += stepSize) {
    const startSample = Math.floor(t * sampleRate);
    const channelData = audioBuffer
      .getChannelData(0)
      .slice(startSample, startSample + 4096);

    // Detect Root Note (Simplified FFT-style peak detection)
    const detected = detectRoot(channelData, sampleRate);

    // Logic: Only add if the chord changed or it's the first chord
    if (
      chordMap.length === 0 ||
      chordMap[chordMap.length - 1].label !== detected
    ) {
      chordMap.push({ time: t, label: detected });
    }

    // Update UI progress
    onProgress(Math.round((t / duration) * 100));

    // Pause briefly every 10 iterations to prevent Android UI lock
    if (Math.floor(t / stepSize) % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return chordMap;
};

function detectRoot(buffer: Float32Array, sampleRate: number): string {
  let maxAmp = 0;
  let maxIdx = 0;
  // Basic peak detection
  for (let i = 0; i < buffer.length; i++) {
    const amp = Math.abs(buffer[i]);
    if (amp > maxAmp) {
      maxAmp = amp;
      maxIdx = i;
    }
  }
  // If it's too quiet, return null/previous
  if (maxAmp < 0.01) return "--";

  const freq = maxIdx * (sampleRate / buffer.length);
  // Convert frequency to MIDI note index
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  return NOTES[midi % 12] || "--";
}
