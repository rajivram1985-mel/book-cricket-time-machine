import { describe, expect, it } from 'vitest';
import {
  ballTokens,
  dailyOutcomePhrase,
  dailyShareText,
  dayNumber,
  emojiGrid,
  generateDaily,
  hashString,
  localDayKey,
  mulberry32,
  previousDayKey,
  DAILY_EPOCH_KEY,
} from '../src/daily';
import { MIN_PAGES, SPELL } from '../src/engine';
import type { Ball } from '../src/types';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1) that differ across seeds', () => {
    const rng = mulberry32(hashString('anything'));
    let allSame = true;
    const other = mulberry32(hashString('something else'));
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v !== other()) allSame = false;
    }
    expect(allSame).toBe(false);
  });
});

describe('day keys', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    expect(localDayKey(new Date(2026, 6, 5))).toBe('2026-07-05');
    expect(localDayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('steps back across month and year boundaries', () => {
    expect(previousDayKey('2026-07-01')).toBe('2026-06-30');
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31');
    expect(previousDayKey('2026-03-01')).toBe('2026-02-28');
  });

  it('numbers days from the epoch', () => {
    expect(dayNumber(DAILY_EPOCH_KEY)).toBe(1);
    expect(dayNumber('2026-07-06')).toBe(2);
    expect(dayNumber('2026-08-05')).toBe(32);
  });
});

describe('generateDaily', () => {
  it('is fully deterministic for the same day key', () => {
    const a = generateDaily('2026-07-05');
    const b = generateDaily('2026-07-05');
    expect(b.yourBat.id).toBe(a.yourBat.id);
    expect(b.yourBowl.id).toBe(a.yourBowl.id);
    expect(b.rivalBat.id).toBe(a.rivalBat.id);
    expect(b.rivalBowl.id).toBe(a.rivalBowl.id);
    expect(b.book).toEqual(a.book);
    expect(b.target).toBe(a.target);
    expect(b.inn1.balls).toEqual(a.inn1.balls);
  });

  it('changes across day keys', () => {
    const keys = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];
    const fingerprints = new Set(
      keys.map((k) => {
        const c = generateDaily(k);
        return JSON.stringify([c.rivalBat.id, c.target, ballTokens(c.inn1.balls)]);
      }),
    );
    expect(fingerprints.size).toBeGreaterThan(1);
  });

  it('produces a valid seeded innings and target', () => {
    for (const key of ['2026-07-05', '2026-09-13', '2027-01-31']) {
      const c = generateDaily(key);
      expect(c.inn1.balls.length).toBeLessThanOrEqual(SPELL.maxBalls);
      expect(c.inn1.wickets).toBeLessThanOrEqual(SPELL.maxWickets);
      expect(c.target).toBe(c.inn1.runs + 1);
      expect(c.book.pages).toBeGreaterThanOrEqual(MIN_PAGES);
      expect(c.inn1.luck.length).toBe(c.inn1.balls.length);
      const ids = [c.yourBat.id, c.yourBowl.id, c.rivalBat.id, c.rivalBowl.id];
      expect(new Set(ids).size).toBe(4);
    }
  });
});

describe('share grid', () => {
  const balls: Ball[] = [
    { page: 14, digit: 4, outcome: { kind: 'runs', runs: 4 } },
    { page: 96, digit: 6, outcome: { kind: 'runs', runs: 6 } },
    { page: 30, digit: 0, outcome: { kind: 'wicket' } },
    { page: 11, digit: 1, outcome: { kind: 'runs', runs: 1 } },
  ];

  it('maps balls to tokens and emoji', () => {
    expect(ballTokens(balls)).toEqual(['4', '6', 'W', '1']);
    expect(emojiGrid(['4', '6', 'W', '1'])).toBe('🟦🟪🟥⬜');
  });

  it('phrases wins, ties, near-misses and losses', () => {
    const base = { runs: 20, wickets: 1, target: 20, tokens: ['6', '6', '6', '2'] };
    expect(dailyOutcomePhrase({ ...base, won: true, tied: false })).toBe(
      'chased with 8 balls to spare',
    );
    const lastBall = { ...base, won: true, tied: false, tokens: Array(SPELL.maxBalls).fill('1') };
    expect(dailyOutcomePhrase(lastBall)).toBe('chased off the very last ball');
    expect(dailyOutcomePhrase({ ...base, won: false, tied: true })).toBe('tied with the book');
    expect(dailyOutcomePhrase({ ...base, won: false, tied: false, runs: 18 })).toBe('fell 2 short');
  });

  it('builds a share text with number, book, grid and streak', () => {
    const ch = generateDaily('2026-07-05');
    const text = dailyShareText(
      ch,
      { won: true, tied: false, runs: ch.target, wickets: 0, target: ch.target, tokens: ['6', '4'] },
      3,
    );
    expect(text).toContain('Book Cricket Daily #1');
    expect(text).toContain(ch.book.title);
    expect(text).toContain(`target ${ch.target}`);
    expect(text).toContain('🟪🟦 ✅');
    expect(text).toContain('🔥 3-day streak');
  });

  it('omits the streak line for streaks under 2', () => {
    const ch = generateDaily('2026-07-05');
    const text = dailyShareText(
      ch,
      { won: false, tied: false, runs: 3, wickets: 2, target: ch.target, tokens: ['1', '2', 'W', 'W'] },
      1,
    );
    expect(text).not.toContain('streak');
  });
});
