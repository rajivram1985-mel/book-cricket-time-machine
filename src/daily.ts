import type { Ball, Player } from './types';
import {
  computeProbabilities,
  drawStats,
  expectedRuns,
  outcomeChance,
  SPELL,
  type Rng,
} from './engine';
import { batsmen, bowlers } from './roster';

/**
 * The Daily Challenge: one seeded chase per calendar day, identical for
 * everyone. The seed fixes the four players, the book, and the rival's
 * full first innings — so the whole world stares down the same target,
 * and only the luck of your own flips differs.
 */

/** Daily #1. Bump nothing here — the numbering is public once shared. */
export const DAILY_EPOCH_KEY = '2026-07-05';

/** Set at deploy time; when empty the share text omits the link line. */
export const SHARE_URL = 'https://bookcrickettimemachine.com';

/** Deterministic 32-bit PRNG — same seed, same match, on every device. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a — stable string hash for turning a day key into a seed. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Local-time YYYY-MM-DD. Never toISOString — the day must roll at *local* midnight. */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function previousDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d - 1));
}

/** 1-based challenge number; UTC arithmetic so DST can't skip or repeat a day. */
export function dayNumber(key: string, epochKey: string = DAILY_EPOCH_KEY): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(key) - utc(epochKey)) / 86400000) + 1;
}

/** The book of the day — pure schoolyard flavor, rotated by the seed. */
export const DAILY_BOOKS: ReadonlyArray<{ title: string; pages: number }> = [
  { title: 'Wren & Martin English Grammar', pages: 320 },
  { title: 'The Class 8 Maths Textbook (brown-paper cover)', pages: 284 },
  { title: 'Moral Science Reader', pages: 176 },
  { title: 'The Library’s One Battered Atlas', pages: 232 },
  { title: 'General Knowledge Digest, 1998 Edition', pages: 208 },
  { title: 'Hindi Vyakaran (the one with the missing cover)', pages: 256 },
  { title: 'Social Studies: Our Wide World', pages: 198 },
  { title: 'The Physics Guide the Toppers Used', pages: 412 },
  { title: 'A Tinkle Digest smuggled inside a textbook', pages: 96 },
  { title: 'The Concise Dictionary (borrowed, never returned)', pages: 1264 },
];

export interface SeededInnings {
  runs: number;
  wickets: number;
  balls: Ball[];
  luck: { expected: number; chance: number }[];
}

export interface DailyChallenge {
  dayKey: string;
  number: number;
  /** Chases the target for you. */
  yourBat: Player;
  /** Already bowled the seeded first innings for you. */
  yourBowl: Player;
  /** Set the target in the seeded innings. */
  rivalBat: Player;
  /** Bowls at you during the chase. */
  rivalBowl: Player;
  book: { title: string; pages: number };
  inn1: SeededInnings;
  target: number;
}

function pickSeeded<T extends { id: string }>(pool: T[], excludeIds: string[], rng: Rng): T {
  const options = pool.filter((p) => !excludeIds.includes(p.id));
  return options[Math.floor(rng() * options.length)];
}

/** Shared with Classic mode's "Surprise me" book pick — same nostalgic pool, unseeded by default. */
export function pickRandomBook(rng: Rng = Math.random): { title: string; pages: number } {
  return DAILY_BOOKS[Math.floor(rng() * DAILY_BOOKS.length)];
}

/** A target below this reads as a dud — trivial to chase, a boring share grid. */
export const MIN_DAILY_TARGET = 10;

/** Safety cap so a pathological seed can't loop forever; never observed to matter in practice. */
const MAX_DUD_RETRIES = 20;

function simulateInnings(
  rivalBat: Player,
  yourBowl: Player,
  pageCount: number,
  rng: Rng,
): SeededInnings {
  const balls: Ball[] = [];
  const luck: SeededInnings['luck'] = [];
  let runs = 0;
  let wickets = 0;
  while (balls.length < SPELL.maxBalls && wickets < SPELL.maxWickets) {
    const probs = computeProbabilities(rivalBat.batting!, yourBowl.bowling!, 0, balls.length);
    const ball = drawStats(probs, pageCount, rng);
    balls.push(ball);
    luck.push({ expected: expectedRuns(probs), chance: outcomeChance(probs, ball.outcome) });
    if (ball.outcome.kind === 'wicket') wickets += 1;
    else runs += ball.outcome.runs;
  }
  return { runs, wickets, balls, luck };
}

/**
 * Fully deterministic given the day key: players, book, and the rival's
 * complete innings all come off one seeded stream. Draw order is part of
 * the contract — reordering the draws changes every past challenge.
 *
 * If the simulated innings collapses to a dud target (a trivial chase, a
 * flat share grid), it's re-simulated from the *same continuing* rng
 * stream rather than re-seeded — so the day key still determines a single
 * outcome, just possibly after a few internal retries. A day that already
 * clears the floor (like Daily #1, target 20) never retries, so past
 * challenges already played are unaffected by this floor existing.
 */
export function generateDaily(dayKey: string): DailyChallenge {
  const rng = mulberry32(hashString(`book-cricket-daily:${dayKey}`));
  const book = pickRandomBook(rng);
  const rivalBat = pickSeeded(batsmen(), [], rng);
  const rivalBowl = pickSeeded(bowlers(), [rivalBat.id], rng);
  const yourBat = pickSeeded(batsmen(), [rivalBat.id, rivalBowl.id], rng);
  const yourBowl = pickSeeded(bowlers(), [rivalBat.id, rivalBowl.id, yourBat.id], rng);

  let inn1 = simulateInnings(rivalBat, yourBowl, book.pages, rng);
  let attempts = 0;
  while (inn1.runs + 1 < MIN_DAILY_TARGET && attempts < MAX_DUD_RETRIES) {
    inn1 = simulateInnings(rivalBat, yourBowl, book.pages, rng);
    attempts++;
  }

  return {
    dayKey,
    number: dayNumber(dayKey),
    yourBat,
    yourBowl,
    rivalBat,
    rivalBowl,
    book,
    inn1,
    target: inn1.runs + 1,
  };
}

// ---------- share grid ----------

/** `W`/`1`–`6`, with a `×2` suffix when the ball was a power play. */
export function ballTokens(balls: Ball[]): string[] {
  return balls.map((b) => {
    const base = b.outcome.kind === 'wicket' ? 'W' : String(b.outcome.runs);
    return b.doubled ? `${base}×2` : base;
  });
}

export function tokenBase(token: string): string {
  return token.endsWith('×2') ? token.slice(0, -2) : token;
}

const TOKEN_EMOJI: Record<string, string> = {
  W: '🟥',
  '1': '⬜',
  '2': '🟩',
  '3': '🟩',
  '4': '🟦',
  '5': '🟦',
  '6': '🟪',
};

/** Wickets stay red even on a power play; any other doubled ball goes gold. */
export function emojiGrid(tokens: string[]): string {
  return tokens
    .map((t) => {
      const base = tokenBase(t);
      if (base === 'W') return TOKEN_EMOJI.W;
      if (t !== base) return '🟨';
      return TOKEN_EMOJI[base] ?? '⬜';
    })
    .join('');
}

export interface DailyOutcome {
  won: boolean;
  tied: boolean;
  runs: number;
  wickets: number;
  target: number;
  tokens: string[];
}

/** Spoken result line — also reused verbatim inside the share text. */
export function dailyOutcomePhrase(r: DailyOutcome): string {
  if (r.won) {
    const spare = SPELL.maxBalls - r.tokens.length;
    return spare > 0
      ? `chased with ${spare} ball${spare === 1 ? '' : 's'} to spare`
      : 'chased off the very last ball';
  }
  if (r.tied) return 'tied with the book';
  const short = r.target - r.runs;
  return `fell ${short} short`;
}

export function dailyShareText(ch: DailyChallenge, r: DailyOutcome, streak: number): string {
  const mark = r.won ? '✅' : r.tied ? '🤝' : '❌';
  const lines = [
    `🏏 Book Cricket Daily #${ch.number}`,
    `“${ch.book.title}” · target ${ch.target}`,
    `${emojiGrid(r.tokens)} ${mark} ${dailyOutcomePhrase(r)}`,
  ];
  if (streak > 1) lines.push(`🔥 ${streak}-day streak`);
  if (SHARE_URL) lines.push(SHARE_URL);
  return lines.join('\n');
}
