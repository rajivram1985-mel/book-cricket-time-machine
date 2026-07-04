import type {
  Ball,
  BattingStats,
  BowlingStats,
  Era,
  Outcome,
  Probabilities,
  RunCount,
} from './types';

/** One-line change to retune pacing. */
export const SPELL = { maxBalls: 12, maxWickets: 2 };

/** The imaginary book used for page-flip flavor in Stats mode. */
export const VIRTUAL_BOOK = { title: 'Wisden Cricketers’ Almanack', pages: 364 };

export const MIN_PAGES = 21;

const CURRENT_YEAR = new Date().getFullYear();

export type Rng = () => number;

export function randInt(min: number, max: number, rng: Rng = Math.random): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Classic book-cricket digit rules: 0 = out, 1–6 = that many runs, 7/8/9 = 1 run. */
export function digitToOutcome(digit: number): Outcome {
  if (digit === 0) return { kind: 'wicket' };
  if (digit >= 1 && digit <= 6) return { kind: 'runs', runs: digit as RunCount };
  return { kind: 'runs', runs: 1 };
}

export function drawClassic(pageCount: number, rng: Rng = Math.random): Ball {
  const page = randInt(1, pageCount, rng);
  const digit = page % 10;
  return { page, digit, outcome: digitToOutcome(digit) };
}

export function erasOverlap(a: Era, b: Era): boolean {
  const endA = a.endYear ?? CURRENT_YEAR;
  const endB = b.endYear ?? CURRENT_YEAR;
  return a.startYear <= endB && b.startYear <= endA;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Stats-mode outcome weights. Centered so an average matchup lands near the
 * Classic distribution (10% wicket), then pushed around by batting average
 * vs bowling threat, and boundary/six habits vs bowler economy.
 * Pure and deterministic given inputs — the UI surfaces the result verbatim
 * in the odds panel.
 */
export function computeProbabilities(
  bat: BattingStats,
  bowl: BowlingStats,
  eraAdjusted: boolean,
): Probabilities {
  const batSkill = bat.average / 50; // ~1.0 for an all-time great
  const bowlSkill = 25 / bowl.average; // ~1.0 for an all-time great
  let wicket = (0.1 * bowlSkill * bowl.wicketThreat * 1.15) / batSkill;
  if (eraAdjusted) wicket *= 1.35;
  wicket = clamp(wicket, 0.03, 0.3);

  const aggression = bat.strikeRate / 75; // ~0.7 grinder … ~1.2 blaster
  const containment = 2.8 / bowl.economy; // >1 = miserly bowler
  const weights: Record<RunCount, number> = {
    1: 46,
    2: 20 * aggression,
    3: 5,
    4: (bat.boundaryPercent * 2.2 * aggression) / containment,
    5: 1.5,
    6: (bat.sixPercent * 6 * aggression) / containment,
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const scale = (1 - wicket) / total;
  const runs = Object.fromEntries(
    (Object.entries(weights) as [string, number][]).map(([k, w]) => [k, w * scale]),
  ) as Record<RunCount, number>;

  return { wicket, runs };
}

export function drawOutcome(probs: Probabilities, rng: Rng = Math.random): Outcome {
  let r = rng();
  if (r < probs.wicket) return { kind: 'wicket' };
  r -= probs.wicket;
  for (const runs of [1, 2, 3, 4, 5, 6] as RunCount[]) {
    if (r < probs.runs[runs]) return { kind: 'runs', runs };
    r -= probs.runs[runs];
  }
  return { kind: 'runs', runs: 1 }; // float dust
}

/**
 * Keeps the book metaphor honest in Stats mode: given a drawn outcome, pick a
 * page whose last digit would have produced it under Classic rules.
 */
export function pageForOutcome(
  outcome: Outcome,
  pageCount: number,
  rng: Rng = Math.random,
): { page: number; digit: number } {
  const candidates =
    outcome.kind === 'wicket' ? [0] : outcome.runs === 1 ? [1, 7, 8, 9] : [outcome.runs];
  const digit = candidates[randInt(0, candidates.length - 1, rng)];
  if (digit === 0) {
    const count = Math.floor(pageCount / 10);
    return { page: 10 * randInt(1, count, rng), digit };
  }
  const count = Math.floor((pageCount - digit) / 10) + 1;
  return { page: digit + 10 * randInt(0, count - 1, rng), digit };
}

export function drawStats(
  probs: Probabilities,
  pageCount: number = VIRTUAL_BOOK.pages,
  rng: Rng = Math.random,
): Ball {
  const outcome = drawOutcome(probs, rng);
  const { page, digit } = pageForOutcome(outcome, pageCount, rng);
  return { page, digit, outcome };
}

/** Momentum shift toward batsman (+) or bowler (−) for one ball. */
export function momentumShift(outcome: Outcome): number {
  if (outcome.kind === 'wicket') return -38;
  switch (outcome.runs) {
    case 6:
      return 26;
    case 5:
      return 20;
    case 4:
      return 18;
    case 3:
      return 9;
    case 2:
      return 6;
    default:
      return 3;
  }
}

export type Winner = 'batsman' | 'bowler' | 'shared';

export function decideWinner(runs: number, wickets: number): Winner {
  if (wickets >= SPELL.maxWickets) return runs >= 20 ? 'shared' : 'bowler';
  if (runs >= 16) return 'batsman';
  if (runs >= 9) return 'shared';
  return 'bowler';
}

export function validatePageCount(raw: string): { ok: true; pages: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: 'Page count must be a whole number — no decimals, no letters.' };
  }
  const pages = Number(trimmed);
  if (pages < MIN_PAGES) {
    return { ok: false, error: `That’s a pamphlet, not a book! Needs more than ${MIN_PAGES - 1} pages.` };
  }
  if (pages > 20000) {
    return { ok: false, error: 'No book is that long. Keep it under 20,000 pages.' };
  }
  return { ok: true, pages };
}
