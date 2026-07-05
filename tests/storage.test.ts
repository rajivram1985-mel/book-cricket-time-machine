import { describe, expect, it } from 'vitest';
import {
  beginDailyAttempt,
  completeDailyAttempt,
  considerLuckiest,
  createStore,
  defaults,
  recordMatch,
  STORAGE_KEY,
  type Backing,
} from '../src/storage';

function fakeBacking(initial: Record<string, string> = {}): Backing & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('store', () => {
  it('starts from defaults with an empty backing and round-trips a save', () => {
    const backing = fakeBacking();
    const store = createStore(backing);
    expect(store.data.career.matches).toBe(0);
    store.data.career.matches = 7;
    store.data.prefs.soundOn = false;
    store.save();
    const reloaded = createStore(backing);
    expect(reloaded.data.career.matches).toBe(7);
    expect(reloaded.data.prefs.soundOn).toBe(false);
  });

  it('falls back to defaults on corrupt JSON', () => {
    const store = createStore(fakeBacking({ [STORAGE_KEY]: '{not json' }));
    expect(store.data).toEqual(defaults());
  });

  it('ignores malformed fields but keeps valid ones', () => {
    const blob = JSON.stringify({
      career: { matches: 3, wins: 'lots', bestTotal: 41 },
      luckiest: { desc: 'a six against 1.8% odds', chancePct: 1.8 },
      daily: { streak: 2, lastPlayedKey: 12345, today: { dayKey: '2026-07-04', result: 'bogus' } },
      prefs: { soundOn: 'yes' },
    });
    const store = createStore(fakeBacking({ [STORAGE_KEY]: blob }));
    expect(store.data.career.matches).toBe(3);
    expect(store.data.career.wins).toBe(0);
    expect(store.data.career.bestTotal).toBe(41);
    expect(store.data.luckiest?.chancePct).toBe(1.8);
    expect(store.data.daily.streak).toBe(2);
    expect(store.data.daily.lastPlayedKey).toBeNull();
    expect(store.data.daily.today).toEqual({ dayKey: '2026-07-04', result: null });
    expect(store.data.prefs.soundOn).toBe(true);
  });

  it('works without any backing (private mode)', () => {
    const store = createStore(null);
    store.data.career.matches = 1;
    expect(() => store.save()).not.toThrow();
  });
});

describe('recordMatch', () => {
  it('tallies results, runs and boundaries', () => {
    const save = defaults();
    recordMatch(save, { won: true, tied: false, yourRuns: 24, yourTokens: ['6', '4', '4', '1', 'W'] });
    recordMatch(save, { won: false, tied: false, yourRuns: 9, yourTokens: ['1', '2', 'W', 'W'] });
    recordMatch(save, { won: false, tied: true, yourRuns: 15, yourTokens: ['6', '1'] });
    expect(save.career.matches).toBe(3);
    expect(save.career.wins).toBe(1);
    expect(save.career.losses).toBe(1);
    expect(save.career.ties).toBe(1);
    expect(save.career.runs).toBe(48);
    expect(save.career.fours).toBe(2);
    expect(save.career.sixes).toBe(2);
  });

  it('tracks best total and celebrates only when a previous best is beaten', () => {
    const save = defaults();
    const first = recordMatch(save, { won: true, tied: false, yourRuns: 20, yourTokens: [] });
    expect(first.some((n) => n.includes('personal best'))).toBe(false);
    const better = recordMatch(save, { won: true, tied: false, yourRuns: 33, yourTokens: [] });
    expect(better.some((n) => n.includes('personal best'))).toBe(true);
    expect(save.career.bestTotal).toBe(33);
  });

  it('runs the win streak, resets on loss, survives a tie, celebrates at 3+', () => {
    const save = defaults();
    recordMatch(save, { won: true, tied: false, yourRuns: 10, yourTokens: [] });
    recordMatch(save, { won: false, tied: true, yourRuns: 10, yourTokens: [] });
    recordMatch(save, { won: true, tied: false, yourRuns: 10, yourTokens: [] });
    const third = recordMatch(save, { won: true, tied: false, yourRuns: 10, yourTokens: [] });
    expect(save.career.winStreak).toBe(3);
    expect(third.some((n) => n.includes('3 wins'))).toBe(true);
    recordMatch(save, { won: false, tied: false, yourRuns: 10, yourTokens: [] });
    expect(save.career.winStreak).toBe(0);
    expect(save.career.bestWinStreak).toBe(3);
  });
});

describe('considerLuckiest', () => {
  it('records the first moment quietly, celebrates only when beaten', () => {
    const save = defaults();
    expect(considerLuckiest(save, 'a six against 8.0% odds', 0.08)).toBeNull();
    expect(considerLuckiest(save, 'a four against 12% odds', 0.12)).toBeNull();
    expect(save.luckiest?.chancePct).toBeCloseTo(8, 5);
    const note = considerLuckiest(save, 'a six against 1.9% odds', 0.019);
    expect(note).toContain('unlikeliest');
    expect(save.luckiest?.chancePct).toBeCloseTo(1.9, 5);
  });
});

describe('daily attempts', () => {
  it('starts a streak, extends it on consecutive days, resets after a gap', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    expect(save.daily.streak).toBe(1);
    beginDailyAttempt(save, '2026-07-06');
    expect(save.daily.streak).toBe(2);
    expect(save.daily.bestStreak).toBe(2);
    beginDailyAttempt(save, '2026-07-09');
    expect(save.daily.streak).toBe(1);
    expect(save.daily.bestStreak).toBe(2);
    expect(save.daily.played).toBe(3);
  });

  it('is idempotent for the same day — no second attempt, no double-count', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    beginDailyAttempt(save, '2026-07-05');
    expect(save.daily.played).toBe(1);
    expect(save.daily.streak).toBe(1);
  });

  it('records the result and counts wins', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    completeDailyAttempt(save, '2026-07-05', {
      won: true,
      tied: false,
      runs: 21,
      wickets: 0,
      target: 21,
      tokens: ['6', '6', '6', '2', '1'],
    });
    expect(save.daily.today?.result?.won).toBe(true);
    expect(save.daily.wins).toBe(1);
  });

  it('ignores a completion for a stale day', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    completeDailyAttempt(save, '2026-07-04', {
      won: true,
      tied: false,
      runs: 5,
      wickets: 0,
      target: 5,
      tokens: ['5'],
    });
    expect(save.daily.today?.result).toBeNull();
    expect(save.daily.wins).toBe(0);
  });
});

describe('session 2 additions', () => {
  it('counts boundaries from doubled tokens and defaults gauntletsWon', () => {
    const save = defaults();
    expect(save.career.gauntletsWon).toBe(0);
    recordMatch(save, { won: true, tied: false, yourRuns: 30, yourTokens: ['4×2', '6×2', '4', '1'] });
    expect(save.career.fours).toBe(2);
    expect(save.career.sixes).toBe(1);
  });
});
