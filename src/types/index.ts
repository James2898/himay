export interface Stem {
  vocals: string;
  drums: string;
  bass: string;
  inst: string;
}

export interface ChordEntry {
  time: number;
  label: string;
}

export interface Song {
  id: string;
  title: string;
  duration: number;
  key: string;
  stems: Stem;
  chords?: ChordEntry[];
}
