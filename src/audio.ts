/**
 * Tiny synthesized sound cues via the Web Audio API — no audio files,
 * nothing fetched, nothing stored. Each cue is a short oscillator
 * envelope shaped to the moment: a paper flick, a brass chime for a
 * boundary, a heavy descending thud for a wicket.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (ctx === null) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

function tone(
  ac: AudioContext,
  opts: {
    type: OscillatorType;
    from: number;
    to?: number;
    at?: number;
    duration: number;
    volume?: number;
  },
): void {
  const { type, from, to, at = 0, duration, volume = 0.06 } = opts;
  const start = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.start(start);
  osc.stop(start + duration);
}

/** A dry paper flick as the page turns. */
export function playFlip(): void {
  const ac = audioContext();
  if (!ac) return;
  tone(ac, { type: 'triangle', from: 1100, to: 160, duration: 0.09, volume: 0.04 });
}

/** A quiet dab for the ones, twos and threes. */
export function playRuns(): void {
  const ac = audioContext();
  if (!ac) return;
  tone(ac, { type: 'triangle', from: 500, to: 340, duration: 0.1, volume: 0.035 });
}

/** Rising chime for a four; a taller arpeggio for six. */
export function playBoundary(six: boolean): void {
  const ac = audioContext();
  if (!ac) return;
  const notes = six ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 880];
  for (let i = 0; i < notes.length; i++) {
    tone(ac, { type: 'sine', from: notes[i], at: i * 0.08, duration: six ? 0.3 : 0.2, volume: 0.07 });
  }
}

/** Timber — a heavy descending thud with a low undertone. */
export function playWicket(): void {
  const ac = audioContext();
  if (!ac) return;
  tone(ac, { type: 'sawtooth', from: 220, to: 55, duration: 0.45, volume: 0.08 });
  tone(ac, { type: 'triangle', from: 160, to: 40, at: 0.05, duration: 0.4, volume: 0.06 });
}
