import type { Outcome } from './types';
import { MOMENT_LINES, type MomentCategory } from './voiceLines';

/**
 * Which pre-generated clip (if any) a ball deserves. Mirrors `commentaryFor`'s
 * priority order in `commentary.ts` exactly — voice and on-screen text must
 * never disagree about what just happened. Singles, twos, threes and fives
 * stay silent by design: the promise was "wickets, sixes, streak lines,
 * power plays and verdicts", not a line read on every ball.
 */
export function resolveBallMoment(
  outcome: Outcome,
  consecutiveSixes: number,
  flavor: { doubled?: boolean; attacking?: boolean } = {},
): MomentCategory | null {
  if (flavor.doubled) return outcome.kind === 'wicket' ? 'powerWicket' : 'powerHit';
  if (outcome.kind === 'wicket') return flavor.attacking ? 'attackWicket' : 'wicket';
  if (outcome.kind === 'runs' && outcome.runs === 6) {
    return consecutiveSixes >= 3 ? 'sixStreak' : 'six';
  }
  if (outcome.kind === 'runs' && outcome.runs === 4) return 'four';
  return null;
}

/**
 * The verdict-moment clip. `wentTheDistance` marks a finish decided on the
 * very last ball without being bowled out — the signature down-to-the-wire
 * moment — and takes priority over a plain win/loss/tie read. A conquered
 * Gauntlet outranks everything.
 */
export function resolveMatchMoment(
  outcome: 'win' | 'loss' | 'tie',
  wentTheDistance: boolean,
  gauntletConquered = false,
): MomentCategory {
  if (gauntletConquered) return 'gauntletWin';
  if (wentTheDistance) return 'clutchFinish';
  return outcome === 'win' ? 'matchWin' : outcome === 'loss' ? 'matchLoss' : 'matchTie';
}

// ---------- browser playback (untested by design, like the rest of main.ts's DOM layer) ----------

const lastIndex = new Map<string, number>();

/** Avoids repeating the exact same clip twice in a row within a category. */
function pickIndex(key: string, poolSize: number): number {
  if (poolSize <= 1) return 0;
  let idx = Math.floor(Math.random() * poolSize);
  if (idx === lastIndex.get(key)) idx = (idx + 1) % poolSize;
  lastIndex.set(key, idx);
  return idx;
}

function clipUrl(personaId: string, path: string): string {
  return `/audio/voice/${personaId}/${path}`;
}

/**
 * Fires and forgets. If the clip hasn't been generated yet (no ElevenLabs
 * key run), the browser's 404 is swallowed here — the game is fully
 * playable, just silent, until `npm run voice:generate` populates the files.
 */
function playClip(personaId: string, path: string): void {
  const audio = new Audio(clipUrl(personaId, path));
  audio.volume = 0.85;
  audio.addEventListener('error', () => {}, { once: true });
  void audio.play().catch(() => {});
}

export function playMomentVoice(category: MomentCategory, personaId: string): void {
  const idx = pickIndex(category, MOMENT_LINES[category].length);
  playClip(personaId, `${category}/${idx}.mp3`);
}

export function playNameCallout(playerId: string, personaId: string): void {
  playClip(personaId, `name/${playerId}.mp3`);
}
