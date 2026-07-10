import { describe, expect, it } from 'vitest';
import {
  beginDailyAttempt,
  completeDailyAttempt,
  considerLuckiest,
  createStore,
  defaults,
  exportData,
  importData,
  recordMatch,
  saveDailyProgress,
  STORAGE_KEY,
  type Backing,
  type DailyProgress,
} from '../src/storage';

function fakeProgress(overrides: Partial<DailyProgress> = {}): DailyProgress {
  return {
    dayKey: '2026-07-05',
    balls: [{ page: 41, digit: 1, outcome: { kind: 'runs', runs: 1 } }],
    luck: [{ expected: 1.2, chance: 0.4 }],
    runs: 1,
    wickets: 0,
    momentum: 5,
    consecutiveSixes: 0,
    ppUsed: false,
    stance: 'normal',
    earlyDuckThisMatch: false,
    ...overrides,
  };
}

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

describe('daily progress (resume-on-refresh)', () => {
  it('saves progress for the day in attempt, and round-trips through a store', () => {
    const backing = fakeBacking();
    const store = createStore(backing);
    beginDailyAttempt(store.data, '2026-07-05');
    saveDailyProgress(store.data, fakeProgress());
    store.save();
    const reloaded = createStore(backing);
    expect(reloaded.data.daily.progress).toEqual(fakeProgress());
  });

  it('refuses to save progress for a day that is not the current attempt', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    saveDailyProgress(save, fakeProgress({ dayKey: '2026-07-04' }));
    expect(save.daily.progress).toBeNull();
  });

  it('overwrites progress ball by ball', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    saveDailyProgress(save, fakeProgress({ runs: 1 }));
    saveDailyProgress(save, fakeProgress({ runs: 7 }));
    expect(save.daily.progress?.runs).toBe(7);
  });

  it('starting a new day clears any stale progress from before', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    saveDailyProgress(save, fakeProgress());
    beginDailyAttempt(save, '2026-07-06');
    expect(save.daily.progress).toBeNull();
  });

  it('completing the attempt clears progress — nothing left to resume', () => {
    const save = defaults();
    beginDailyAttempt(save, '2026-07-05');
    saveDailyProgress(save, fakeProgress());
    completeDailyAttempt(save, '2026-07-05', {
      won: true,
      tied: false,
      runs: 21,
      wickets: 0,
      target: 21,
      tokens: ['6', '6', '6', '2', '1'],
    });
    expect(save.daily.progress).toBeNull();
  });

  it('falls back to null for malformed progress in storage', () => {
    const store = createStore(
      fakeBacking({
        [STORAGE_KEY]: JSON.stringify({
          daily: { today: { dayKey: '2026-07-05', result: null }, progress: { dayKey: '2026-07-05', runs: 'lots' } },
        }),
      }),
    );
    expect(store.data.daily.progress).toBeNull();
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

describe('export / import (backup & restore)', () => {
  it('round-trips a full save through export then import', () => {
    const save = defaults();
    save.career.matches = 12;
    save.career.bestTotal = 41;
    save.daily.streak = 5;
    save.prefs.soundOn = false;
    const restored = importData(exportData(save));
    expect(restored).toEqual(save);
  });

  it('returns null for non-JSON junk', () => {
    expect(importData('not json at all')).toBeNull();
    expect(importData('')).toBeNull();
  });

  it('returns null for valid JSON that is not a save (so the caller can warn, not wipe)', () => {
    expect(importData(JSON.stringify({ hello: 'world' }))).toBeNull();
    expect(importData(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(importData(JSON.stringify('a string'))).toBeNull();
  });

  it('accepts a recognizable save and defaults any malformed fields', () => {
    const restored = importData(JSON.stringify({ career: { matches: 3, wins: 'lots' }, prefs: { soundOn: false } }));
    expect(restored).not.toBeNull();
    expect(restored!.career.matches).toBe(3);
    expect(restored!.career.wins).toBe(0); // malformed → default
    expect(restored!.prefs.soundOn).toBe(false);
  });
});

describe('voiceOn preference (session 4)', () => {
  it('defaults voiceOn to true and round-trips independently of soundOn', () => {
    const save = defaults();
    expect(save.prefs.voiceOn).toBe(true);
    const backing = fakeBacking();
    const store = createStore(backing);
    store.data.prefs.soundOn = false;
    store.data.prefs.voiceOn = false;
    store.save();
    const reloaded = createStore(backing);
    expect(reloaded.data.prefs.soundOn).toBe(false);
    expect(reloaded.data.prefs.voiceOn).toBe(false);
  });

  it('falls back to true when voiceOn is missing or malformed', () => {
    const store = createStore(fakeBacking({ [STORAGE_KEY]: JSON.stringify({ prefs: { soundOn: false, voiceOn: 'nope' } }) }));
    expect(store.data.prefs.soundOn).toBe(false);
    expect(store.data.prefs.voiceOn).toBe(true);
  });
});

describe('reduceMotion preference (session 6)', () => {
  it('defaults to null — no explicit choice yet, the OS setting decides', () => {
    const save = defaults();
    expect(save.prefs.reduceMotion).toBeNull();
  });

  it('round-trips an explicit true or false choice, distinct from null', () => {
    const backing = fakeBacking();
    const store = createStore(backing);
    store.data.prefs.reduceMotion = false;
    store.save();
    expect(createStore(backing).data.prefs.reduceMotion).toBe(false);

    store.data.prefs.reduceMotion = true;
    store.save();
    expect(createStore(backing).data.prefs.reduceMotion).toBe(true);
  });

  it('falls back to null (not true/false) for missing or malformed data — never invents a choice the player never made', () => {
    const store = createStore(fakeBacking({ [STORAGE_KEY]: JSON.stringify({ prefs: { reduceMotion: 'nope' } }) }));
    expect(store.data.prefs.reduceMotion).toBeNull();
    const storeMissing = createStore(fakeBacking({ [STORAGE_KEY]: JSON.stringify({ prefs: {} }) }));
    expect(storeMissing.data.prefs.reduceMotion).toBeNull();
  });
});

describe('analyticsOn preference (session 6)', () => {
  it('defaults to true — anonymous analytics on unless a player turns it off', () => {
    expect(defaults().prefs.analyticsOn).toBe(true);
  });

  it('round-trips an explicit false — a real, persisted opt-out', () => {
    const backing = fakeBacking();
    const store = createStore(backing);
    store.data.prefs.analyticsOn = false;
    store.save();
    expect(createStore(backing).data.prefs.analyticsOn).toBe(false);
  });

  it('falls back to true (not false) for missing or malformed data — never silently opts a player out either', () => {
    const store = createStore(fakeBacking({ [STORAGE_KEY]: JSON.stringify({ prefs: { analyticsOn: 'nope' } }) }));
    expect(store.data.prefs.analyticsOn).toBe(true);
    const storeMissing = createStore(fakeBacking({ [STORAGE_KEY]: JSON.stringify({ prefs: {} }) }));
    expect(storeMissing.data.prefs.analyticsOn).toBe(true);
  });
});

describe('commentatorId preference (session 4b)', () => {
  it('defaults to the known default persona and round-trips a valid choice', () => {
    const save = defaults();
    expect(save.prefs.commentatorId).toBe('enthusiast');
    const backing = fakeBacking();
    const store = createStore(backing);
    store.data.prefs.commentatorId = 'deadpan';
    store.save();
    const reloaded = createStore(backing);
    expect(reloaded.data.prefs.commentatorId).toBe('deadpan');
  });

  it('falls back to the default for an unknown or missing persona id', () => {
    const store = createStore(
      fakeBacking({ [STORAGE_KEY]: JSON.stringify({ prefs: { commentatorId: 'ravi-shastri-clone' } }) }),
    );
    expect(store.data.prefs.commentatorId).toBe('enthusiast');
  });
});

describe('resetToDefaults', () => {
  it('wipes career, daily history and prefs back to defaults, and persists it', () => {
    const backing = fakeBacking();
    const store = createStore(backing);
    store.data.career.matches = 5;
    store.data.prefs.soundOn = false;
    store.data.daily.streak = 3;
    store.save();
    store.resetToDefaults();
    expect(store.data).toEqual(defaults());
    const reloaded = createStore(backing);
    expect(reloaded.data).toEqual(defaults());
  });
});

describe('early duck tracking (session 6)', () => {
  it('increments earlyDucks and celebrates it, using a running count in the note', () => {
    const save = defaults();
    expect(save.career.earlyDucks).toBe(0);
    const first = recordMatch(save, { won: false, tied: false, yourRuns: 0, yourTokens: ['W'], earlyDuck: true });
    expect(save.career.earlyDucks).toBe(1);
    expect(first.some((n) => n.includes('Early duck #1'))).toBe(true);
    const second = recordMatch(save, { won: false, tied: false, yourRuns: 6, yourTokens: ['4', '2', 'W'], earlyDuck: true });
    expect(save.career.earlyDucks).toBe(2);
    expect(second.some((n) => n.includes('Early duck #2'))).toBe(true);
  });

  it('does not touch earlyDucks when the match had no early dismissal', () => {
    const save = defaults();
    const notes = recordMatch(save, { won: true, tied: false, yourRuns: 40, yourTokens: [] });
    expect(save.career.earlyDucks).toBe(0);
    expect(notes.some((n) => n.includes('Early duck'))).toBe(false);
  });
});
