import type { Ball, Mode } from './types';
import { MIN_PAGES, SPELL, VIRTUAL_BOOK } from './engine';
import { ROSTER } from './roster';
import { SHARE_URL } from './daily';

/**
 * Challenge links — "beat my score", the schoolyard dare as a URL.
 *
 * After a match, the player's own batted innings becomes the target: the
 * link carries the matchup (batsman, bowler, book, era-adjust) and the
 * score, and a friend opening it chases runs + 1 under the IDENTICAL odds.
 * The chase itself is live RNG (like the Daily) — only the target travels,
 * so there's no seed and no replay determinism to protect.
 *
 * The payload rides in the URL *hash* (`/#challenge=v1.<base64url JSON>`),
 * never a query string: the fragment never reaches the server (no logs to
 * scrub), and it can't bust the service-worker cache. No names travel in
 * the link either — identity comes from the chat where it lands.
 *
 * decodeChallenge is deliberately paranoid: every field is validated
 * against the roster/engine bounds and clamped or rejected, because the
 * payload is user-editable by construction. A tampered link degrades to
 * null (a friendly "torn page" fallback upstream), never to a crash. No
 * signing/anti-cheat — it's a friendly dare between kids, and the worst a
 * forged link can claim is a score.
 */

export const CHALLENGE_HASH_PREFIX = '#challenge=';
const PAYLOAD_VERSION_PREFIX = 'v1.';
const MAX_TITLE_CHARS = 60;
/** 12 balls × 6 runs × 2 (power play) — nothing legitimate exceeds this. */
const MAX_RUNS = SPELL.maxBalls * 6 * 2;
const TOKEN_RE = /^(W|[1-6])(×2)?$/;

export interface ChallengePayload {
  mode: Mode;
  /** The friend bats with the challenger's batsman… */
  batId: string;
  /** …against the bowler the challenger faced. Same duel, different flips. */
  bowlId: string;
  book: { title: string; pages: number };
  /** Stats mode only — replicated so the odds match the challenger's exactly. */
  eraAdjust: boolean;
  runs: number;
  wickets: number;
  ballsFaced: number;
  /** Ball-by-ball tokens ('W', '1'–'6', '×2' suffix) — display only, may be empty. */
  tokens: string[];
}

export function challengeTarget(p: ChallengePayload): number {
  return p.runs + 1;
}

// ---------- base64url (unicode-safe via TextEncoder/TextDecoder) ----------

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// ---------- encode / decode ----------

/** Wire shape — single-letter keys to keep the link WhatsApp-friendly. */
interface Wire {
  m: 'c' | 's';
  b: string;
  o: string;
  p: number;
  t: string;
  e: 0 | 1;
  r: number;
  w: number;
  n: number;
  g: string;
}

export function encodeChallenge(p: ChallengePayload): string {
  const wire: Wire = {
    m: p.mode === 'classic' ? 'c' : 's',
    b: p.batId,
    o: p.bowlId,
    p: p.book.pages,
    t: p.mode === 'classic' ? p.book.title.slice(0, MAX_TITLE_CHARS) : '',
    e: p.eraAdjust ? 1 : 0,
    r: p.runs,
    w: p.wickets,
    n: p.ballsFaced,
    g: p.tokens.join('.'),
  };
  return PAYLOAD_VERSION_PREFIX + toBase64Url(JSON.stringify(wire));
}

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

/**
 * Strict parse of an encoded payload. Returns null on ANY anomaly rather
 * than best-guessing — a bad link should read as "torn page", not produce
 * a half-valid match. Exception: display-only tokens soft-fail to [].
 */
export function decodeChallenge(encoded: string): ChallengePayload | null {
  if (!encoded.startsWith(PAYLOAD_VERSION_PREFIX)) return null;
  const json = fromBase64Url(encoded.slice(PAYLOAD_VERSION_PREFIX.length));
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (o.m !== 'c' && o.m !== 's') return null;
  const mode: Mode = o.m === 'c' ? 'classic' : 'stats';

  // The matchup must be real roster members in the right roles — the odds
  // engine dereferences .batting!/.bowling! and must never see a null.
  if (typeof o.b !== 'string' || typeof o.o !== 'string' || o.b === o.o) return null;
  const bat = ROSTER.find((pl) => pl.id === o.b);
  const bowl = ROSTER.find((pl) => pl.id === o.o);
  if (!bat?.batting || !bowl?.bowling) return null;

  let book: { title: string; pages: number };
  if (mode === 'stats') {
    // Stats mode always plays the fixed virtual book — nothing to trust.
    book = { ...VIRTUAL_BOOK };
  } else {
    if (!isInt(o.p) || o.p < MIN_PAGES || o.p > 20000) return null;
    const title =
      typeof o.t === 'string' && o.t.trim() !== ''
        ? o.t.slice(0, MAX_TITLE_CHARS)
        : 'A Battered Library Book';
    book = { title, pages: o.p };
  }

  if (!isInt(o.r) || o.r < 0 || o.r > MAX_RUNS) return null;
  if (!isInt(o.w) || o.w < 0 || o.w > SPELL.maxWickets) return null;
  if (!isInt(o.n) || o.n < 1 || o.n > SPELL.maxBalls) return null;

  let tokens: string[] = [];
  if (typeof o.g === 'string' && o.g !== '') {
    const parts = o.g.split('.');
    if (parts.length === o.n && parts.every((t) => TOKEN_RE.test(t))) tokens = parts;
  }

  return {
    mode,
    batId: bat.id,
    bowlId: bowl.id,
    book,
    eraAdjust: mode === 'stats' ? o.e === 1 : false,
    runs: o.r,
    wickets: o.w,
    ballsFaced: o.n,
    tokens,
  };
}

/** Pulls a payload out of a location.hash; null when absent or invalid. */
export function parseChallengeHash(hash: string): ChallengePayload | null {
  if (!hash.startsWith(CHALLENGE_HASH_PREFIX)) return null;
  return decodeChallenge(hash.slice(CHALLENGE_HASH_PREFIX.length));
}

export function challengeUrl(p: ChallengePayload, base: string = SHARE_URL): string {
  return `${base}/${CHALLENGE_HASH_PREFIX}${encodeChallenge(p)}`;
}

// ---------- display helpers ----------

/**
 * Reconstructs display-grade Ball objects from share tokens so the
 * challenger's innings can sit in the usual InningsRecord shape. Pages are
 * synthesized as 0 — nothing downstream reads them for a challenge (the
 * luck report is chase-only, and the verdict formats from the payload).
 */
export function tokensToBalls(tokens: string[]): Ball[] {
  return tokens.map((t) => {
    const doubled = t.endsWith('×2');
    const base = doubled ? t.slice(0, -2) : t;
    const outcome: Ball['outcome'] =
      base === 'W' ? { kind: 'wicket' } : { kind: 'runs', runs: Number(base) as 1 | 2 | 3 | 4 | 5 | 6 };
    const ball: Ball = { page: 0, digit: base === 'W' ? 0 : Number(base), outcome };
    if (doubled) ball.doubled = true;
    return ball;
  });
}

/**
 * The message that travels WITH the link. No name inside — the chat app
 * supplies the identity. `counter` reframes it as the return dare after a
 * finished challenge.
 */
export function challengeShareText(p: ChallengePayload, opts: { counter?: boolean } = {}): string {
  const scoreline = `${p.runs}/${p.wickets} off ${p.ballsFaced}`;
  const opener = opts.counter
    ? `⚔️ Right back at you — book cricket rematch!`
    : `⚔️ Book cricket challenge!`;
  const lines = [
    opener,
    `I scored ${scoreline} flipping “${p.book.title}”.`,
    `Same book, same matchup, same odds — chase ${challengeTarget(p)} to beat me:`,
    challengeUrl(p),
  ];
  return lines.join('\n');
}
