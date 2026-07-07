import { previousDayKey, tokenBase } from './daily';
import type { DailyOutcome } from './daily';
import { DEFAULT_COMMENTATOR_ID, isKnownCommentator } from './commentators';

/**
 * The on-device scorebook. Everything lives in one versioned localStorage
 * blob — no accounts, no network, nothing leaves the browser. The backing
 * store is injectable so the pure recorders below are testable, and so a
 * blocked localStorage (private mode) degrades to in-memory gracefully.
 */

export const STORAGE_KEY = 'book-cricket-time-machine-v1';

export interface Backing {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CareerStats {
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  runs: number;
  fours: number;
  sixes: number;
  bestTotal: number;
  winStreak: number;
  bestWinStreak: number;
  /** Best-of-3 Gauntlet series conquered. */
  gauntletsWon: number;
  /** Dismissed within the first 3 balls faced — worn as a badge, not hidden. */
  earlyDucks: number;
}

export interface LuckiestMoment {
  desc: string;
  /** e.g. 2.1 for a 2.1% ball */
  chancePct: number;
}

export interface DailyState {
  lastPlayedKey: string | null;
  /** Consecutive days *played* (Duolingo-style), not days won. */
  streak: number;
  bestStreak: number;
  played: number;
  wins: number;
  /** The most recent attempt; result stays null if the chase was abandoned. */
  today: { dayKey: string; result: DailyOutcome | null } | null;
}

export interface SaveData {
  v: 1;
  career: CareerStats;
  luckiest: LuckiestMoment | null;
  daily: DailyState;
  prefs: { soundOn: boolean; voiceOn: boolean; commentatorId: string };
}

export function defaults(): SaveData {
  return {
    v: 1,
    career: {
      matches: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      runs: 0,
      fours: 0,
      sixes: 0,
      bestTotal: 0,
      winStreak: 0,
      bestWinStreak: 0,
      gauntletsWon: 0,
      earlyDucks: 0,
    },
    luckiest: null,
    daily: {
      lastPlayedKey: null,
      streak: 0,
      bestStreak: 0,
      played: 0,
      wins: 0,
      today: null,
    },
    prefs: { soundOn: true, voiceOn: true, commentatorId: DEFAULT_COMMENTATOR_ID },
  };
}

function mergeNumbers<T extends object>(base: T, raw: unknown): T {
  if (typeof raw !== 'object' || raw === null) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(base)) {
    if (typeof out[k] !== 'number') continue;
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out as T;
}

function isDailyOutcome(x: unknown): x is DailyOutcome {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.won === 'boolean' &&
    typeof o.tied === 'boolean' &&
    typeof o.runs === 'number' &&
    typeof o.wickets === 'number' &&
    typeof o.target === 'number' &&
    Array.isArray(o.tokens) &&
    o.tokens.every((t) => typeof t === 'string')
  );
}

export function loadData(backing: Backing | null): SaveData {
  const base = defaults();
  if (!backing) return base;
  try {
    const raw = backing.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<SaveData>;
    const luckiest =
      typeof p.luckiest === 'object' &&
      p.luckiest !== null &&
      typeof p.luckiest.desc === 'string' &&
      typeof p.luckiest.chancePct === 'number'
        ? { desc: p.luckiest.desc, chancePct: p.luckiest.chancePct }
        : null;
    const rawToday = (p.daily as Partial<DailyState> | undefined)?.today;
    const today =
      typeof rawToday === 'object' && rawToday !== null && typeof rawToday.dayKey === 'string'
        ? { dayKey: rawToday.dayKey, result: isDailyOutcome(rawToday.result) ? rawToday.result : null }
        : null;
    const rawLastKey = (p.daily as Partial<DailyState> | undefined)?.lastPlayedKey;
    return {
      v: 1,
      career: mergeNumbers(base.career, p.career),
      luckiest,
      daily: {
        ...mergeNumbers(
          { streak: 0, bestStreak: 0, played: 0, wins: 0 },
          p.daily as Record<string, unknown> | undefined,
        ),
        lastPlayedKey: typeof rawLastKey === 'string' ? rawLastKey : null,
        today,
      },
      prefs: {
        soundOn: typeof p.prefs?.soundOn === 'boolean' ? p.prefs.soundOn : true,
        voiceOn: typeof p.prefs?.voiceOn === 'boolean' ? p.prefs.voiceOn : true,
        commentatorId:
          typeof p.prefs?.commentatorId === 'string' && isKnownCommentator(p.prefs.commentatorId)
            ? p.prefs.commentatorId
            : DEFAULT_COMMENTATOR_ID,
      },
    };
  } catch {
    return base;
  }
}

function browserBacking(): Backing | null {
  try {
    if (typeof window === 'undefined') return null;
    const ls = window.localStorage;
    const probe = '__bc_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

export class Store {
  data: SaveData;

  constructor(private backing: Backing | null) {
    this.data = loadData(backing);
  }

  save(): void {
    try {
      this.backing?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // quota / private mode — play on, in memory
    }
  }

  /** Full factory reset — wipes career, daily history and prefs, and persists the wipe. */
  resetToDefaults(): void {
    this.data = defaults();
    this.save();
  }
}

/** `undefined` = use the real browser localStorage; pass a fake in tests. */
export function createStore(backing?: Backing | null): Store {
  return new Store(backing === undefined ? browserBacking() : backing);
}

// ---------- recorders (pure mutations on SaveData, return celebration notes) ----------

export interface MatchRecord {
  won: boolean;
  tied: boolean;
  /** Runs and ball tokens for the innings *your XI* batted. */
  yourRuns: number;
  yourTokens: string[];
  /** Dismissed within the first 3 balls faced this innings — a badge, not a penalty. */
  earlyDuck?: boolean;
}

/** Updates the career ledger; returns lines worth celebrating in the verdict. */
export function recordMatch(save: SaveData, rec: MatchRecord): string[] {
  const c = save.career;
  const notes: string[] = [];
  c.matches += 1;
  if (rec.won) c.wins += 1;
  else if (rec.tied) c.ties += 1;
  else c.losses += 1;
  c.runs += rec.yourRuns;
  c.fours += rec.yourTokens.filter((t) => tokenBase(t) === '4').length;
  c.sixes += rec.yourTokens.filter((t) => tokenBase(t) === '6').length;

  if (rec.earlyDuck) {
    c.earlyDucks += 1;
    notes.push(`🦆 Early duck #${c.earlyDucks} — the book got you today. Even legends have walked this road.`);
  }

  if (rec.won) {
    c.winStreak += 1;
    if (c.winStreak > c.bestWinStreak) {
      c.bestWinStreak = c.winStreak;
      if (c.winStreak >= 3) notes.push(`🔥 ${c.winStreak} wins on the trot — your longest run ever.`);
    }
  } else if (!rec.tied) {
    c.winStreak = 0; // a tie keeps the streak alive — the book couldn't split you
  }

  if (rec.yourRuns > c.bestTotal) {
    const hadPrevious = c.bestTotal > 0;
    c.bestTotal = rec.yourRuns;
    if (hadPrevious) notes.push(`🏆 New personal best: ${rec.yourRuns} runs in an innings.`);
  }
  return notes;
}

/** Tracks the single unlikeliest ball ever flipped; celebrates when beaten. */
export function considerLuckiest(save: SaveData, desc: string, chance: number): string | null {
  const chancePct = chance * 100;
  if (save.luckiest !== null && chancePct >= save.luckiest.chancePct) return null;
  const hadPrevious = save.luckiest !== null;
  save.luckiest = { desc, chancePct };
  return hadPrevious ? `🍀 ${desc} — the unlikeliest thing you've ever seen.` : null;
}

/**
 * Marks today's daily as taken the moment the chase begins, so a mid-match
 * refresh can't buy a second attempt. Also advances the played-streak.
 */
export function beginDailyAttempt(save: SaveData, dayKey: string): void {
  const d = save.daily;
  if (d.today?.dayKey === dayKey) return;
  d.streak = d.lastPlayedKey === previousDayKey(dayKey) ? d.streak + 1 : 1;
  if (d.streak > d.bestStreak) d.bestStreak = d.streak;
  d.lastPlayedKey = dayKey;
  d.played += 1;
  d.today = { dayKey, result: null };
}

export function completeDailyAttempt(save: SaveData, dayKey: string, result: DailyOutcome): void {
  if (save.daily.today?.dayKey !== dayKey) return;
  save.daily.today.result = result;
  if (result.won) save.daily.wins += 1;
}
