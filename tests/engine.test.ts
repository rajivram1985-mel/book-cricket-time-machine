import { describe, expect, it } from 'vitest';
import {
  computeProbabilities,
  decideWinner,
  digitToOutcome,
  drawClassic,
  erasOverlap,
  momentumShift,
  pageForOutcome,
  validatePageCount,
  SPELL,
} from '../src/engine';
import { commentaryFor, POOLS, resetCommentary } from '../src/commentary';
import { ROSTER } from '../src/roster';
import type { BattingStats, BowlingStats } from '../src/types';

const bradman = ROSTER.find((p) => p.id === 'don-bradman')!.batting!;
const marshall = ROSTER.find((p) => p.id === 'malcolm-marshall')!.bowling!;

const modestBat: BattingStats = { average: 32, strikeRate: 65, boundaryPercent: 8, sixPercent: 0.8 };
const modestBowl: BowlingStats = { average: 34, economy: 3.3, strikeRate: 70, wicketThreat: 0.6 };

describe('digitToOutcome', () => {
  it('maps 0 to a wicket', () => {
    expect(digitToOutcome(0)).toEqual({ kind: 'wicket' });
  });

  it('maps 1-6 to that many runs', () => {
    for (let d = 1; d <= 6; d++) {
      expect(digitToOutcome(d)).toEqual({ kind: 'runs', runs: d });
    }
  });

  it('maps 7, 8, 9 to a single', () => {
    for (const d of [7, 8, 9]) {
      expect(digitToOutcome(d)).toEqual({ kind: 'runs', runs: 1 });
    }
  });
});

describe('drawClassic', () => {
  it('always lands within the book and derives outcome from the last digit', () => {
    for (let i = 0; i < 500; i++) {
      const ball = drawClassic(137);
      expect(ball.page).toBeGreaterThanOrEqual(1);
      expect(ball.page).toBeLessThanOrEqual(137);
      expect(ball.digit).toBe(ball.page % 10);
      expect(ball.outcome).toEqual(digitToOutcome(ball.digit));
    }
  });
});

describe('computeProbabilities', () => {
  it('sums to 1', () => {
    const p = computeProbabilities(bradman, marshall, false);
    const total = p.wicket + Object.values(p.runs).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('gives a better batsman lower wicket odds against the same bowler', () => {
    const great = computeProbabilities(bradman, marshall, false);
    const modest = computeProbabilities(modestBat, marshall, false);
    expect(great.wicket).toBeLessThan(modest.wicket);
  });

  it('gives a better bowler higher wicket odds against the same batsman', () => {
    const great = computeProbabilities(modestBat, marshall, false);
    const modest = computeProbabilities(modestBat, modestBowl, false);
    expect(great.wicket).toBeGreaterThan(modest.wicket);
  });

  it('era adjustment raises wicket odds', () => {
    const plain = computeProbabilities(bradman, marshall, false);
    const adjusted = computeProbabilities(bradman, marshall, true);
    expect(adjusted.wicket).toBeGreaterThan(plain.wicket);
  });
});

describe('pageForOutcome', () => {
  it('picks pages whose last digit reproduces the outcome', () => {
    for (let i = 0; i < 300; i++) {
      const wicketPage = pageForOutcome({ kind: 'wicket' }, 364);
      expect(wicketPage.page % 10).toBe(0);
      expect(wicketPage.page).toBeLessThanOrEqual(364);

      const four = pageForOutcome({ kind: 'runs', runs: 4 }, 364);
      expect(four.page % 10).toBe(4);

      const single = pageForOutcome({ kind: 'runs', runs: 1 }, 364);
      expect([1, 7, 8, 9]).toContain(single.page % 10);
      expect(single.page).toBeLessThanOrEqual(364);
    }
  });
});

describe('erasOverlap', () => {
  const bradmanEra = { label: '', startYear: 1928, endYear: 1948 };
  const bumrahEra = { label: '', startYear: 2016, endYear: null };
  const warneEra = { label: '', startYear: 1992, endYear: 2007 };
  const sachinEra = { label: '', startYear: 1989, endYear: 2013 };

  it('detects overlap and cross-era correctly', () => {
    expect(erasOverlap(bradmanEra, bumrahEra)).toBe(false);
    expect(erasOverlap(warneEra, sachinEra)).toBe(true);
    expect(erasOverlap(bumrahEra, bumrahEra)).toBe(true);
  });
});

describe('validatePageCount', () => {
  it('rejects non-integers and small books, accepts real books', () => {
    expect(validatePageCount('abc').ok).toBe(false);
    expect(validatePageCount('12.5').ok).toBe(false);
    expect(validatePageCount('20').ok).toBe(false);
    expect(validatePageCount('-40').ok).toBe(false);
    expect(validatePageCount('314').ok).toBe(true);
  });
});

describe('momentumShift', () => {
  it('penalizes a wicket by -38', () => {
    expect(momentumShift({ kind: 'wicket' })).toBe(-38);
  });

  it('gives boundaries the largest positive swings', () => {
    expect(momentumShift({ kind: 'runs', runs: 6 })).toBe(26);
    expect(momentumShift({ kind: 'runs', runs: 4 })).toBe(18);
    expect(momentumShift({ kind: 'runs', runs: 1 })).toBe(3);
  });

  it('scales monotonically with runs scored', () => {
    const shifts = ([1, 2, 3, 4, 5, 6] as const).map((runs) =>
      momentumShift({ kind: 'runs', runs }),
    );
    for (let i = 1; i < shifts.length; i++) {
      expect(shifts[i]).toBeGreaterThan(shifts[i - 1]);
    }
  });
});

describe('decideWinner', () => {
  it('rewards the bowler for a cheap two-wicket spell', () => {
    expect(decideWinner(7, SPELL.maxWickets)).toBe('bowler');
  });

  it('rewards the batsman for a big unbeaten score', () => {
    expect(decideWinner(24, 0)).toBe('batsman');
  });

  it('splits honours for a big score even with wickets lost', () => {
    expect(decideWinner(25, SPELL.maxWickets)).toBe('shared');
  });
});

describe('commentary', () => {
  it('never repeats the same phrase on consecutive draws', () => {
    resetCommentary();
    let last = '';
    for (let i = 0; i < 200; i++) {
      const phrase = commentaryFor({ kind: 'wicket' });
      expect(phrase).not.toBe(last);
      last = phrase;
    }
  });

  it('uses streak commentary for a barrage of sixes', () => {
    resetCommentary();
    const phrase = commentaryFor({ kind: 'runs', runs: 6 }, 4);
    expect(POOLS.sixStreak).toContain(phrase);
  });
});
