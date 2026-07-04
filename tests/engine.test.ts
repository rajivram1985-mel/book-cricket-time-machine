import { describe, expect, it } from 'vitest';
import {
  classicProbabilities,
  computeProbabilities,
  digitToOutcome,
  drawClassic,
  eraAdjustmentMultiplier,
  eraGapYears,
  erasOverlap,
  expectedRuns,
  fatigueFactor,
  matchResult,
  momentumShift,
  outcomeChance,
  pageForOutcome,
  settlingInFactor,
  validatePageCount,
  ERA_ADJUST_CAP,
  ERA_ADJUST_GRACE_YEARS,
  ERA_ADJUST_SATURATION_YEARS,
  SPELL,
} from '../src/engine';
import { commentaryFor, fillTemplate, POOLS, resetCommentary } from '../src/commentary';
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
  it('sums to 1 regardless of era gap or balls faced', () => {
    for (const ballsFaced of [0, 3, 6, 11]) {
      const p = computeProbabilities(bradman, marshall, 40, ballsFaced);
      const total = p.wicket + Object.values(p.runs).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('gives a better batsman lower wicket odds against the same bowler', () => {
    const great = computeProbabilities(bradman, marshall);
    const modest = computeProbabilities(modestBat, marshall);
    expect(great.wicket).toBeLessThan(modest.wicket);
  });

  it('gives a better bowler higher wicket odds against the same batsman', () => {
    const great = computeProbabilities(modestBat, marshall);
    const modest = computeProbabilities(modestBat, modestBowl);
    expect(great.wicket).toBeGreaterThan(modest.wicket);
  });

  it('era adjustment raises wicket odds beyond the grace band, scaled by gap', () => {
    const plain = computeProbabilities(bradman, marshall, 0);
    const inGrace = computeProbabilities(bradman, marshall, 10);
    const midGap = computeProbabilities(bradman, marshall, 30);
    const bigGap = computeProbabilities(bradman, marshall, 90);
    expect(inGrace.wicket).toBe(plain.wicket);
    expect(midGap.wicket).toBeGreaterThan(plain.wicket);
    expect(bigGap.wicket).toBeGreaterThan(midGap.wicket);
  });

  it('makes a fresh batsman shakier than a set one', () => {
    const freshBall = computeProbabilities(bradman, marshall, 0, 0);
    const settled = computeProbabilities(bradman, marshall, 0, 6);
    expect(freshBall.wicket).toBeGreaterThan(settled.wicket);
  });

  it('lets boundaries creep up as the bowler tires late in a spell', () => {
    const early = computeProbabilities(bradman, marshall, 0, 0);
    const late = computeProbabilities(bradman, marshall, 0, SPELL.maxBalls - 1);
    expect(late.runs[6]).toBeGreaterThan(early.runs[6]);
  });
});

describe('eraGapYears', () => {
  it('returns 0 for overlapping eras', () => {
    const warneEra = { label: '', startYear: 1992, endYear: 2007 };
    const sachinEra = { label: '', startYear: 1989, endYear: 2013 };
    expect(eraGapYears(warneEra, sachinEra)).toBe(0);
  });

  it('measures the actual year gap for non-overlapping eras', () => {
    const bradmanEra = { label: '', startYear: 1928, endYear: 1948 };
    const bumrahEra = { label: '', startYear: 2016, endYear: null };
    const kallisEra = { label: '', startYear: 1995, endYear: 2014 };
    expect(eraGapYears(bradmanEra, bumrahEra)).toBe(2016 - 1948);
    expect(eraGapYears(kallisEra, bumrahEra)).toBe(2016 - 2014);
  });
});

describe('eraAdjustmentMultiplier', () => {
  it('applies no bump within the grace band', () => {
    expect(eraAdjustmentMultiplier(0)).toBe(1);
    expect(eraAdjustmentMultiplier(2)).toBe(1);
    expect(eraAdjustmentMultiplier(ERA_ADJUST_GRACE_YEARS)).toBe(1);
  });

  it('scales up beyond the grace band and saturates at the cap', () => {
    const midGap = eraAdjustmentMultiplier(30);
    const atSaturation = eraAdjustmentMultiplier(ERA_ADJUST_SATURATION_YEARS);
    const beyondSaturation = eraAdjustmentMultiplier(ERA_ADJUST_SATURATION_YEARS * 2);
    expect(midGap).toBeGreaterThan(1);
    expect(midGap).toBeLessThan(atSaturation);
    expect(atSaturation).toBeCloseTo(1 + ERA_ADJUST_CAP, 10);
    expect(beyondSaturation).toBe(atSaturation);
  });
});

describe('settlingInFactor', () => {
  it('is highest on the very first ball and decays to 1', () => {
    expect(settlingInFactor(0)).toBeGreaterThan(settlingInFactor(1));
    expect(settlingInFactor(1)).toBeGreaterThan(settlingInFactor(2));
    expect(settlingInFactor(10)).toBe(1);
  });
});

describe('fatigueFactor', () => {
  it('increases as more balls are bowled in a spell', () => {
    expect(fatigueFactor(0, 12)).toBe(1);
    expect(fatigueFactor(6, 12)).toBeGreaterThan(fatigueFactor(0, 12));
    expect(fatigueFactor(11, 12)).toBeGreaterThan(fatigueFactor(6, 12));
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

describe('matchResult', () => {
  it('defends when the chase falls short', () => {
    expect(matchResult(34, 28)).toBe('defended');
  });

  it('is chased when the target is passed', () => {
    expect(matchResult(34, 35)).toBe('chased');
  });

  it('ties on level scores', () => {
    expect(matchResult(34, 34)).toBe('tied');
  });
});

describe('classicProbabilities', () => {
  it('is uniform per digit when pages are a multiple of 10', () => {
    const p = classicProbabilities(100);
    expect(p.wicket).toBeCloseTo(0.1, 10);
    expect(p.runs[1]).toBeCloseTo(0.4, 10); // digits 1, 7, 8, 9
    expect(p.runs[6]).toBeCloseTo(0.1, 10);
  });

  it('counts partial last-decades exactly and sums to 1', () => {
    const p = classicProbabilities(137);
    expect(p.wicket).toBeCloseTo(13 / 137, 10); // pages 10..130
    expect(p.runs[1]).toBeCloseTo(54 / 137, 10); // 14 + 14 + 13 + 13 (digits 1,7,8,9)
    expect(p.runs[6]).toBeCloseTo(14 / 137, 10);
    const total = p.wicket + Object.values(p.runs).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('luck accounting', () => {
  const uniform = classicProbabilities(100);

  it('expectedRuns is the mean of the run distribution', () => {
    // 1×0.4 + (2+3+4+5+6)×0.1 = 2.4
    expect(expectedRuns(uniform)).toBeCloseTo(2.4, 10);
  });

  it('outcomeChance prices the outcome that actually happened', () => {
    expect(outcomeChance(uniform, { kind: 'wicket' })).toBeCloseTo(0.1, 10);
    expect(outcomeChance(uniform, { kind: 'runs', runs: 1 })).toBeCloseTo(0.4, 10);
    expect(outcomeChance(uniform, { kind: 'runs', runs: 6 })).toBeCloseTo(0.1, 10);
  });
});

describe('commentary', () => {
  const ctx = { batsman: 'Viv', bowler: 'Marshall', page: 42 };

  it('never repeats the same phrase on consecutive draws', () => {
    resetCommentary();
    let last = '';
    for (let i = 0; i < 200; i++) {
      const phrase = commentaryFor({ kind: 'wicket' }, 0, ctx);
      expect(phrase).not.toBe(last);
      last = phrase;
    }
  });

  it('uses streak commentary for a barrage of sixes', () => {
    resetCommentary();
    const phrase = commentaryFor({ kind: 'runs', runs: 6 }, 4, ctx);
    expect(POOLS.sixStreak.map((t) => fillTemplate(t, ctx))).toContain(phrase);
  });

  it('fills player names and page number into templates', () => {
    expect(fillTemplate('{batsman} takes on {bowler} at page {page}', ctx)).toBe(
      'Viv takes on Marshall at page 42',
    );
  });
});
