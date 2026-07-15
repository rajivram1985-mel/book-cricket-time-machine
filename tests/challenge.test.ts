import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_HASH_PREFIX,
  challengeShareText,
  challengeTarget,
  challengeUrl,
  decodeChallenge,
  encodeChallenge,
  parseChallengeHash,
  tokensToBalls,
  type ChallengePayload,
} from '../src/challenge';
import { SPELL, VIRTUAL_BOOK } from '../src/engine';

const classicPayload = (): ChallengePayload => ({
  mode: 'classic',
  batId: 'sachin-tendulkar',
  bowlId: 'shane-warne',
  book: { title: 'Wren & Martin English Grammar', pages: 320 },
  eraAdjust: false,
  runs: 34,
  wickets: 1,
  ballsFaced: 12,
  tokens: ['4', '1', 'W', '6×2', '2', '1', '4', '6', '1', '3', '1', '5'],
});

const statsPayload = (): ChallengePayload => ({
  mode: 'stats',
  batId: 'virat-kohli',
  bowlId: 'malcolm-marshall',
  book: { ...VIRTUAL_BOOK },
  eraAdjust: true,
  runs: 41,
  wickets: 0,
  ballsFaced: 10,
  tokens: [],
});

/** Encode, then surgically alter one wire field, re-encode — a tampered link. */
function tamper(p: ChallengePayload, patch: Record<string, unknown>): string {
  const encoded = encodeChallenge(p);
  const b64 = encoded.slice('v1.'.length).replace(/-/g, '+').replace(/_/g, '/');
  const wire = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  const bytes = new TextEncoder().encode(JSON.stringify({ ...wire, ...patch }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'v1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('challenge codec round trip', () => {
  it('round-trips a classic payload exactly', () => {
    expect(decodeChallenge(encodeChallenge(classicPayload()))).toEqual(classicPayload());
  });

  it('round-trips a stats payload exactly', () => {
    expect(decodeChallenge(encodeChallenge(statsPayload()))).toEqual(statsPayload());
  });

  it('survives power-play (×2, unicode) tokens through base64url', () => {
    const p = decodeChallenge(encodeChallenge(classicPayload()))!;
    expect(p.tokens).toContain('6×2');
  });

  it('produces a URL-safe string (no +, /, =)', () => {
    const encoded = encodeChallenge(classicPayload());
    expect(encoded).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
  });
});

describe('challenge decode validation', () => {
  it('rejects a wrong version prefix', () => {
    expect(decodeChallenge('v2.abcdef')).toBeNull();
  });

  it('rejects garbage base64 and non-JSON payloads', () => {
    expect(decodeChallenge('v1.!!!not-base64!!!')).toBeNull();
    expect(decodeChallenge('v1.aGVsbG8')).toBeNull(); // "hello"
  });

  it('rejects an unknown batsman id', () => {
    expect(decodeChallenge(tamper(classicPayload(), { b: 'ricky-gervais' }))).toBeNull();
  });

  it('rejects a bowler placed in the batting slot', () => {
    // glenn-mcgrath has no batting stats — the odds engine would crash
    expect(decodeChallenge(tamper(classicPayload(), { b: 'glenn-mcgrath' }))).toBeNull();
  });

  it('rejects identical bat and bowl ids', () => {
    expect(decodeChallenge(tamper(classicPayload(), { o: 'sachin-tendulkar' }))).toBeNull();
  });

  it('rejects out-of-bounds page counts in classic mode', () => {
    expect(decodeChallenge(tamper(classicPayload(), { p: 5 }))).toBeNull();
    expect(decodeChallenge(tamper(classicPayload(), { p: 30000 }))).toBeNull();
    expect(decodeChallenge(tamper(classicPayload(), { p: 100.5 }))).toBeNull();
  });

  it('forces the fixed virtual book in stats mode regardless of the wire', () => {
    const decoded = decodeChallenge(tamper(statsPayload(), { p: 7, t: 'Forged Almanack' }));
    expect(decoded?.book).toEqual(VIRTUAL_BOOK);
  });

  it('rejects impossible scores', () => {
    expect(decodeChallenge(tamper(classicPayload(), { r: -1 }))).toBeNull();
    expect(decodeChallenge(tamper(classicPayload(), { r: 999 }))).toBeNull();
    expect(decodeChallenge(tamper(classicPayload(), { w: SPELL.maxWickets + 1 }))).toBeNull();
    expect(decodeChallenge(tamper(classicPayload(), { n: 0 }))).toBeNull();
    expect(decodeChallenge(tamper(classicPayload(), { n: SPELL.maxBalls + 1 }))).toBeNull();
  });

  it('soft-fails display tokens (empty) instead of rejecting the challenge', () => {
    const junk = decodeChallenge(tamper(classicPayload(), { g: 'lol.nope' }));
    expect(junk).not.toBeNull();
    expect(junk!.tokens).toEqual([]);
    const wrongCount = decodeChallenge(tamper(classicPayload(), { g: '4.1' }));
    expect(wrongCount!.tokens).toEqual([]);
  });

  it('caps an oversized classic book title instead of rejecting', () => {
    const decoded = decodeChallenge(tamper(classicPayload(), { t: 'x'.repeat(500) }));
    expect(decoded!.book.title).toHaveLength(60);
  });

  it('defaults a blank classic title to the battered library book', () => {
    const decoded = decodeChallenge(tamper(classicPayload(), { t: '  ' }));
    expect(decoded!.book.title).toBe('A Battered Library Book');
  });

  it('forces eraAdjust off for classic mode', () => {
    const decoded = decodeChallenge(tamper(classicPayload(), { e: 1 }));
    expect(decoded!.eraAdjust).toBe(false);
  });
});

describe('parseChallengeHash', () => {
  it('parses a full location.hash', () => {
    const hash = CHALLENGE_HASH_PREFIX + encodeChallenge(classicPayload());
    expect(parseChallengeHash(hash)).toEqual(classicPayload());
  });

  it('returns null for empty, foreign, or prefix-less hashes', () => {
    expect(parseChallengeHash('')).toBeNull();
    expect(parseChallengeHash('#other=abc')).toBeNull();
    expect(parseChallengeHash(encodeChallenge(classicPayload()))).toBeNull();
  });
});

describe('challenge URL and share text', () => {
  it('builds the URL on the hash, not the query string', () => {
    const url = challengeUrl(classicPayload(), 'https://example.com');
    expect(url.startsWith('https://example.com/#challenge=v1.')).toBe(true);
    expect(url).not.toContain('?');
  });

  it('share text carries the scoreline, the target, and the link', () => {
    const p = classicPayload();
    const text = challengeShareText(p);
    expect(text).toContain('34/1 off 12');
    expect(text).toContain('chase 35');
    expect(text).toContain(CHALLENGE_HASH_PREFIX.slice(1));
  });

  it('counter share text reframes as a rematch', () => {
    expect(challengeShareText(classicPayload(), { counter: true })).toContain('rematch');
  });

  it('target is always runs + 1', () => {
    expect(challengeTarget({ ...classicPayload(), runs: 0 })).toBe(1);
    expect(challengeTarget({ ...classicPayload(), runs: 41 })).toBe(42);
  });
});

describe('tokensToBalls', () => {
  it('maps wickets, runs and power-play doubles', () => {
    const balls = tokensToBalls(['W', '6×2', '3']);
    expect(balls[0].outcome).toEqual({ kind: 'wicket' });
    expect(balls[0].doubled).toBeUndefined();
    expect(balls[1].outcome).toEqual({ kind: 'runs', runs: 6 });
    expect(balls[1].doubled).toBe(true);
    expect(balls[2].outcome).toEqual({ kind: 'runs', runs: 3 });
  });

  it('returns an empty list for empty tokens', () => {
    expect(tokensToBalls([])).toEqual([]);
  });
});
