import { describe, expect, it } from 'vitest';
import {
  batsmanRating,
  bowlerRating,
  chaseStance,
  chaseStanceRead,
  chaseUsesPowerPlay,
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
  starsForRating,
  validatePageCount,
  BOWLING_PLANS,
  ERA_ADJUST_CAP,
  ERA_ADJUST_GRACE_YEARS,
  ERA_ADJUST_SATURATION_YEARS,
  SPELL,
} from '../src/engine';
import {
  commentaryFor,
  fillTemplate,
  inningsBreakLine,
  inningsBreakTier,
  POOLS,
  resetCommentary,
} from '../src/commentary';
import { batsmen, bowlers, ROSTER } from '../src/roster';
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

  it('an aggressive batsman gets out more than a defensive one of the same average', () => {
    const base = { average: 45, boundaryPercent: 10, sixPercent: 1.5 };
    const blaster = computeProbabilities({ ...base, strikeRate: 100 }, marshall);
    const blocker = computeProbabilities({ ...base, strikeRate: 50 }, marshall);
    // the blaster trades survival for scoring: higher wicket odds AND more boundaries
    expect(blaster.wicket).toBeGreaterThan(blocker.wicket);
    expect(blaster.runs[6]).toBeGreaterThan(blocker.runs[6]);
  });

  it('a strike rate of 75 is exact identity on wicket odds (daily-determinism anchor)', () => {
    const base = { average: 45, boundaryPercent: 10, sixPercent: 1.5 };
    // aggressionRisk = 1 + (75/75 - 1) * 0.5 = 1, so SR 75 must not move the wicket
    // number — it reproduces the full pipeline with the SR term absent (value
    // stays inside the [0.03, 0.3] clamp for these inputs, normal stance ×1).
    const anchored = computeProbabilities({ ...base, strikeRate: 75 }, marshall);
    const withoutSrTerm =
      ((0.1 * (25 / marshall.average) * marshall.wicketThreat * 1.15) / (base.average / 50)) *
      settlingInFactor(0);
    expect(anchored.wicket).toBeCloseTo(withoutSrTerm, 10);
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

describe('inningsBreakLine (score-appropriate flavor)', () => {
  it('tiers the total from duck through big at the right boundaries', () => {
    expect(inningsBreakTier(0)).toBe('duck');
    expect(inningsBreakTier(1)).toBe('collapse');
    expect(inningsBreakTier(6)).toBe('collapse');
    expect(inningsBreakTier(7)).toBe('modest');
    expect(inningsBreakTier(14)).toBe('modest');
    expect(inningsBreakTier(15)).toBe('par');
    expect(inningsBreakTier(24)).toBe('par');
    expect(inningsBreakTier(25)).toBe('big');
    expect(inningsBreakTier(48)).toBe('big');
  });

  it('never gives a zero score the celebratory "applause" line', () => {
    resetCommentary();
    for (let i = 0; i < 20; i++) {
      expect(inningsBreakLine(0, 'AB de Villiers')).not.toContain('applause');
    }
  });

  it('a big total can still earn the applause line, and always names the batsman', () => {
    resetCommentary();
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const line = inningsBreakLine(32, 'Lara');
      expect(line).toContain('Lara');
      seen.add(line);
    }
    expect([...seen].some((l) => l.includes('applause'))).toBe(true);
  });
});

describe('stances and power play (session 2)', () => {
  it('normal stance with no power play is bit-identical to the four-arg form', () => {
    for (const ballsFaced of [0, 4, 11]) {
      const plain = computeProbabilities(bradman, marshall, 40, ballsFaced);
      const explicit = computeProbabilities(bradman, marshall, 40, ballsFaced, 'normal', false);
      expect(explicit).toEqual(plain);
    }
  });

  it('attack raises wicket odds and boundary share; defend lowers both', () => {
    const normal = computeProbabilities(modestBat, modestBowl, 0, 5);
    const attack = computeProbabilities(modestBat, modestBowl, 0, 5, 'attack');
    const defend = computeProbabilities(modestBat, modestBowl, 0, 5, 'defend');
    expect(attack.wicket).toBeGreaterThan(normal.wicket);
    expect(defend.wicket).toBeLessThan(normal.wicket);
    const boundaryShare = (p: { runs: Record<number, number> }) => p.runs[4] + p.runs[6];
    expect(boundaryShare(attack)).toBeGreaterThan(boundaryShare(normal));
    expect(boundaryShare(defend)).toBeLessThan(boundaryShare(normal));
  });

  it('every stance/power-play combination still sums to 1', () => {
    for (const stance of ['defend', 'normal', 'attack'] as const) {
      for (const pp of [false, true]) {
        const p = computeProbabilities(modestBat, marshall, 30, 2, stance, pp);
        const total = p.wicket + Object.values(p.runs).reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(1, 10);
      }
    }
  });

  it('a power play doubles wicket odds, capped at 60%', () => {
    const base = computeProbabilities(modestBat, modestBowl, 0, 5);
    const pp = computeProbabilities(modestBat, modestBowl, 0, 5, 'normal', true);
    expect(pp.wicket).toBeCloseTo(Math.min(base.wicket * 2, 0.6), 10);
  });

  it('classic power play turns the mercy digits into wickets', () => {
    expect(digitToOutcome(7, true)).toEqual({ kind: 'wicket' });
    expect(digitToOutcome(8, true)).toEqual({ kind: 'wicket' });
    expect(digitToOutcome(9, true)).toEqual({ kind: 'wicket' });
    expect(digitToOutcome(6, true)).toEqual({ kind: 'runs', runs: 6 });
    expect(digitToOutcome(0, true)).toEqual({ kind: 'wicket' });
  });

  it('classicProbabilities reflects the house rule and still sums to 1', () => {
    const p = classicProbabilities(100, true);
    expect(p.wicket).toBeCloseTo(0.4, 10); // digits 0, 7, 8, 9
    expect(p.runs[1]).toBeCloseTo(0.1, 10); // only pages ending in 1
    const total = p.wicket + Object.values(p.runs).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('chase AI (session 2)', () => {
  it('attacks steep chases, defends strolls, bats normally in between', () => {
    expect(chaseStance(28, 12)).toBe('attack'); // 2.33/ball
    expect(chaseStance(5, 10)).toBe('defend'); // 0.5/ball
    expect(chaseStance(18, 12)).toBe('normal'); // 1.5/ball
    expect(chaseStance(3, 0)).toBe('normal'); // nothing left to decide
  });

  it('gambles when mathematically forced, in either mode', () => {
    expect(chaseUsesPowerPlay(13, 2, false, 'classic')).toBe(true); // 13 > 12
    expect(chaseUsesPowerPlay(13, 2, false, 'stats')).toBe(true);
    expect(chaseUsesPowerPlay(13, 2, true, 'stats')).toBe(false); // already spent
  });

  it('in stats mode also gambles on desperate rates; classic waits for necessity', () => {
    expect(chaseUsesPowerPlay(11, 4, false, 'stats')).toBe(true); // 2.75/ball
    expect(chaseUsesPowerPlay(11, 4, false, 'classic')).toBe(false); // 11 < 24
    expect(chaseUsesPowerPlay(6, 4, false, 'stats')).toBe(false);
  });
});

describe('gauntlet ratings (session 2)', () => {
  it('ranks the greats above the mortals', () => {
    expect(batsmanRating(bradman)).toBeGreaterThan(batsmanRating(modestBat));
    expect(bowlerRating(marshall)).toBeGreaterThan(bowlerRating(modestBowl));
  });
});

describe('commentary flavor (session 2)', () => {
  const ctx = { batsman: 'Viv', bowler: 'Marshall', page: 42 };

  it('uses power-play pools for doubled balls, hit or bust', () => {
    resetCommentary();
    const bust = commentaryFor({ kind: 'wicket' }, 0, ctx, { doubled: true });
    expect(POOLS.powerWicket.map((t) => fillTemplate(t, ctx))).toContain(bust);
    const hit = commentaryFor({ kind: 'runs', runs: 4 }, 0, ctx, { doubled: true });
    expect(POOLS.powerHit.map((t) => fillTemplate(t, ctx))).toContain(hit);
  });

  it('uses attack-wicket lines when the batsman fell swinging', () => {
    resetCommentary();
    const phrase = commentaryFor({ kind: 'wicket' }, 0, ctx, { attacking: true });
    expect(POOLS.attackWicket.map((t) => fillTemplate(t, ctx))).toContain(phrase);
  });

  it('power play outranks attack stance in the priority order', () => {
    resetCommentary();
    const phrase = commentaryFor({ kind: 'wicket' }, 0, ctx, { doubled: true, attacking: true });
    expect(POOLS.powerWicket.map((t) => fillTemplate(t, ctx))).toContain(phrase);
  });
});

describe('bowling plans (session 9)', () => {
  it('normal plan is bit-identical to the six-arg form (daily-determinism anchor)', () => {
    for (const ballsFaced of [0, 4, 11]) {
      const sixArg = computeProbabilities(bradman, marshall, 40, ballsFaced, 'normal', false);
      const sevenArg = computeProbabilities(bradman, marshall, 40, ballsFaced, 'normal', false, 'normal');
      expect(sevenArg).toEqual(sixArg);
    }
  });

  it('attack raises wicket odds and boundary share; tight lowers both; bait raises both hardest', () => {
    const normal = computeProbabilities(modestBat, modestBowl, 0, 5);
    const attack = computeProbabilities(modestBat, modestBowl, 0, 5, 'normal', false, 'attack');
    const tight = computeProbabilities(modestBat, modestBowl, 0, 5, 'normal', false, 'tight');
    const bait = computeProbabilities(modestBat, modestBowl, 0, 5, 'normal', false, 'bait');
    const boundaryShare = (p: { runs: Record<number, number> }) => p.runs[4] + p.runs[6];

    expect(attack.wicket).toBeGreaterThan(normal.wicket);
    expect(tight.wicket).toBeLessThan(normal.wicket);
    expect(bait.wicket).toBeGreaterThan(attack.wicket);

    expect(boundaryShare(attack)).toBeGreaterThan(boundaryShare(normal));
    expect(boundaryShare(tight)).toBeLessThan(boundaryShare(normal));
    expect(boundaryShare(bait)).toBeGreaterThan(boundaryShare(attack));
  });

  it('every plan sums to 1, alone and stacked with stance/power play', () => {
    for (const plan of Object.keys(BOWLING_PLANS) as (keyof typeof BOWLING_PLANS)[]) {
      for (const stance of ['defend', 'normal', 'attack'] as const) {
        for (const pp of [false, true]) {
          const p = computeProbabilities(modestBat, marshall, 30, 2, stance, pp, plan);
          const total = p.wicket + Object.values(p.runs).reduce((a, b) => a + b, 0);
          expect(total).toBeCloseTo(1, 10);
        }
      }
    }
  });

  it('bowling plans never appear in Classic mode odds (classicProbabilities takes no plan argument)', () => {
    // classicProbabilities' signature is (pageCount, powerPlay) only — this
    // test exists as a signature-shape guard, so a future refactor can't
    // accidentally thread a plan multiplier into Classic's page odds.
    expect(classicProbabilities.length).toBeLessThanOrEqual(2);
  });
});

describe('chaseStanceRead — the AI reads the bowler (session 9)', () => {
  it('lastPlan defaulting to normal reproduces the old rate-only read exactly', () => {
    for (const [needed, ballsLeft] of [[28, 12], [5, 10], [18, 12], [3, 0]] as const) {
      expect(chaseStance(needed, ballsLeft)).toBe(chaseStance(needed, ballsLeft, 'normal'));
      expect(chaseStanceRead(needed, ballsLeft, 'normal').shadedBy).toBeNull();
    }
  });

  it('a temptation ball shades one step defensive when the chase is not already desperate', () => {
    // rate 1.5/ball -> base 'normal' -> bait shades to 'defend'
    const midRead = chaseStanceRead(18, 12, 'bait');
    expect(midRead.stance).toBe('defend');
    expect(midRead.shadedBy).toBe('bait');

    // rate 0.5/ball -> base 'defend' (floor) -> bait clamps, stays 'defend'
    const strollRead = chaseStanceRead(5, 10, 'bait');
    expect(strollRead.stance).toBe('defend');
  });

  it('required-rate pressure dominates: a desperate chase always attacks, whatever was bowled', () => {
    // rate 2.33/ball -> base 'attack' already; bait must not talk it down
    const desperate = chaseStanceRead(28, 12, 'bait');
    expect(desperate.stance).toBe('attack');
    expect(desperate.shadedBy).toBeNull(); // base already 'attack' — no read fires
  });

  it('a tight line forces risk once the rate is genuinely pressuring', () => {
    // rate 1.5/ball (> 1.2 pressure threshold) -> base 'normal' -> tight shades to 'attack'
    const pressured = chaseStanceRead(18, 12, 'tight');
    expect(pressured.stance).toBe('attack');
    expect(pressured.shadedBy).toBe('tight');
  });

  it('a tight line does not force risk on a stroll (rate below the pressure threshold)', () => {
    // rate 0.5/ball -> base 'defend', well under 1.2 -> tight read never fires
    const stroll = chaseStanceRead(5, 10, 'tight');
    expect(stroll.stance).toBe('defend');
    expect(stroll.shadedBy).toBeNull();
  });

  it('an attack-plan or normal-plan last ball has no defined read — base stance stands', () => {
    expect(chaseStanceRead(18, 12, 'attack').shadedBy).toBeNull();
    expect(chaseStanceRead(18, 12, 'attack').stance).toBe('normal');
  });

  it('exhaustive matrix: every (lastPlan x situation) combination stays a valid stance', () => {
    const situations: [number, number][] = [[28, 12], [18, 12], [5, 10], [22, 10], [3, 0]];
    for (const plan of Object.keys(BOWLING_PLANS) as (keyof typeof BOWLING_PLANS)[]) {
      for (const [needed, ballsLeft] of situations) {
        const read = chaseStanceRead(needed, ballsLeft, plan);
        expect(['defend', 'normal', 'attack']).toContain(read.stance);
        expect(chaseStance(needed, ballsLeft, plan)).toBe(read.stance);
      }
    }
  });
});

describe('starsForRating (session 10)', () => {
  it('gives the top of the pool 5 stars and the bottom 1', () => {
    const pool = [10, 20, 30, 40, 50];
    expect(starsForRating(50, pool)).toBe(5);
    expect(starsForRating(10, pool)).toBe(1);
  });

  it('is monotonic — a higher rating never earns fewer stars', () => {
    const pool = [3, 17, 22, 8, 41, 12, 29, 5, 36, 19];
    const sorted = [...pool].sort((a, b) => a - b);
    let lastStars = 0;
    for (const v of sorted) {
      const stars = starsForRating(v, pool);
      expect(stars).toBeGreaterThanOrEqual(lastStars);
      lastStars = stars;
    }
  });

  it('every star count stays within 1-5 regardless of where the value sits', () => {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const v of [0, 1, 5, 10, 11, -100, 1000]) {
      const stars = starsForRating(v, pool);
      expect(stars).toBeGreaterThanOrEqual(1);
      expect(stars).toBeLessThanOrEqual(5);
    }
  });

  it('a value outside the pool range clamps rather than breaking the scale', () => {
    const pool = [10, 20, 30];
    expect(starsForRating(-50, pool)).toBe(1);
    expect(starsForRating(500, pool)).toBe(5);
  });

  it('a pool with zero variance does not crash and returns 5 for everyone', () => {
    const pool = [25, 25, 25, 25];
    expect(() => starsForRating(25, pool)).not.toThrow();
    expect(starsForRating(25, pool)).toBe(5);
  });

  it('an empty pool does not crash', () => {
    expect(() => starsForRating(10, [])).not.toThrow();
  });

  it('reflects real roster spread: the best batsman/bowler by rating gets 5 stars, the weakest gets 1', () => {
    const bats = batsmen().map((p) => batsmanRating(p.batting!));
    const bowls = bowlers().map((p) => bowlerRating(p.bowling!));
    expect(starsForRating(Math.max(...bats), bats)).toBe(5);
    expect(starsForRating(Math.min(...bats), bats)).toBe(1);
    expect(starsForRating(Math.max(...bowls), bowls)).toBe(5);
    expect(starsForRating(Math.min(...bowls), bowls)).toBe(1);
  });
});
