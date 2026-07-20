import type {
  Ball,
  BattingStats,
  BowlingPlan,
  BowlingStats,
  Era,
  Outcome,
  Probabilities,
  RunCount,
  Stance,
} from './types';

/** One-line change to retune pacing. */
export const SPELL = Object.freeze({ maxBalls: 12, maxWickets: 2 });

/** The imaginary book used for page-flip flavor in Stats mode. */
export const VIRTUAL_BOOK = { title: 'Wisden Cricketers’ Almanack', pages: 364 };

export const MIN_PAGES = 21;

const CURRENT_YEAR = new Date().getFullYear();

export type Rng = () => number;

export function randInt(min: number, max: number, rng: Rng = Math.random): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Classic book-cricket digit rules: 0 = out, 1–6 = that many runs, 7/8/9 = 1 run.
 * Under a power play (schoolyard house rule) the mercy digits turn cruel:
 * 7/8/9 are OUT instead of a single — the price of doubled runs.
 */
export function digitToOutcome(digit: number, powerPlay = false): Outcome {
  if (digit === 0) return { kind: 'wicket' };
  if (digit >= 1 && digit <= 6) return { kind: 'runs', runs: digit as RunCount };
  return powerPlay ? { kind: 'wicket' } : { kind: 'runs', runs: 1 };
}

export function drawClassic(pageCount: number, rng: Rng = Math.random, powerPlay = false): Ball {
  const page = randInt(1, pageCount, rng);
  const digit = page % 10;
  return { page, digit, outcome: digitToOutcome(digit, powerPlay) };
}

/** Years between two careers that never overlapped; 0 if they did. */
export function eraGapYears(a: Era, b: Era): number {
  const endA = a.endYear ?? CURRENT_YEAR;
  const endB = b.endYear ?? CURRENT_YEAR;
  if (a.startYear <= endB && b.startYear <= endA) return 0;
  return a.startYear > endB ? a.startYear - endB : b.startYear - endA;
}

export function erasOverlap(a: Era, b: Era): boolean {
  return eraGapYears(a, b) === 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export const ERA_ADJUST_CAP = 0.35;
export const ERA_ADJUST_GRACE_YEARS = 15;
export const ERA_ADJUST_SATURATION_YEARS = 60;

/**
 * Scales the cross-era wicket bump by how far apart two careers actually
 * are. Careers within ERA_ADJUST_GRACE_YEARS of each other are close enough
 * in cricketing generations to duel penalty-free; beyond that the bump ramps
 * up with the gap, saturating at ERA_ADJUST_CAP once it reaches
 * ERA_ADJUST_SATURATION_YEARS.
 */
export function eraAdjustmentMultiplier(gapYears: number): number {
  const ramp = clamp(
    (gapYears - ERA_ADJUST_GRACE_YEARS) / (ERA_ADJUST_SATURATION_YEARS - ERA_ADJUST_GRACE_YEARS),
    0,
    1,
  );
  return 1 + ERA_ADJUST_CAP * ramp;
}

const SETTLING_IN_BALLS = 3;
const SETTLING_IN_BONUS = 0.6;

/** Extra dismissal risk while a batsman is still finding their feet, early in a spell. */
export function settlingInFactor(ballsFaced: number): number {
  return 1 + SETTLING_IN_BONUS * clamp(1 - ballsFaced / SETTLING_IN_BALLS, 0, 1);
}

const FATIGUE_CAP = 0.25;

/** Bowler control loosens as a spell wears on, making boundaries a little likelier late on. */
export function fatigueFactor(ballsFaced: number, maxBalls: number = SPELL.maxBalls): number {
  return 1 + FATIGUE_CAP * clamp(ballsFaced / maxBalls, 0, 1);
}

/**
 * Batting stances. `normal` must stay exact identity (×1 everywhere):
 * the daily challenge seeds its rival innings through the default path,
 * so any drift here silently rewrites every past and future daily.
 */
export const STANCES: Record<Stance, { label: string; wicketMult: number; boundaryMult: number }> =
  Object.freeze({
    defend: { label: 'Defend', wicketMult: 0.55, boundaryMult: 0.45 },
    normal: { label: 'Normal', wicketMult: 1, boundaryMult: 1 },
    attack: { label: 'Attack', wicketMult: 1.65, boundaryMult: 1.95 },
  });

/** Power play in Stats mode: runs count double, wicket odds double (capped). */
export const POWER_PLAY_WICKET_MULT = 2;
export const POWER_PLAY_WICKET_CAP = 0.6;

/**
 * Bowling plans — the mirror of Stance, chosen by the player while THEY
 * bowl (Stats mode only). `normal` must stay exact identity (×1
 * everywhere), same determinism rule as STANCES: bowling never happens in
 * the Daily's seeded innings, but the identity default keeps
 * computeProbabilities' four-arg call sites bit-identical regardless.
 */
export const BOWLING_PLANS: Record<
  BowlingPlan,
  { label: string; wicketMult: number; boundaryMult: number }
> = Object.freeze({
  normal: { label: 'Normal', wicketMult: 1, boundaryMult: 1 },
  attack: { label: 'Attack the stumps', wicketMult: 1.5, boundaryMult: 1.35 },
  tight: { label: 'Tight line', wicketMult: 0.7, boundaryMult: 0.55 },
  bait: { label: 'Temptation ball', wicketMult: 1.7, boundaryMult: 1.8 },
});

/** Upper bound on wicket odds after a bowling plan is applied — wider than the power-play cap so "bait" can meaningfully outrank "attack", but still finite. */
const BOWLING_PLAN_WICKET_CAP = 0.75;

/**
 * How much a batsman's natural strike rate pushes both their scoring AND
 * their dismissal risk. Anchored at ~1.0 for a strike rate of 75, so an
 * average-tempo batsman is exact identity (keeps the daily-determinism
 * contract when this is 1). Above ~0.7 grinder … ~1.2 blaster.
 */
function aggressionFactor(bat: BattingStats): number {
  return bat.strikeRate / 75;
}

/** Half-weight risk premium for playing aggressively — a blaster gets out more, a blocker survives longer. */
function aggressionRisk(bat: BattingStats): number {
  return 1 + (aggressionFactor(bat) - 1) * 0.5;
}

/**
 * Stats-mode outcome weights. Centered so an average matchup lands near the
 * Classic distribution (10% wicket), then pushed around by batting average
 * vs bowling threat, and boundary/six habits vs bowler economy. A batsman's
 * strike rate now cuts both ways: it lifts their scoring *and* their wicket
 * odds (a blaster scores faster but is more dismissable; a blocker survives
 * longer) — see aggressionRisk. Also shifts over the course of a spell: extra
 * risk for a batsman still settling in, and loosening bowler control
 * (fatigue) as the spell wears on. A stance multiplies wicket odds and
 * boundary weights after the base clamp; a power play doubles wicket odds on
 * top (runs doubling happens at scoring time). A bowling plan (session 9 —
 * the player's own choice while THEY bowl, see BOWLING_PLANS) applies last,
 * after every batting-side modifier — composes with stance/PP the same way
 * they compose with each other. The `normal`/no-power-play/no-plan path must
 * stay bit-identical to the four-arg form — the daily challenge's
 * determinism depends on it. Pure and deterministic given inputs — the UI
 * surfaces the result verbatim in the odds panel.
 */
export function computeProbabilities(
  bat: BattingStats,
  bowl: BowlingStats,
  eraGapYears = 0,
  ballsFaced = 0,
  stance: Stance = 'normal',
  powerPlay = false,
  bowlingPlan: BowlingPlan = 'normal',
): Probabilities {
  const batSkill = bat.average / 50; // ~1.0 for an all-time great
  const bowlSkill = 25 / bowl.average; // ~1.0 for an all-time great
  let wicket = (0.1 * bowlSkill * bowl.wicketThreat * 1.15 * aggressionRisk(bat)) / batSkill;
  wicket *= eraAdjustmentMultiplier(eraGapYears);
  wicket *= settlingInFactor(ballsFaced);
  wicket = clamp(wicket, 0.03, 0.3);
  const s = STANCES[stance];
  // applied after the base clamp so ×1 is exact identity (daily determinism)
  wicket = clamp(wicket * s.wicketMult, 0.02, 0.5);
  if (powerPlay) wicket = Math.min(wicket * POWER_PLAY_WICKET_MULT, POWER_PLAY_WICKET_CAP);
  const bp = BOWLING_PLANS[bowlingPlan];
  // applied last, after every other modifier, so `normal` (×1) is exact
  // identity — multiplying by 1.0 and clamping to a superset of the range
  // it's already inside never changes the value.
  wicket = clamp(wicket * bp.wicketMult, 0.01, BOWLING_PLAN_WICKET_CAP);

  const aggression = aggressionFactor(bat);
  const containment = (2.8 / bowl.economy) / fatigueFactor(ballsFaced); // >1 = miserly bowler
  const weights: Record<RunCount, number> = {
    1: 46,
    2: 20 * aggression,
    3: 5,
    4: (bat.boundaryPercent * 2.2 * aggression * s.boundaryMult * bp.boundaryMult) / containment,
    5: 1.5,
    6: (bat.sixPercent * 6 * aggression * s.boundaryMult * bp.boundaryMult) / containment,
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

export type MatchResult = 'defended' | 'chased' | 'tied';

/** First innings sets the total; the chase either passes it, ties it, or falls short. */
export function matchResult(firstInningsRuns: number, chaseRuns: number): MatchResult {
  if (chaseRuns > firstInningsRuns) return 'chased';
  if (chaseRuns === firstInningsRuns) return 'tied';
  return 'defended';
}

/**
 * Exact outcome distribution for Classic mode — a uniform draw over pages
 * 1..pageCount, aggregated to outcomes (7/8/9 fold into the single, or
 * into the wicket during a power play). Lets the luck report price
 * Classic balls just like Stats ones.
 */
export function classicProbabilities(pageCount: number, powerPlay = false): Probabilities {
  const endingIn = (d: number) =>
    d === 0 ? Math.floor(pageCount / 10) : d > pageCount ? 0 : Math.floor((pageCount - d) / 10) + 1;
  const mercy = endingIn(7) + endingIn(8) + endingIn(9);
  const runs = {
    1: (endingIn(1) + (powerPlay ? 0 : mercy)) / pageCount,
    2: endingIn(2) / pageCount,
    3: endingIn(3) / pageCount,
    4: endingIn(4) / pageCount,
    5: endingIn(5) / pageCount,
    6: endingIn(6) / pageCount,
  } as Record<RunCount, number>;
  return { wicket: (endingIn(0) + (powerPlay ? mercy : 0)) / pageCount, runs };
}

/** Mean runs per ball under a distribution. */
export function expectedRuns(probs: Probabilities): number {
  return ([1, 2, 3, 4, 5, 6] as RunCount[]).reduce((sum, r) => sum + r * probs.runs[r], 0);
}

/** The probability the distribution gave to the outcome that actually happened. */
export function outcomeChance(probs: Probabilities, outcome: Outcome): number {
  return outcome.kind === 'wicket' ? probs.wicket : probs.runs[outcome.runs];
}

const STANCE_ORDER: readonly Stance[] = ['defend', 'normal', 'attack'];

/** Shifts a stance N steps along defend→normal→attack, clamped at either end. */
function shadeStance(s: Stance, steps: number): Stance {
  const idx = STANCE_ORDER.indexOf(s);
  return STANCE_ORDER[clamp(idx + steps, 0, STANCE_ORDER.length - 1)];
}

/** Required rate above which the rival is pressured enough for a tight line to force it into risk. */
const TIGHT_LINE_PRESSURE_RATE = 1.2;

export interface ChaseRead {
  stance: Stance;
  /** Which of the bowler's last plan actually swayed this read, if any — the UI narrates this so the AI's "learning" is visible, not a black box. */
  shadedBy: 'bait' | 'tight' | null;
}

/**
 * The rival's batting brain during a chase (Stats mode) — now reads the
 * bowler's last plan (session 9), not just the required rate. Required-rate
 * pressure still dominates: a chase already desperate enough to attack
 * (rate ≥ 2.2) is never talked down by a temptation ball, and the
 * tight-line read only fires once the rate is genuinely pressuring
 * (> TIGHT_LINE_PRESSURE_RATE) — a stroll never needs strangling into risk.
 * `lastPlan = 'normal'` (the default) reproduces the old rate-only read
 * exactly, byte for byte.
 */
export function chaseStanceRead(
  needed: number,
  ballsLeft: number,
  lastPlan: BowlingPlan = 'normal',
): ChaseRead {
  if (ballsLeft <= 0) return { stance: 'normal', shadedBy: null };
  const rate = needed / ballsLeft;
  const base: Stance = rate >= 2.2 ? 'attack' : rate <= 0.9 ? 'defend' : 'normal';
  if (lastPlan === 'bait' && base !== 'attack') {
    return { stance: shadeStance(base, -1), shadedBy: 'bait' }; // saw the trap — shades defensive
  }
  if (lastPlan === 'tight' && rate > TIGHT_LINE_PRESSURE_RATE) {
    return { stance: shadeStance(base, 1), shadedBy: 'tight' }; // the strangle forces the risk
  }
  return { stance: base, shadedBy: null };
}

/**
 * The rival's batting brain during a chase (Stats mode). Attack when the
 * required rate is steep, shut the gate when the chase is a stroll,
 * otherwise bat normally. Pure so the UI can announce intent honestly.
 */
export function chaseStance(needed: number, ballsLeft: number, lastPlan: BowlingPlan = 'normal'): Stance {
  return chaseStanceRead(needed, ballsLeft, lastPlan).stance;
}

/**
 * When the rival gambles on a power play. Always when the chase is dead
 * without one (a single doubled ball adds at most 6 extra runs); in Stats
 * mode also when the required rate turns desperate.
 */
export function chaseUsesPowerPlay(
  needed: number,
  ballsLeft: number,
  alreadyUsed: boolean,
  mode: 'classic' | 'stats',
): boolean {
  if (alreadyUsed || ballsLeft <= 0) return false;
  if (needed > 6 * ballsLeft) return true; // mathematically forced
  return mode === 'stats' && needed / ballsLeft >= 2.6;
}

/** Rough one-number strength for Gauntlet seeding — order matters, scale doesn't. */
export function batsmanRating(b: BattingStats): number {
  return b.average * (0.6 + b.strikeRate / 150);
}

export function bowlerRating(b: BowlingStats): number {
  return (30 / b.average) * b.wicketThreat * (3 / b.economy);
}

/**
 * Turns a rating (batsmanRating/bowlerRating — arbitrary, unitless scale) into
 * a 1–5 star count relative to its own pool, so a player card is readable
 * without knowing what a strike rate is. Linear min-max scaling rather than
 * strict quantile ranking — simpler, and avoids quantile ranking's own edge
 * cases with duplicate values needing a tie-break rule; still guarantees the
 * two properties that matter: monotonic (a higher rating never gets fewer
 * stars) and the pool's best/worst land on exactly 5/1. A pool with zero
 * variance (every value identical) has nothing to rank down, so everyone
 * gets 5 — the alternative (rank-from-zero) would read as "worst player" for
 * an undifferentiated field, which is the wrong story to tell.
 */
export function starsForRating(value: number, poolValues: number[]): 1 | 2 | 3 | 4 | 5 {
  if (poolValues.length === 0) return 3;
  const min = Math.min(...poolValues);
  const max = Math.max(...poolValues);
  if (max === min) return 5;
  const pct = clamp((value - min) / (max - min), 0, 1);
  const stars = Math.ceil(pct * 5);
  return Math.max(1, Math.min(5, stars)) as 1 | 2 | 3 | 4 | 5;
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
