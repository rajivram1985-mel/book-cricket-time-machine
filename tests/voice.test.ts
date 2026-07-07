import { describe, expect, it } from 'vitest';
import { resolveBallMoment, resolveMatchMoment } from '../src/voice';
import { MOMENT_LINES } from '../src/voiceLines';
import { commentaryFor, fillTemplate, POOLS, resetCommentary } from '../src/commentary';
import type { Outcome } from '../src/types';

const ctx = { batsman: 'Viv', bowler: 'Marshall', page: 42 };

/** Maps a commentary pool key back to the moment category it should agree with. */
const POOL_FOR: Record<string, keyof typeof POOLS> = {
  wicket: 'wicket',
  four: 'four',
  six: 'six',
  sixStreak: 'sixStreak',
  powerHit: 'powerHit',
  powerWicket: 'powerWicket',
  attackWicket: 'attackWicket',
  earlyDuck: 'earlyDuck',
};

describe('resolveBallMoment', () => {
  it('stays silent for singles, twos, threes and fives', () => {
    for (const runs of [1, 2, 3, 5] as const) {
      expect(resolveBallMoment({ kind: 'runs', runs }, 0)).toBeNull();
    }
  });

  it('picks four and six for boundaries, sixStreak once the streak builds', () => {
    expect(resolveBallMoment({ kind: 'runs', runs: 4 }, 0)).toBe('four');
    expect(resolveBallMoment({ kind: 'runs', runs: 6 }, 0)).toBe('six');
    expect(resolveBallMoment({ kind: 'runs', runs: 6 }, 2)).toBe('six');
    expect(resolveBallMoment({ kind: 'runs', runs: 6 }, 3)).toBe('sixStreak');
  });

  it('picks wicket, or attackWicket when the batsman was swinging', () => {
    expect(resolveBallMoment({ kind: 'wicket' }, 0)).toBe('wicket');
    expect(resolveBallMoment({ kind: 'wicket' }, 0, { attacking: true })).toBe('attackWicket');
  });

  it('power play outranks everything, hit or bust', () => {
    expect(resolveBallMoment({ kind: 'runs', runs: 4 }, 0, { doubled: true })).toBe('powerHit');
    expect(resolveBallMoment({ kind: 'runs', runs: 1 }, 0, { doubled: true })).toBe('powerHit');
    expect(resolveBallMoment({ kind: 'wicket' }, 0, { doubled: true })).toBe('powerWicket');
    expect(resolveBallMoment({ kind: 'wicket' }, 0, { doubled: true, attacking: true })).toBe(
      'powerWicket',
    );
  });

  it('agrees with commentaryFor on every priority branch', () => {
    resetCommentary();
    const cases: [Outcome, number, { doubled?: boolean; attacking?: boolean; earlyDuck?: boolean }][] = [
      [{ kind: 'wicket' }, 0, {}],
      [{ kind: 'wicket' }, 0, { attacking: true }],
      [{ kind: 'wicket' }, 0, { doubled: true }],
      [{ kind: 'wicket' }, 0, { earlyDuck: true }],
      [{ kind: 'wicket' }, 0, { earlyDuck: true, attacking: true }],
      [{ kind: 'runs', runs: 4 }, 0, {}],
      [{ kind: 'runs', runs: 4 }, 0, { doubled: true }],
      [{ kind: 'runs', runs: 6 }, 0, {}],
      [{ kind: 'runs', runs: 6 }, 4, {}],
    ];
    for (const [outcome, streak, flavor] of cases) {
      const moment = resolveBallMoment(outcome, streak, flavor);
      const text = commentaryFor(outcome, streak, ctx, flavor);
      expect(moment).not.toBeNull();
      const pool = POOLS[POOL_FOR[moment!]];
      expect(pool.map((t) => fillTemplate(t, ctx))).toContain(text);
    }
  });
});

describe('resolveMatchMoment', () => {
  it('reads a plain win, loss or tie when the finish was not close', () => {
    expect(resolveMatchMoment('win', false)).toBe('matchWin');
    expect(resolveMatchMoment('loss', false)).toBe('matchLoss');
    expect(resolveMatchMoment('tie', false)).toBe('matchTie');
  });

  it('prefers the clutch line when the match went the distance', () => {
    expect(resolveMatchMoment('win', true)).toBe('clutchFinish');
    expect(resolveMatchMoment('loss', true)).toBe('clutchFinish');
  });

  it('a conquered Gauntlet outranks everything, even a clutch finish', () => {
    expect(resolveMatchMoment('win', true, true)).toBe('gauntletWin');
    expect(resolveMatchMoment('win', false, true)).toBe('gauntletWin');
  });
});

describe('MOMENT_LINES', () => {
  it('has at least one line for every category, all non-empty text', () => {
    for (const lines of Object.values(MOMENT_LINES)) {
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('resolveBallMoment: earlyDuck (session 6)', () => {
  it('picks earlyDuck for a plain wicket flagged as an early dismissal', () => {
    expect(resolveBallMoment({ kind: 'wicket' }, 0, { earlyDuck: true })).toBe('earlyDuck');
  });

  it('a chosen risk still outranks earlyDuck: attacking wins', () => {
    expect(resolveBallMoment({ kind: 'wicket' }, 0, { earlyDuck: true, attacking: true })).toBe(
      'attackWicket',
    );
  });

  it('a chosen risk still outranks earlyDuck: the power-play gamble wins', () => {
    expect(resolveBallMoment({ kind: 'wicket' }, 0, { earlyDuck: true, doubled: true })).toBe(
      'powerWicket',
    );
  });

  it('a late (non-early) plain wicket is unaffected', () => {
    expect(resolveBallMoment({ kind: 'wicket' }, 0, { earlyDuck: false })).toBe('wicket');
  });
});
