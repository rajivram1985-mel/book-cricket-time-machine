import './style.css';
import { batsmen, bowlers, ROSTER } from './roster';
import { avatarSvg } from './avatar';
import { playBoundary, playFlip, playRuns, playWicket } from './audio';
import { commentaryFor, verdictFlavor } from './commentary';
import * as eng from './engine';
import {
  ballTokens,
  dailyOutcomePhrase,
  dailyShareText,
  emojiGrid,
  generateDaily,
  localDayKey,
  pickRandomBook,
  type DailyChallenge,
  type DailyOutcome,
} from './daily';
import {
  beginDailyAttempt,
  completeDailyAttempt,
  considerLuckiest,
  createStore,
  recordMatch,
} from './storage';
import { playMomentVoice, playNameCallout, resolveBallMoment, resolveMatchMoment } from './voice';
import { COMMENTATORS } from './commentators';
import type { Ball, Mode, Player, Probabilities, Stance } from './types';

/** Per-ball snapshot of what the odds said, for the post-match luck report. */
interface BallLuck {
  expected: number;
  chance: number;
}

interface InningsRecord {
  runs: number;
  wickets: number;
  balls: Ball[];
  luck: BallLuck[];
}

/** A live best-of-3 Gauntlet series (Stats mode only). */
interface SeriesState {
  matchNumber: number;
  wins: number;
  losses: number;
  ties: number;
}

interface State {
  mode: Mode;
  reduceMotion: boolean;
  /** Mirrored to the on-device scorebook so it survives reloads. */
  soundOn: boolean;
  /** Pre-generated commentary clips on big moments — silent until clips exist. */
  voiceOn: boolean;
  /** Which commentator persona's clips to play — see src/commentators.ts. */
  commentatorId: string;
  phase: 'home' | 'setup' | 'play';
  /** Set while a Daily Challenge chase is live; null for regular matches. */
  daily: DailyChallenge | null;
  // setup — classic (your flavour pair vs the rival's)
  /** Default is a random nostalgic pick; 'manual' reveals the title/pages fields below. */
  classicBookMode: 'random' | 'manual';
  classicRandomBook: { title: string; pages: number };
  bookTitle: string;
  pagesRaw: string;
  classicBatId: string;
  classicBowlId: string;
  classicRivalBatId: string;
  classicRivalBowlId: string;
  // setup — stats
  batsmanId: string | null;
  bowlerId: string | null;
  statsRivalBatId: string;
  statsRivalBowlId: string;
  eraAdjust: boolean;
  // active match: your XI bats innings 1, the rival XI chases in innings 2
  yourBatId: string;
  yourBowlId: string;
  rivalBatId: string;
  rivalBowlId: string;
  innings: 1 | 2;
  /** Runs the chasing side needs to win (first-innings runs + 1). */
  target: number | null;
  inn1: InningsRecord | null;
  /** Batting intent while the player's side bats (Stats/Daily only). */
  stance: Stance;
  /** Power play armed for the next ball (player) / consumed this innings (either side). */
  ppArmed: boolean;
  ppUsed: boolean;
  /** Gauntlet toggle in Stats setup, and the live series once started. */
  gauntletOn: boolean;
  series: SeriesState | null;
  /** Pre-drawn rivals for the next Gauntlet match, teased in the verdict. */
  nextRivalBatId: string;
  nextRivalBowlId: string;
  pageCount: number;
  spellBookTitle: string;
  probs: Probabilities | null;
  balls: Ball[];
  luck: BallLuck[];
  runs: number;
  wickets: number;
  momentum: number;
  consecutiveSixes: number;
  spellOver: boolean;
  busy: boolean;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function drawPlayer(pool: Player[], excludeIds: string[]): Player {
  const options = pool.filter((p) => !excludeIds.includes(p.id));
  return randomFrom(options.length > 0 ? options : pool);
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The on-device scorebook — localStorage only, no accounts, no network. */
const store = createStore();

function freshSetup(mode: Mode): State {
  const yourBat = drawPlayer(batsmen(), []);
  const yourBowl = drawPlayer(bowlers(), [yourBat.id]);
  const rivalBat = drawPlayer(batsmen(), [yourBat.id, yourBowl.id]);
  const rivalBowl = drawPlayer(bowlers(), [yourBat.id, yourBowl.id, rivalBat.id]);
  const statsRivalBat = drawPlayer(batsmen(), []);
  const statsRivalBowl = drawPlayer(bowlers(), [statsRivalBat.id]);
  return {
    mode,
    reduceMotion: state?.reduceMotion ?? prefersReducedMotion,
    soundOn: state?.soundOn ?? store.data.prefs.soundOn,
    voiceOn: state?.voiceOn ?? store.data.prefs.voiceOn,
    commentatorId: state?.commentatorId ?? store.data.prefs.commentatorId,
    phase: 'setup',
    daily: null,
    classicBookMode: 'random',
    classicRandomBook: pickRandomBook(),
    bookTitle: '',
    pagesRaw: '',
    classicBatId: yourBat.id,
    classicBowlId: yourBowl.id,
    classicRivalBatId: rivalBat.id,
    classicRivalBowlId: rivalBowl.id,
    batsmanId: null,
    bowlerId: null,
    statsRivalBatId: statsRivalBat.id,
    statsRivalBowlId: statsRivalBowl.id,
    eraAdjust: false,
    yourBatId: '',
    yourBowlId: '',
    rivalBatId: '',
    rivalBowlId: '',
    innings: 1,
    target: null,
    inn1: null,
    stance: 'normal',
    ppArmed: false,
    ppUsed: false,
    gauntletOn: false,
    series: null,
    nextRivalBatId: '',
    nextRivalBowlId: '',
    pageCount: 0,
    spellBookTitle: '',
    probs: null,
    balls: [],
    luck: [],
    runs: 0,
    wickets: 0,
    momentum: 0,
    consecutiveSixes: 0,
    spellOver: false,
    busy: false,
  };
}

let state: State;
state = freshSetup('classic');
state.phase = 'home';

const app = document.querySelector<HTMLDivElement>('#app')!;

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function playerById(id: string | null): Player | null {
  return ROSTER.find((p) => p.id === id) ?? null;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Innings 1: your batsman vs the rival's bowler. Innings 2: their batsman
 * vs yours. Daily flips the frame: the rival's innings was pre-seeded, so
 * the live chase is always *your* batsman against *their* bowler.
 */
function currentPair(): { bat: Player; bowl: Player } {
  if (state.daily) return { bat: playerById(state.yourBatId)!, bowl: playerById(state.rivalBowlId)! };
  return state.innings === 1
    ? { bat: playerById(state.yourBatId)!, bowl: playerById(state.rivalBowlId)! }
    : { bat: playerById(state.rivalBatId)!, bowl: playerById(state.yourBowlId)! };
}

function currentEraGap(): number {
  if (!state.eraAdjust) return 0;
  const { bat, bowl } = currentPair();
  return eng.eraGapYears(bat.era, bowl.era);
}

/** The player bats innings 1 of a regular match and every daily chase; the AI rival bats innings 2. */
function playerBatting(): boolean {
  return state.daily !== null || state.innings === 1;
}

/**
 * What the batting side intends for the next ball. The player's intent
 * comes from the stance buttons and the armed power play; the rival's is
 * computed from the chase situation — pure functions, so the UI can
 * announce it before the flip and the flip honours exactly that.
 */
function currentIntent(): { stance: Stance; powerPlay: boolean } {
  if (playerBatting()) {
    return {
      stance: state.mode === 'stats' ? state.stance : 'normal',
      powerPlay: state.ppArmed && !state.ppUsed,
    };
  }
  const needed = (state.target ?? 0) - state.runs;
  const ballsLeft = eng.SPELL.maxBalls - state.balls.length;
  return {
    stance: state.mode === 'stats' ? eng.chaseStance(needed, ballsLeft) : 'normal',
    powerPlay: eng.chaseUsesPowerPlay(needed, ballsLeft, state.ppUsed, state.mode),
  };
}

function probsForBall(ballsFaced: number): Probabilities {
  const { bat, bowl } = currentPair();
  const intent = currentIntent();
  return eng.computeProbabilities(
    bat.batting!,
    bowl.bowling!,
    currentEraGap(),
    ballsFaced,
    intent.stance,
    intent.powerPlay,
  );
}

// ---------- home / pavilion ----------

function countdownText(): string {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(1, Math.round((midnight.getTime() - now.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Day key the current home screen was rendered for — the ticker watches it roll. */
let renderedDayKey = '';

/** Has today's daily already been started (played to a result, or abandoned mid-chase)? */
function dailyPlayedToday(key: string): boolean {
  return store.data.daily.today?.dayKey === key;
}

function dailyBookHtml(): string {
  const key = localDayKey();
  renderedDayKey = key;
  const ch = generateDaily(key);
  const d = store.data.daily;
  const prettyDate = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const today = d.today?.dayKey === key ? d.today : null;

  if (today?.result) {
    const r = today.result;
    const mark = r.won ? '✅' : r.tied ? '🤝' : '❌';
    return `
      <div class="book book-daily book-done" title="${esc(prettyDate)}">
        <span class="book-spine"></span>
        <span class="book-kicker">DAILY #${ch.number}</span>
        <p class="book-heading">${esc(dailyOutcomePhrase(r))} ${mark}</p>
        <p class="daily-grid book-grid" aria-label="Ball by ball result">${emojiGrid(r.tokens)}</p>
        ${d.streak > 1 ? `<p class="streak-line book-streak">🔥 ${d.streak}-day streak</p>` : ''}
        <p class="book-sub">New pages at midnight — <span id="daily-countdown">${countdownText()}</span></p>
        <button class="btn small" data-action="copy-daily">${SHARE_DAILY_LABEL}</button>
      </div>`;
  }
  if (today) {
    return `
      <div class="book book-daily book-done" title="${esc(prettyDate)}">
        <span class="book-spine"></span>
        <span class="book-kicker">DAILY #${ch.number}</span>
        <p class="book-heading">Walked off mid-chase</p>
        <p class="book-sub">The scorebook shows a blank line. New pages at midnight — <span id="daily-countdown">${countdownText()}</span>.</p>
      </div>`;
  }

  const stake =
    d.streak >= 2
      ? `<p class="streak-line book-streak">🔥 ${d.streak}-day streak on the line</p>`
      : d.streak === 1
        ? '<p class="streak-line book-streak">🔥 Play today to start a streak</p>'
        : '';
  return `
    <button class="book book-daily book-featured" data-action="nav-daily" title="${esc(prettyDate)}">
      <span class="book-spine"></span>
      <span class="book-ribbon" aria-hidden="true"></span>
      <span class="book-kicker">DAILY #${ch.number} · ${esc(prettyDate)}</span>
      <p class="book-heading">Today’s chase</p>
      <p class="book-sub"><strong>${esc(ch.rivalBat.name)}</strong> posted ${ch.inn1.runs}/${ch.inn1.wickets} against
        your ${esc(ch.yourBowl.shortName)}, flipping “${esc(ch.book.title)}”. You get
        <strong>${esc(ch.yourBat.name)}</strong> — chase ${ch.target}.</p>
      ${stake}
      <span class="book-cta">Take up the chase <i>→</i></span>
    </button>`;
}

function classicBookHtml(accented: boolean): string {
  return `
    <button class="book book-classic ${accented ? 'book-featured' : ''}" data-action="nav-classic">
      <span class="book-spine"></span>
      <span class="book-kicker">CLASSIC</span>
      <p class="book-heading">Your lucky book</p>
      <p class="book-sub">Any book off the shelf — pure page-flip fate, schoolyard rules.</p>
      <span class="book-cta">Open it <i>→</i></span>
    </button>`;
}

function timeMachineBookHtml(accented: boolean): string {
  const streak = store.data.daily.streak;
  const sub =
    accented && streak >= 2
      ? `Your ${streak}-day streak says you’re ready for the Gauntlet.`
      : 'Pick your stance, gamble the power play, run the Gauntlet.';
  const preview = ROSTER.slice(0, 3);
  const avatars = preview.map((p) => `<span class="book-avatar">${avatarSvg(p, 22)}</span>`).join('');
  return `
    <button class="book book-stats ${accented ? 'book-featured' : ''}" data-action="nav-stats">
      <span class="book-spine"></span>
      <span class="book-kicker">TIME MACHINE</span>
      <p class="book-heading">Legends duel</p>
      <p class="book-sub">${esc(sub)}</p>
      <div class="book-avatars">${avatars}<span class="book-avatar-more">+${ROSTER.length - preview.length} more</span></div>
      <span class="book-cta">Pick your XI <i>→</i></span>
    </button>`;
}

function shelfHtml(): string {
  const played = dailyPlayedToday(localDayKey());
  const label = played ? 'The bell hasn’t rung — keep playing' : 'Pick up a book';
  return `
    <p class="shelf-label">${esc(label)}</p>
    <div class="shelf">
      ${dailyBookHtml()}
      ${classicBookHtml(played)}
      ${timeMachineBookHtml(played)}
    </div>`;
}

function ledgerStripHtml(): string {
  const c = store.data.career;
  if (c.matches === 0) {
    return `<p class="ledger-empty">📓 Your scorebook is blank, for now — every match gets pencilled in, on this device only.</p>`;
  }
  const luckiest =
    store.data.luckiest && store.data.luckiest.chancePct < 20
      ? `<span class="ledger-luck">🍀 ${esc(store.data.luckiest.desc)}</span>`
      : '';
  return `
    <div class="ledger-strip">
      <span><b>${c.matches}</b> matches</span>
      <span><b>${c.wins}–${c.losses}${c.ties ? `–${c.ties}` : ''}</b> W–L</span>
      <span><b>${c.bestTotal}</b> best</span>
      ${c.gauntletsWon > 0 ? `<span><b>${c.gauntletsWon}</b> gauntlets</span>` : ''}
      ${luckiest}
    </div>`;
}

function homeHtml(): string {
  return `
    <div class="home">
      <section class="hero">
        <p class="hero-kicker">Do you remember?</p>
        <h2>The whole stadium fit inside a textbook.</h2>
        <details class="hero-memory">
          <summary>Remember the last bench? <i>▾</i></summary>
          <p class="hero-copy">Last bench, double period, monsoon hammering the windows. Someone slid a fat
            textbook across the desk and whispered a challenge. You flipped a page and read fate off the
            number in the corner — a <strong>6</strong> and you were Tendulkar at Sharjah; a <strong>0</strong> and
            the whole bench groaned. No bat, no ball, no ground. Just paper, luck, and glory.</p>
        </details>
        <div class="rules-chips" aria-label="Book cricket rules">
          <span class="rule-chip out">0 = OUT</span>
          <span class="rule-chip">1–6 = that many runs</span>
          <span class="rule-chip">7 · 8 · 9 = a single</span>
        </div>
      </section>
      ${shelfHtml()}
      ${ledgerStripHtml()}
    </div>`;
}

// ---------- setup screen ----------

function playerCard(p: Player, role: 'batsman' | 'bowler', selectedId: string | null): string {
  const stats =
    role === 'batsman'
      ? `avg ${p.batting!.average} · SR ${p.batting!.strikeRate}`
      : `avg ${p.bowling!.average} · econ ${p.bowling!.economy}`;
  const style = role === 'batsman' ? p.style.batting : p.style.bowling;
  return `
    <button class="player-card ${p.id === selectedId ? 'selected' : ''}"
            data-action="pick-${role}" data-id="${p.id}" title="${esc(p.bio)}">
      ${avatarSvg(p, 52)}
      <span class="pc-name">${esc(p.name)}</span>
      <span class="pc-era">${esc(p.era.label)} · ${esc(p.country)}</span>
      <span class="pc-stats">${stats}</span>
      <span class="pc-style">${esc(style ?? '')}</span>
      <span class="pc-tags">${p.strengths.map((s) => `<i>${esc(s)}</i>`).join('')}</span>
    </button>`;
}

function luckyPick(p: Player, label: string): string {
  return `
    <div class="lucky-pick">
      ${avatarSvg(p, 44)}
      <div><span class="lp-label">${label}</span><span class="lp-name">${esc(p.name)}</span></div>
    </div>`;
}

function eraPairLine(label: string, bat: Player | null, bowl: Player | null): string {
  if (!bat || !bowl) return '';
  const gap = eng.eraGapYears(bat.era, bowl.era);
  if (gap === 0) return '';
  const years = `${gap} year${gap === 1 ? '' : 's'} apart`;
  if (!state.eraAdjust) {
    return `<p class="hint cross-era">⏳ ${label}: ${esc(bat.shortName)} and ${esc(bowl.shortName)} never shared an era (${years}). Consider era adjustment!</p>`;
  }
  const mult = eng.eraAdjustmentMultiplier(gap);
  const effect = mult > 1 ? `wicket odds ×${mult.toFixed(2)}` : 'within the grace band — no penalty';
  return `<p class="hint cross-era">⏳ ${label}: ${esc(bat.shortName)} vs ${esc(bowl.shortName)} — ${years}, ${effect}.</p>`;
}

function setupHtml(): string {
  const pagesCheck = state.pagesRaw.trim() === '' ? null : eng.validatePageCount(state.pagesRaw);
  const pagesError = pagesCheck && !pagesCheck.ok ? pagesCheck.error : null;

  const canStart =
    state.mode === 'classic'
      ? state.classicBookMode === 'random' || (pagesCheck !== null && pagesCheck.ok)
      : state.batsmanId !== null && state.bowlerId !== null;

  const bat = playerById(state.batsmanId);
  const bowl = playerById(state.bowlerId);
  const rivalBat = playerById(state.statsRivalBatId)!;
  const rivalBowl = playerById(state.statsRivalBowlId)!;

  const bookModeToggle = `
    <div class="mode-toggle book-mode-toggle" role="tablist" aria-label="How to pick your book">
      <button class="mode-btn ${state.classicBookMode === 'random' ? 'active' : ''}" data-action="book-mode-random" role="tab" aria-selected="${state.classicBookMode === 'random'}">🎲 Surprise me</button>
      <button class="mode-btn ${state.classicBookMode === 'manual' ? 'active' : ''}" data-action="book-mode-manual" role="tab" aria-selected="${state.classicBookMode === 'manual'}">✍️ My own book</button>
    </div>`;

  const randomBookCard = `
    <div class="random-book-card">
      <span class="rbc-title">“${esc(state.classicRandomBook.title)}”</span>
      <span class="rbc-pages">${state.classicRandomBook.pages} pages</span>
      <button class="btn small" data-action="reroll-book" title="Pick a different book">🎲 Different book</button>
    </div>`;

  const manualBookFields = `
      <label class="field">Book title
        <input id="book-title" type="text" placeholder="e.g. Wuthering Heights (the battered library copy)"
               value="${esc(state.bookTitle)}" autocomplete="off" />
      </label>
      <label class="field">Total pages
        <input id="pages" type="text" inputmode="numeric" placeholder="e.g. 314 (must be more than 20)"
               value="${esc(state.pagesRaw)}" autocomplete="off" />
      </label>
      ${pagesError ? `<p class="error" role="alert">${esc(pagesError)}</p>` : ''}`;

  const classicPanel = `
    <section class="panel">
      <h2>📖 Pick your lucky book</h2>
      ${bookModeToggle}
      ${state.classicBookMode === 'random' ? randomBookCard : manualBookFields}
      <div class="lucky-row">
        ${luckyPick(playerById(state.classicBatId)!, 'Your bat')}
        ${luckyPick(playerById(state.classicBowlId)!, 'Your bowler')}
        <span class="vs">vs</span>
        ${luckyPick(playerById(state.classicRivalBatId)!, 'Rival bat')}
        ${luckyPick(playerById(state.classicRivalBowlId)!, 'Rival bowler')}
        <button class="btn small" data-action="reroll" title="Re-draw the flavour players">🎲 Reroll</button>
      </div>
      <p class="hint">Classic is pure page-flip luck — the legends are just along for the ride. You bat first; the rival chases.</p>
    </section>`;

  const statsPanel = `
    <section class="panel">
      <h2>🏏 Pick your XI</h2>
      <h3>Your batsman</h3>
      <div class="player-grid">${batsmen().map((p) => playerCard(p, 'batsman', state.batsmanId)).join('')}</div>
      <h3>Your bowler</h3>
      <div class="player-grid">${bowlers().map((p) => playerCard(p, 'bowler', state.bowlerId)).join('')}</div>
      <h3>Rival XI</h3>
      <div class="lucky-row">
        ${luckyPick(rivalBat, 'Rival batsman')}
        <span class="vs">&amp;</span>
        ${luckyPick(rivalBowl, 'Rival bowler')}
        <button class="btn small" data-action="reroll-rival" title="Re-draw the rival XI">🎲 Reroll rival</button>
      </div>
      <p class="hint">Your batsman faces ${esc(rivalBowl.shortName)} in innings 1; ${esc(rivalBat.shortName)} chases against your bowler.</p>
      <label class="toggle-row" title="When two players' careers never overlapped, nudge the wicket odds up — bridging eras is hard, even for legends.">
        <input type="checkbox" id="era-adjust" ${state.eraAdjust ? 'checked' : ''} />
        Era adjustment <span class="tooltip-hint">ⓘ</span>
      </label>
      ${
        state.eraAdjust
          ? `<p class="hint">Careers within ${eng.ERA_ADJUST_GRACE_YEARS} years of each other duel penalty-free; beyond that, wicket odds ramp up with the gap — to ×${(1 + eng.ERA_ADJUST_CAP).toFixed(2)} once careers are ${eng.ERA_ADJUST_SATURATION_YEARS}+ years apart.</p>`
          : ''
      }
      ${eraPairLine('Innings 1', bat, rivalBowl)}
      ${eraPairLine('Innings 2', rivalBat, bowl)}
      <label class="toggle-row" title="A best-of-3 series: win and the next rival pair is drawn from the top shelf. Beat three escalating XIs to conquer the Gauntlet.">
        <input type="checkbox" id="gauntlet" ${state.gauntletOn ? 'checked' : ''} />
        🏆 Gauntlet — best of 3, rivals get tougher <span class="tooltip-hint">ⓘ</span>
      </label>
      ${
        state.gauntletOn
          ? '<p class="hint">Match 1: any rival. Match 2: the top half by rating. Match 3: the bosses. Your first opponents are the pair above.</p>'
          : ''
      }
      <p class="disclaimer">Stats mode is a playful simulation for fun — not a factual prediction.</p>
    </section>`;

  return `
    <div class="setup">
      <button class="btn small back-link" data-action="go-home">← Pavilion</button>
      <p class="intro">Flip virtual pages, schoolyard style: <strong>0 is out, 1–6 score runs, 7–9 sneak a single.</strong>
      Classic mode is pure book luck; Stats mode weights every ball by real careers.</p>
      <div class="mode-toggle" role="tablist">
        <button class="mode-btn ${state.mode === 'classic' ? 'active' : ''}" data-action="mode-classic" role="tab" aria-selected="${state.mode === 'classic'}" aria-controls="screen" tabindex="${state.mode === 'classic' ? '0' : '-1'}">📖 Classic</button>
        <button class="mode-btn ${state.mode === 'stats' ? 'active' : ''}" data-action="mode-stats" role="tab" aria-selected="${state.mode === 'stats'}" aria-controls="screen" tabindex="${state.mode === 'stats' ? '0' : '-1'}">📊 Stats</button>
      </div>
      ${state.mode === 'classic' ? classicPanel : statsPanel}
      <button class="btn primary start" data-action="start" ${canStart ? '' : 'disabled'}>▶ Start Match</button>
      <p class="hint">A match is two innings — you bat first, then the rival chases. Each innings is ${eng.SPELL.maxBalls} balls or ${eng.SPELL.maxWickets} wickets.</p>
    </div>`;
}

// ---------- play screen ----------

function oddsBody(): string {
  if (!state.probs) return '';
  const p = state.probs;
  const { bat, bowl } = currentPair();
  const rows = ([1, 2, 3, 4, 5, 6] as const)
    .map((r) => `<tr><td>${r} run${r > 1 ? 's' : ''}</td><td>${pct(p.runs[r])}</td></tr>`)
    .join('');
  const mult = eng.eraAdjustmentMultiplier(currentEraGap());
  const eraNote = mult > 1 ? ` Era adjustment applied: cross-era wicket odds ×${mult.toFixed(2)}.` : '';
  const intent = currentIntent();
  const s = eng.STANCES[intent.stance];
  const stanceNote =
    intent.stance !== 'normal'
      ? ` Stance — ${s.label}: boundary weights ×${s.boundaryMult}, wicket odds ×${s.wicketMult}.`
      : '';
  const ppNote = intent.powerPlay
    ? ` ⚡ Power play armed: runs count double, wicket odds ×${eng.POWER_PLAY_WICKET_MULT} (capped at ${Math.round(eng.POWER_PLAY_WICKET_CAP * 100)}%).`
    : '';
  return `
    <p>Innings ${state.innings}: ${esc(bat.shortName)} vs ${esc(bowl.shortName)}. Each ball is drawn from this
    distribution — batting average vs bowling average sets the wicket odds; strike rate, boundary habits and
    bowler economy shape the runs. The odds shift over the innings too: the batsman is shakier for the first
    few balls, and the bowler's control loosens as the spell wears on.${eraNote}${stanceNote}${ppNote}</p>
    <table><tr><td>Wicket</td><td>${pct(p.wicket)}</td></tr>${rows}</table>`;
}

function oddsPanel(): string {
  if (!state.probs) return '';
  return `
    <details class="odds">
      <summary>🔍 How the odds work</summary>
      <div id="odds-body">${oddsBody()}</div>
    </details>`;
}

const STANCE_META: Record<Stance, { icon: string; hint: string }> = {
  defend: { icon: '🛡', hint: 'Boundaries ×0.45, wicket odds ×0.55 — protect your stumps.' },
  normal: { icon: '🏏', hint: 'Play it as it comes.' },
  attack: { icon: '⚔', hint: 'Boundaries ×1.95, wicket odds ×1.65 — swing for the fences.' },
};

function stanceRowHtml(): string {
  if (!playerBatting() || state.mode !== 'stats') return '';
  const btns = (['defend', 'normal', 'attack'] as const)
    .map(
      (s) => `<button class="stance-btn ${state.stance === s ? 'active' : ''}"
        data-action="stance-${s}" aria-pressed="${state.stance === s}">${STANCE_META[s].icon} ${eng.STANCES[s].label}</button>`,
    )
    .join('');
  return `
    <div class="stance-row" role="group" aria-label="Batting stance">${btns}</div>
    <p id="stance-hint" class="stance-hint">${esc(STANCE_META[state.stance].hint)}</p>`;
}

function ppLabel(): string {
  if (state.ppUsed) return '⚡ Power play spent';
  if (state.ppArmed) return '⚡ ARMED — double or nothing!';
  return '⚡ Power play';
}

function ppHint(): string {
  if (state.ppUsed) return 'The gamble is gone — one per innings.';
  const risk =
    state.mode === 'classic' ? '7, 8 and 9 are OUT, not singles' : 'wicket odds double too';
  return state.ppArmed
    ? `Next ball counts DOUBLE — but ${risk}. Click again to stand down.`
    : `Once per innings: the next ball counts double — but ${risk}.`;
}

function ppButtonHtml(): string {
  if (!playerBatting()) return '';
  return `
    <div class="pp-block">
      <button id="pp-btn" class="btn small powerplay ${state.ppArmed ? 'armed' : ''}"
        data-action="toggle-powerplay" aria-pressed="${state.ppArmed}" ${state.ppUsed ? 'disabled' : ''}>${ppLabel()}</button>
      <p id="pp-hint" class="pp-hint">${esc(ppHint())}</p>
    </div>`;
}

function aiIntentText(): string {
  if (playerBatting() || state.spellOver || state.target === null) return '';
  const { bat } = currentPair();
  const needed = state.target - state.runs;
  const ballsLeft = eng.SPELL.maxBalls - state.balls.length;
  const intent = currentIntent();
  const tail = `needs ${needed} off ${ballsLeft}`;
  if (intent.powerPlay) return `⚡ ${bat.shortName} goes DOUBLE OR NOTHING — ${tail}!`;
  if (intent.stance === 'attack') return `⚔ ${bat.shortName} attacks — ${tail}`;
  if (intent.stance === 'defend') return `🛡 ${bat.shortName} shuts the gate — only ${tail}`;
  return `🏏 ${bat.shortName} bats on — ${tail}`;
}

function flipLabel(): string {
  return state.ppArmed && playerBatting() && !state.ppUsed
    ? '📖 Flip — ⚡ DOUBLE OR NOTHING'
    : '📖 Flip the page';
}

function seriesLineHtml(): string {
  if (!state.series) return '';
  const s = state.series;
  return `<p class="series-line">🏆 Gauntlet match ${s.matchNumber} of 3 · You ${s.wins}–${s.losses}${s.ties ? `–${s.ties}` : ''}</p>`;
}

function playHtml(): string {
  const { bat, bowl } = currentPair();
  const banner = state.daily
    ? `Daily Challenge #${state.daily.number} · ${esc(bat.shortName)} chases ${state.target}`
    : state.innings === 1
      ? `Innings 1 · ${esc(bat.shortName)} sets the total`
      : `Innings 2 · ${esc(bat.shortName)} chases ${state.target}`;
  const ballsLine =
    state.innings === 2
      ? `0 of ${eng.SPELL.maxBalls} balls · needs ${state.target} off ${eng.SPELL.maxBalls}`
      : `0 of ${eng.SPELL.maxBalls} balls`;
  const dailyInn1 = state.daily
    ? `<p class="daily-inn1">${esc(state.daily.rivalBat.shortName)} set ${state.daily.inn1.runs}/${state.daily.inn1.wickets} off ${state.daily.inn1.balls.length}:
        ${ballTokens(state.daily.inn1.balls).join(' · ')} — same for everyone today.</p>`
    : '';
  return `
    <div class="play">
      <p class="innings-banner">${banner}</p>
      ${seriesLineHtml()}
      ${dailyInn1}
      <div class="matchup">
        <div class="fighter">${avatarSvg(bat, 56)}<span>${esc(bat.shortName)}</span><em>bat</em></div>
        <div class="score">
          <div id="score-line" class="score-line">0/0</div>
          <div id="balls-line" class="balls-line">${ballsLine}</div>
        </div>
        <div class="fighter">${avatarSvg(bowl, 56)}<span>${esc(bowl.shortName)}</span><em>ball</em></div>
      </div>

      <div class="momentum">
        <span class="mom-label">${esc(bowl.shortName)}</span>
        <div class="mom-track"><div id="mom-marker" class="mom-marker" style="left:50%"></div></div>
        <span class="mom-label">${esc(bat.shortName)}</span>
      </div>
      <p id="mom-status" class="mom-status">Evenly poised</p>

      <div class="book-area">
        <p class="book-title">“${esc(state.spellBookTitle)}” · ${state.pageCount} pages</p>
        <div id="flip-card" class="flip-card"><div class="flip-inner">
          <div id="page-face" class="page-face"><span class="page-num">?</span></div>
        </div></div>
        <div id="outcome-badge" class="outcome-badge"></div>
        <p id="commentary" class="commentary">The field is set. Flip when ready…</p>
      </div>

      <div id="ball-log" class="ball-log"></div>

      ${stanceRowHtml()}
      ${ppButtonHtml()}
      <p id="ai-intent" class="ai-intent">${esc(aiIntentText())}</p>
      <button id="flip-btn" class="btn primary ${state.ppArmed && playerBatting() ? 'armed' : ''}" data-action="flip">${flipLabel()}</button>
      ${state.mode === 'stats' ? oddsPanel() : ''}
      ${state.mode === 'stats' ? '<p class="disclaimer">Simulated for fun — not a factual prediction.</p>' : ''}
    </div>`;
}

// ---------- innings break & verdict ----------

function showInningsBreak(): void {
  const yourBat = playerById(state.yourBatId)!;
  const rivalBat = playerById(state.rivalBatId)!;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="verdict" role="dialog" aria-modal="true" aria-labelledby="break-heading" tabindex="-1">
      <h2 id="break-heading">Innings Break</h2>
      <p class="verdict-line">Your XI post <strong>${state.runs}/${state.wickets}</strong> off ${state.balls.length} balls —
        ${esc(yourBat.name)} walks off to schoolyard applause.</p>
      <p class="verdict-winner">${esc(rivalBat.name)} needs ${state.runs + 1} to win.</p>
      <div class="verdict-actions">
        <button class="btn primary" data-action="start-chase">▶ Start the chase</button>
      </div>
    </div>`;
  app.appendChild(overlay);
  overlay.querySelector<HTMLDivElement>('.verdict')?.focus();
}

function startChase(): void {
  document.querySelector('.overlay')?.remove();
  state.inn1 = { runs: state.runs, wickets: state.wickets, balls: state.balls, luck: state.luck };
  state.target = state.runs + 1;
  state.innings = 2;
  state.balls = [];
  state.luck = [];
  state.runs = 0;
  state.wickets = 0;
  state.momentum = 0;
  state.consecutiveSixes = 0;
  state.spellOver = false;
  state.busy = false;
  state.stance = 'normal';
  state.ppArmed = false;
  state.ppUsed = false; // the rival gets their own gamble
  state.probs = state.mode === 'stats' ? probsForBall(0) : null;
  render();
  document.querySelector<HTMLButtonElement>('#flip-btn')?.focus();
}

function matchWinnerLine(): string {
  const inn1 = state.inn1!;
  const result = eng.matchResult(inn1.runs, state.runs);
  if (result === 'defended') {
    const margin = inn1.runs - state.runs;
    return `🏆 Your XI wins by ${margin} run${margin === 1 ? '' : 's'}!`;
  }
  if (result === 'chased') {
    const inHand = eng.SPELL.maxWickets - state.wickets;
    const spare = eng.SPELL.maxBalls - state.balls.length;
    return `🏆 Rival XI wins by ${inHand} wicket${inHand === 1 ? '' : 's'}${spare > 0 ? ` with ${spare} ball${spare === 1 ? '' : 's'} to spare` : ''}!`;
  }
  return '🤝 Scores level — honours shared!';
}

function outcomeDescription(ball: Ball): string {
  const base =
    ball.outcome.kind === 'wicket'
      ? 'a wicket'
      : ball.outcome.runs === 6
        ? 'a six'
        : ball.outcome.runs === 4
          ? 'a four'
          : ball.outcome.runs === 1
            ? 'a single'
            : `${ball.outcome.runs} runs`;
  return ball.doubled ? `${base} on a power play` : base;
}

function luckPhrase(yourRatio: number, rivalRatio: number): string {
  if (yourRatio >= 1.25 && yourRatio >= rivalRatio) return 'The book batted for your XI today.';
  if (rivalRatio >= 1.25 && rivalRatio > yourRatio) return 'The book sided with the rival — demand a recount.';
  if (yourRatio <= 0.8 && yourRatio <= rivalRatio) return 'Your XI were robbed by the pages, frankly.';
  if (rivalRatio <= 0.8) return 'The rival got nothing cheap from this book.';
  return 'A fair book, honestly flipped.';
}

function allMoments(): { label: string; ball: Ball; chance: number }[] {
  const inn1 = state.inn1!;
  const inn1Label = state.daily ? 'the rival innings' : 'innings 1';
  const moments: { label: string; ball: Ball; chance: number }[] = [];
  inn1.balls.forEach((b, i) => moments.push({ label: `ball ${i + 1} of ${inn1Label}`, ball: b, chance: inn1.luck[i].chance }));
  state.balls.forEach((b, i) => moments.push({ label: `ball ${i + 1} of the chase`, ball: b, chance: state.luck[i].chance }));
  return moments;
}

function luckReportHtml(): string {
  const inn1 = state.inn1!;
  const exp1 = inn1.luck.reduce((a, l) => a + l.expected, 0);
  const exp2 = state.luck.reduce((a, l) => a + l.expected, 0);
  const x1 = exp1 > 0 ? inn1.runs / exp1 : 1;
  const x2 = exp2 > 0 ? state.runs / exp2 : 1;
  const inn1Label = state.daily ? 'Rival XI' : 'Your XI';
  const inn2Label = state.daily ? 'Your chase' : 'Rival XI';
  // luckPhrase speaks from your XI's corner; in the daily, that's the chase.
  const yourRatio = state.daily ? x2 : x1;
  const rivalRatio = state.daily ? x1 : x2;

  const moments = allMoments();
  const rarest = moments.reduce<(typeof moments)[number] | null>(
    (min, m) => (min === null || m.chance < min.chance ? m : min),
    null,
  );

  return `
    <div class="luck-report">
      <h3>📊 Luck report</h3>
      <p>${inn1Label}: expected ${exp1.toFixed(1)}, scored ${inn1.runs} (${x1.toFixed(2)}×) ·
        ${inn2Label}: expected ${exp2.toFixed(1)}, scored ${state.runs} (${x2.toFixed(2)}×)</p>
      ${rarest ? `<p>Unlikeliest moment: ${outcomeDescription(rarest.ball)} on ${rarest.label}, against ${(rarest.chance * 100).toFixed(1)}% odds.</p>` : ''}
      <p class="luck-phrase">${luckPhrase(yourRatio, rivalRatio)}</p>
    </div>`;
}

/**
 * Career bookkeeping for a finished match. Only balls the player actually
 * flipped count toward the luckiest-ever record (in the daily, the seeded
 * rival innings was nobody's flip). Returns celebration lines.
 */
function recordFinishedMatch(won: boolean, tied: boolean, yourRuns: number, yourBalls: Ball[]): string[] {
  const notes = recordMatch(store.data, {
    won,
    tied,
    yourRuns,
    yourTokens: ballTokens(yourBalls),
  });
  const flipped: { ball: Ball; chance: number }[] = [];
  if (!state.daily) {
    state.inn1!.balls.forEach((b, i) => flipped.push({ ball: b, chance: state.inn1!.luck[i].chance }));
  }
  state.balls.forEach((b, i) => flipped.push({ ball: b, chance: state.luck[i].chance }));
  const rarest = flipped.reduce<(typeof flipped)[number] | null>(
    (min, m) => (min === null || m.chance < min.chance ? m : min),
    null,
  );
  if (rarest) {
    const desc = `${outcomeDescription(rarest.ball)} against ${(rarest.chance * 100).toFixed(1)}% odds`;
    const luckNote = considerLuckiest(store.data, desc, rarest.chance);
    if (luckNote) notes.push(luckNote);
  }
  store.save();
  return notes;
}

function recordNotesHtml(notes: string[]): string {
  if (notes.length === 0) return '';
  return `<ul class="records">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
}

/** Cross-promo: nudge every verdict toward the daily if it's still open. */
function dailyNudgeHtml(): string {
  const key = localDayKey();
  if (state.daily || store.data.daily.today?.dayKey === key) return '';
  const ch = generateDaily(key);
  return `<p class="daily-nudge">📅 Daily Challenge #${ch.number} is still open — chase ${ch.target}, same pages for everyone.
    <button class="btn small" data-action="nav-daily">▶ Play it</button></p>`;
}

/** A finish decided on the very last ball without being bowled out first — the signature down-to-the-wire moment. */
function wentTheDistance(): boolean {
  return state.balls.length >= eng.SPELL.maxBalls && state.wickets < eng.SPELL.maxWickets;
}

/** A brief burst of paper-scrap confetti for a player win — gated on reduceMotion like every other animation. */
function celebrate(): void {
  if (state.reduceMotion) return;
  const burst = document.createElement('div');
  burst.className = 'confetti-burst';
  for (let i = 0; i < 28; i++) {
    const piece = document.createElement('span');
    piece.className = `confetti-piece c${i % 4}`;
    piece.style.setProperty('--x', `${Math.round((Math.random() * 2 - 1) * 220)}px`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.setProperty('--delay', `${(Math.random() * 0.25).toFixed(2)}s`);
    piece.style.setProperty('--left', `${Math.round(5 + Math.random() * 90)}%`);
    burst.appendChild(piece);
  }
  document.body.appendChild(burst);
  window.setTimeout(() => burst.remove(), 1900);
}

function showVerdict(): void {
  if (state.daily) {
    showDailyVerdict();
    return;
  }
  const yourBat = playerById(state.yourBatId)!;
  const rivalBat = playerById(state.rivalBatId)!;
  const inn1 = state.inn1!;
  const result = eng.matchResult(inn1.runs, state.runs);
  const notes = recordFinishedMatch(result === 'defended', result === 'tied', inn1.runs, inn1.balls);
  const allBalls = [...inn1.balls, ...state.balls];
  const boundaries = allBalls.filter(
    (b) => b.outcome.kind === 'runs' && (b.outcome.runs === 4 || b.outcome.runs === 6),
  ).length;

  // Gauntlet bookkeeping: score the series, then either tease the next
  // rivals or crown the whole thing.
  let seriesHtml = '';
  let gauntletConquered = false;
  let actionsHtml = `
    <button class="btn primary" data-action="play-again">🔁 Play Again</button>
    <button class="btn" data-action="copy-result">${SHARE_RESULT_LABEL}</button>
    <button class="btn" data-action="change-setup">⚙ Change setup</button>`;
  if (state.series) {
    const s = state.series;
    if (result === 'defended') s.wins += 1;
    else if (result === 'chased') s.losses += 1;
    else s.ties += 1;
    const scoreline = `${s.wins}–${s.losses}${s.ties ? `–${s.ties}` : ''}`;
    const over = s.wins === 2 || s.losses === 2 || s.matchNumber >= 3;
    if (over) {
      const conquered = s.wins > s.losses;
      const drawn = s.wins === s.losses;
      gauntletConquered = conquered;
      if (conquered) {
        store.data.career.gauntletsWon += 1;
        store.save();
        notes.push('🏆 Gauntlet conquered — rising rivals, and you outlasted them all.');
      }
      seriesHtml = `<p class="series-verdict">${
        conquered ? '🏆 GAUNTLET CONQUERED' : drawn ? '🤝 Gauntlet shared' : '📕 Gauntlet lost'
      } — series ${scoreline}</p>`;
      actionsHtml = `
        <button class="btn primary" data-action="new-gauntlet">🔁 New Gauntlet</button>
        <button class="btn" data-action="copy-result">${SHARE_RESULT_LABEL}</button>
        <button class="btn" data-action="change-setup">⚙ Change setup</button>`;
      state.series = null;
    } else {
      const next = gauntletRivals(s.matchNumber + 1);
      state.nextRivalBatId = next.bat.id;
      state.nextRivalBowlId = next.bowl.id;
      seriesHtml = `
        <p class="series-verdict">Series: You ${scoreline} after match ${s.matchNumber} of 3</p>
        <p class="series-next">Next up: <strong>${esc(next.bat.name)}</strong> with <strong>${esc(next.bowl.name)}</strong> —
          ${s.matchNumber + 1 >= 3 ? 'the bosses arrive.' : 'the rivals send for reinforcements.'}</p>`;
      actionsHtml = `
        <button class="btn primary" data-action="next-match">▶ Next match</button>
        <button class="btn" data-action="copy-result">${SHARE_RESULT_LABEL}</button>`;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="verdict" role="alertdialog" aria-modal="true" aria-labelledby="verdict-heading" tabindex="-1">
      <h2 id="verdict-heading">Stumps!</h2>
      <p class="verdict-line">Your XI (${esc(yourBat.name)}) <strong>${inn1.runs}/${inn1.wickets}</strong> off ${inn1.balls.length} ·
        Rival XI (${esc(rivalBat.name)}) <strong>${state.runs}/${state.wickets}</strong> off ${state.balls.length}</p>
      <p class="verdict-winner">${esc(matchWinnerLine())}</p>
      ${seriesHtml}
      <p class="verdict-detail">${boundaries} boundar${boundaries === 1 ? 'y' : 'ies'} · book: “${esc(state.spellBookTitle)}”</p>
      <p class="verdict-flavor">${esc(verdictFlavor(result))}</p>
      ${recordNotesHtml(notes)}
      ${luckReportHtml()}
      ${dailyNudgeHtml()}
      ${state.mode === 'stats' ? '<p class="disclaimer">Simulated for fun — not a factual prediction.</p>' : ''}
      <div class="verdict-actions">${actionsHtml}</div>
    </div>`;
  app.appendChild(overlay);
  overlay.querySelector<HTMLDivElement>('.verdict')?.focus();

  if (state.voiceOn) {
    const outcome = result === 'defended' ? 'win' : result === 'chased' ? 'loss' : 'tie';
    playMomentVoice(resolveMatchMoment(outcome, wentTheDistance(), gauntletConquered), state.commentatorId);
  }
  if (result === 'defended') celebrate();
}

/** The daily verdict: one attempt, so no replay — share it or come back tomorrow. */
function showDailyVerdict(): void {
  const ch = state.daily!;
  const inn1 = state.inn1!;
  const result = eng.matchResult(inn1.runs, state.runs);
  const won = result === 'chased';
  const tied = result === 'tied';
  const outcome: DailyOutcome = {
    won,
    tied,
    runs: state.runs,
    wickets: state.wickets,
    target: ch.target,
    tokens: ballTokens(state.balls),
  };
  completeDailyAttempt(store.data, ch.dayKey, outcome);
  const notes = recordFinishedMatch(won, tied, state.runs, state.balls);
  const d = store.data.daily;

  const spare = eng.SPELL.maxBalls - state.balls.length;
  const short = ch.target - state.runs;
  const winnerLine = won
    ? `🏆 Chased it! ${esc(ch.yourBat.shortName)} gets you home${spare > 0 ? ` with ${spare} ball${spare === 1 ? '' : 's'} to spare` : ' off the very last ball'}.`
    : tied
      ? '🤝 Tied with the book. Nobody sleeps tonight.'
      : `📕 ${short} short. The book wins today.${short <= 2 ? ' Agonising.' : ''}`;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="verdict" role="alertdialog" aria-modal="true" aria-labelledby="verdict-heading" tabindex="-1">
      <h2 id="verdict-heading">Daily #${ch.number} — Stumps!</h2>
      <p class="verdict-line">${esc(ch.rivalBat.name)} set <strong>${inn1.runs}/${inn1.wickets}</strong> ·
        ${esc(ch.yourBat.name)} <strong>${state.runs}/${state.wickets}</strong> off ${state.balls.length}</p>
      <p class="verdict-winner">${winnerLine}</p>
      <p class="daily-grid" aria-label="Ball by ball result">${emojiGrid(outcome.tokens)}</p>
      ${d.streak > 1 ? `<p class="streak-line">🔥 ${d.streak}-day streak · best ${d.bestStreak}</p>` : ''}
      ${recordNotesHtml(notes)}
      ${luckReportHtml()}
      <p class="hint">One attempt a day — new pages at midnight.</p>
      <p class="disclaimer">Simulated for fun — not a factual prediction.</p>
      <div class="verdict-actions">
        <button class="btn primary" data-action="copy-daily">${SHARE_DAILY_LABEL}</button>
        <button class="btn" data-action="go-home">🏠 Back to the pavilion</button>
      </div>
    </div>`;
  app.appendChild(overlay);
  overlay.querySelector<HTMLDivElement>('.verdict')?.focus();

  if (state.voiceOn) {
    const outcome = won ? 'win' : tied ? 'tie' : 'loss';
    playMomentVoice(resolveMatchMoment(outcome, wentTheDistance()), state.commentatorId);
  }
  if (won) celebrate();
}

// ---------- ball flow ----------

function flipDuration(): number {
  return state.reduceMotion ? 0 : 550;
}

function playBall(): void {
  if (state.busy || state.spellOver) return;
  state.busy = true;
  const btn = document.querySelector<HTMLButtonElement>('#flip-btn')!;
  btn.disabled = true;
  if (state.soundOn) playFlip();

  const intent = currentIntent();
  let ball: Ball;
  let probsUsed: Probabilities;
  if (state.mode === 'classic') {
    probsUsed = eng.classicProbabilities(state.pageCount, intent.powerPlay);
    ball = eng.drawClassic(state.pageCount, Math.random, intent.powerPlay);
  } else {
    probsUsed = probsForBall(state.balls.length);
    state.probs = probsUsed;
    ball = eng.drawStats(probsUsed, state.pageCount);
  }
  if (intent.stance !== 'normal') ball.stance = intent.stance;
  if (intent.powerPlay) ball.doubled = true;

  const card = document.querySelector<HTMLDivElement>('#flip-card')!;
  card.classList.remove('flipping');
  void card.offsetWidth; // restart animation
  if (!state.reduceMotion) card.classList.add('flipping');

  window.setTimeout(() => revealBall(ball, probsUsed), flipDuration());
}

function revealBall(ball: Ball, probsUsed: Probabilities): void {
  const { bat, bowl } = currentPair();
  const doubler = ball.doubled ? 2 : 1;
  state.balls.push(ball);
  state.luck.push({
    expected: eng.expectedRuns(probsUsed) * doubler,
    chance: eng.outcomeChance(probsUsed, ball.outcome),
  });
  if (ball.outcome.kind === 'wicket') {
    state.wickets += 1;
    state.consecutiveSixes = 0;
  } else {
    state.runs += ball.outcome.runs * doubler;
    state.consecutiveSixes = ball.outcome.runs === 6 ? state.consecutiveSixes + 1 : 0;
  }
  if (ball.doubled) {
    state.ppUsed = true;
    state.ppArmed = false;
  }
  // a power-play ball swings the momentum harder — the whole bench felt that
  const shift = Math.round(eng.momentumShift(ball.outcome) * (ball.doubled ? 1.4 : 1));
  state.momentum = Math.max(-100, Math.min(100, state.momentum + shift));
  const chased = state.innings === 2 && state.target !== null && state.runs >= state.target;
  state.spellOver =
    chased || state.balls.length >= eng.SPELL.maxBalls || state.wickets >= eng.SPELL.maxWickets;

  document.querySelector('#page-face')!.innerHTML =
    `<span class="page-num">p. ${ball.page}</span><span class="page-digit">last digit ${ball.digit}</span>`;

  const badge = document.querySelector<HTMLDivElement>('#outcome-badge')!;
  const isWicket = ball.outcome.kind === 'wicket';
  const scored = ball.outcome.kind === 'runs' ? ball.outcome.runs * doubler : 0;
  badge.textContent = isWicket
    ? `OUT!${ball.doubled ? ' ⚡' : ''}`
    : `${scored} run${scored > 1 ? 's' : ''}${ball.doubled ? ' ⚡' : ''}`;
  badge.className = `outcome-badge show ${isWicket ? 'wicket' : ball.outcome.kind === 'runs' && ball.outcome.runs >= 4 ? 'boundary' : 'runs'}${ball.doubled ? ' power' : ''}`;

  if (state.soundOn) {
    if (isWicket) playWicket();
    else if (ball.outcome.kind === 'runs' && ball.outcome.runs >= 4) playBoundary(ball.outcome.runs === 6);
    else playRuns();
  }

  const flavor = { doubled: ball.doubled, attacking: ball.stance === 'attack' };
  const comm = document.querySelector<HTMLParagraphElement>('#commentary')!;
  comm.textContent = commentaryFor(
    ball.outcome,
    state.consecutiveSixes,
    { batsman: bat.shortName, bowler: bowl.shortName, page: ball.page },
    flavor,
  );
  comm.classList.remove('pop');
  void comm.offsetWidth;
  comm.classList.add('pop');

  if (state.voiceOn) {
    const moment = resolveBallMoment(ball.outcome, state.consecutiveSixes, flavor);
    // A plain six occasionally gets just the batsman's name shouted instead
    // of a full line — that's how real commentary actually sounds on a big
    // hit ("SEHWAG!!"). A wicket never does this: real commentary always
    // signals the dismissal itself ("OUT!", "Gone!", "Bowled!") — a bare
    // bowler's name with no other word doesn't read as a wicket at all, it
    // just sounds like a name got mentioned. Wickets always get a full
    // reaction line from resolveBallMoment's pool instead.
    if (moment === 'six' && Math.random() < 0.35) playNameCallout(bat.id, state.commentatorId);
    else if (moment) playMomentVoice(moment, state.commentatorId);
  }

  document.querySelector('#score-line')!.textContent = `${state.runs}/${state.wickets}`;
  let ballsText = `${state.balls.length} of ${eng.SPELL.maxBalls} balls`;
  if (state.innings === 2 && state.target !== null) {
    const need = state.target - state.runs;
    if (need <= 0) ballsText += ' · target chased!';
    else if (!state.spellOver) ballsText += ` · needs ${need} off ${eng.SPELL.maxBalls - state.balls.length}`;
  }
  document.querySelector('#balls-line')!.textContent = ballsText;
  document.querySelector<HTMLDivElement>('#mom-marker')!.style.left =
    `${(state.momentum + 100) / 2}%`;

  const m = state.momentum;
  const momStatus = document.querySelector<HTMLParagraphElement>('#mom-status')!;
  momStatus.textContent =
    m <= -60 ? `${bowl.shortName} is running riot`
    : m <= -20 ? `${bowl.shortName} has the upper hand`
    : m >= 60 ? `${bat.shortName} is in complete command`
    : m >= 20 ? `${bat.shortName} has the momentum`
    : 'Evenly poised';
  momStatus.className = `mom-status ${m <= -20 ? 'bowl' : m >= 20 ? 'bat' : ''}`;

  const chip = document.createElement('span');
  chip.className = `chip ${isWicket ? 'wicket' : ball.outcome.kind === 'runs' && ball.outcome.runs >= 4 ? 'boundary' : ''}${ball.doubled ? ' power' : ''}`;
  chip.textContent = isWicket ? 'W' : String(scored);
  document.querySelector('#ball-log')!.appendChild(chip);

  if (state.mode === 'stats' && !state.spellOver) {
    // show the odds for the NEXT ball, honouring the current stance/gamble
    state.probs = probsForBall(state.balls.length);
  }
  if (state.mode === 'stats') {
    const oddsBodyEl = document.querySelector('#odds-body');
    if (oddsBodyEl) oddsBodyEl.innerHTML = oddsBody();
  }
  refreshControls();

  state.busy = false;
  const btn = document.querySelector<HTMLButtonElement>('#flip-btn')!;
  if (state.spellOver) {
    btn.textContent = state.innings === 1 ? '🏁 Innings over' : '🏁 Match over';
    window.setTimeout(state.innings === 1 ? showInningsBreak : showVerdict, state.reduceMotion ? 0 : 900);
  } else {
    btn.disabled = false;
  }
}

/** Targeted control updates between balls — no re-render, keep the animations alive. */
function refreshControls(): void {
  for (const s of ['defend', 'normal', 'attack'] as const) {
    const b = document.querySelector<HTMLButtonElement>(`[data-action="stance-${s}"]`);
    if (b) {
      b.classList.toggle('active', state.stance === s);
      b.setAttribute('aria-pressed', String(state.stance === s));
    }
  }
  const hint = document.querySelector('#stance-hint');
  if (hint) hint.textContent = STANCE_META[state.stance].hint;
  const pp = document.querySelector<HTMLButtonElement>('#pp-btn');
  if (pp) {
    pp.textContent = ppLabel();
    pp.disabled = state.ppUsed;
    pp.classList.toggle('armed', state.ppArmed);
    pp.setAttribute('aria-pressed', String(state.ppArmed));
  }
  const ppH = document.querySelector('#pp-hint');
  if (ppH) ppH.textContent = ppHint();
  const ai = document.querySelector('#ai-intent');
  if (ai) ai.textContent = aiIntentText();
  const flip = document.querySelector<HTMLButtonElement>('#flip-btn');
  if (flip && !state.spellOver) {
    flip.textContent = flipLabel();
    flip.classList.toggle('armed', state.ppArmed && playerBatting());
  }
}

// ---------- actions ----------

function startSpell(): void {
  if (state.mode === 'classic') {
    if (state.classicBookMode === 'random') {
      state.pageCount = state.classicRandomBook.pages;
      state.spellBookTitle = state.classicRandomBook.title;
    } else {
      const v = eng.validatePageCount(state.pagesRaw);
      if (!v.ok) return;
      state.pageCount = v.pages;
      state.spellBookTitle = state.bookTitle.trim() || 'A Battered Library Book';
    }
    state.yourBatId = state.classicBatId;
    state.yourBowlId = state.classicBowlId;
    state.rivalBatId = state.classicRivalBatId;
    state.rivalBowlId = state.classicRivalBowlId;
  } else {
    if (!state.batsmanId || !state.bowlerId) return;
    state.yourBatId = state.batsmanId;
    state.yourBowlId = state.bowlerId;
    state.rivalBatId = state.statsRivalBatId;
    state.rivalBowlId = state.statsRivalBowlId;
    state.pageCount = eng.VIRTUAL_BOOK.pages;
    state.spellBookTitle = eng.VIRTUAL_BOOK.title;
  }
  // Gauntlet: start a fresh series on the first match; keep it running between matches
  if (state.mode === 'stats' && state.gauntletOn) {
    if (!state.series) state.series = { matchNumber: 1, wins: 0, losses: 0, ties: 0 };
  } else {
    state.series = null;
  }
  state.innings = 1;
  state.target = null;
  state.inn1 = null;
  state.balls = [];
  state.luck = [];
  state.runs = 0;
  state.wickets = 0;
  state.momentum = 0;
  state.consecutiveSixes = 0;
  state.spellOver = false;
  state.busy = false;
  state.stance = 'normal';
  state.ppArmed = false;
  state.ppUsed = false;
  state.probs = state.mode === 'stats' ? probsForBall(0) : null;
  state.phase = 'play';
  render();
  document.querySelector<HTMLButtonElement>('#flip-btn')?.focus();
}

/**
 * Draws the rival pair for the next Gauntlet match. The bar rises with the
 * match number: anyone → the top half by rating → the top quarter.
 */
function gauntletRivals(matchNumber: number): { bat: Player; bowl: Player } {
  const exclude = [state.yourBatId, state.yourBowlId];
  const fraction = matchNumber >= 3 ? 0.25 : matchNumber === 2 ? 0.5 : 1;
  const tier = <T extends Player>(pool: T[], rating: (p: T) => number): T[] => {
    const sorted = [...pool].sort((a, b) => rating(b) - rating(a));
    return sorted.slice(0, Math.max(1, Math.ceil(sorted.length * fraction)));
  };
  const batPool = tier(
    batsmen().filter((p) => !exclude.includes(p.id)),
    (p) => eng.batsmanRating(p.batting!),
  );
  const bat = randomFrom(batPool);
  const bowlPool = tier(
    bowlers().filter((p) => !exclude.includes(p.id) && p.id !== bat.id),
    (p) => eng.bowlerRating(p.bowling!),
  );
  return { bat, bowl: randomFrom(bowlPool) };
}

/** One attempt per day, marked as taken the moment the chase begins. */
function startDaily(): void {
  const key = localDayKey();
  if (store.data.daily.today?.dayKey === key) return;
  document.querySelector('.overlay')?.remove();
  const ch = generateDaily(key);
  beginDailyAttempt(store.data, key);
  store.save();

  state.daily = ch;
  state.mode = 'stats'; // the daily runs on stats-mode odds
  state.yourBatId = ch.yourBat.id;
  state.yourBowlId = ch.yourBowl.id;
  state.rivalBatId = ch.rivalBat.id;
  state.rivalBowlId = ch.rivalBowl.id;
  state.pageCount = ch.book.pages;
  state.spellBookTitle = ch.book.title;
  state.innings = 2;
  state.target = ch.target;
  state.inn1 = {
    runs: ch.inn1.runs,
    wickets: ch.inn1.wickets,
    balls: ch.inn1.balls,
    luck: ch.inn1.luck,
  };
  state.balls = [];
  state.luck = [];
  state.runs = 0;
  state.wickets = 0;
  state.momentum = 0;
  state.consecutiveSixes = 0;
  state.spellOver = false;
  state.busy = false;
  state.stance = 'normal';
  state.ppArmed = false;
  state.ppUsed = false;
  state.series = null;
  state.probs = probsForBall(0);
  state.phase = 'play';
  render();
  document.querySelector<HTMLButtonElement>('#flip-btn')?.focus();
}

/** Rebuilds today's share text from the stored result — works from home or verdict. */
function dailyShareFromStore(): string | null {
  const today = store.data.daily.today;
  if (!today?.result) return null;
  return dailyShareText(generateDaily(today.dayKey), today.result, store.data.daily.streak);
}

function shareText(): string {
  const yourBat = playerById(state.yourBatId)!;
  const rivalBat = playerById(state.rivalBatId)!;
  const inn1 = state.inn1!;
  const progression = (balls: Ball[]) => ballTokens(balls).join(' ');
  const lines = [
    '🏏 Book Cricket Time Machine — match result',
    `${state.mode === 'classic' ? 'Classic' : 'Stats'} mode · “${state.spellBookTitle}” · ${state.pageCount} pages`,
    `Your XI (${yourBat.name}): ${inn1.runs}/${inn1.wickets} off ${inn1.balls.length} — ${progression(inn1.balls)}`,
    `Rival XI (${rivalBat.name}): ${state.runs}/${state.wickets} off ${state.balls.length} — ${progression(state.balls)}`,
    matchWinnerLine(),
  ];
  if (state.mode === 'stats') lines.push('(Simulated for fun — not a prediction.)');
  return lines.join('\n');
}

/** Detected once — availability doesn't change mid-session. */
const CAN_SHARE = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
const SHARE_RESULT_LABEL = CAN_SHARE ? '📤 Share result' : '📋 Copy result';
const SHARE_DAILY_LABEL = CAN_SHARE ? '📤 Share today’s grid' : '📋 Share today’s grid';

function copyToClipboard(btn: HTMLButtonElement, text: string): void {
  const idle = btn.textContent ?? '';
  const restore = () => window.setTimeout(() => { btn.textContent = idle; }, 2000);
  if (!navigator.clipboard) {
    btn.textContent = '✗ Clipboard unavailable';
    restore();
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => { btn.textContent = '✓ Copied!'; restore(); },
    () => { btn.textContent = '✗ Copy failed'; restore(); },
  );
}

/**
 * Native share sheet on mobile (one tap into WhatsApp, Messages, etc.);
 * clipboard copy everywhere else, or if the user's device rejects the
 * share for a reason other than cancelling.
 */
function shareOrCopy(btn: HTMLButtonElement, text: string): void {
  if (CAN_SHARE) {
    navigator.share({ text }).catch((err: unknown) => {
      const cancelled = err instanceof Error && err.name === 'AbortError';
      if (!cancelled) copyToClipboard(btn, text);
    });
    return;
  }
  copyToClipboard(btn, text);
}

/**
 * Full local factory reset: career, daily history, prefs, and any cached
 * offline assets. Confirmed via the browser's native dialog since this is
 * destructive and unrecoverable — no custom modal, to match how the rest
 * of this vanilla app avoids one-off UI machinery for a single decision.
 */
function resetAllData(): void {
  const ok = window.confirm(
    'Reset all local data? This clears your scorebook, streaks, daily history and preferences — and can’t be undone.',
  );
  if (!ok) return;
  store.resetToDefaults();
  const clearCachesAndReload = () => window.location.reload();
  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .finally(clearCachesAndReload);
  } else {
    clearCachesAndReload();
  }
}

function handleClick(e: Event): void {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const action = target.dataset.action!;
  switch (action) {
    case 'mode-classic':
      if (state.mode !== 'classic') { state = freshSetup('classic'); render(); }
      break;
    case 'mode-stats':
      if (state.mode !== 'stats') { state = freshSetup('stats'); render(); }
      break;
    case 'reroll': {
      const yourBat = drawPlayer(batsmen(), []);
      const yourBowl = drawPlayer(bowlers(), [yourBat.id]);
      const rivalBat = drawPlayer(batsmen(), [yourBat.id, yourBowl.id]);
      const rivalBowl = drawPlayer(bowlers(), [yourBat.id, yourBowl.id, rivalBat.id]);
      state.classicBatId = yourBat.id;
      state.classicBowlId = yourBowl.id;
      state.classicRivalBatId = rivalBat.id;
      state.classicRivalBowlId = rivalBowl.id;
      render();
      break;
    }
    case 'reroll-rival': {
      const exclude = [state.batsmanId, state.bowlerId].filter((x): x is string => x !== null);
      const rivalBat = drawPlayer(batsmen(), exclude);
      const rivalBowl = drawPlayer(bowlers(), [...exclude, rivalBat.id]);
      state.statsRivalBatId = rivalBat.id;
      state.statsRivalBowlId = rivalBowl.id;
      render();
      break;
    }
    case 'book-mode-random':
      state.classicBookMode = 'random';
      render();
      break;
    case 'book-mode-manual':
      state.classicBookMode = 'manual';
      render();
      break;
    case 'reroll-book':
      state.classicRandomBook = pickRandomBook();
      render();
      break;
    case 'pick-batsman':
      state.batsmanId = target.dataset.id!;
      if (state.batsmanId === state.statsRivalBatId) {
        state.statsRivalBatId = drawPlayer(batsmen(), [state.batsmanId, state.statsRivalBowlId]).id;
      }
      render();
      break;
    case 'pick-bowler':
      state.bowlerId = target.dataset.id!;
      if (state.bowlerId === state.statsRivalBowlId) {
        state.statsRivalBowlId = drawPlayer(bowlers(), [state.bowlerId, state.statsRivalBatId]).id;
      }
      render();
      break;
    case 'start':
      startSpell();
      break;
    case 'flip':
      playBall();
      break;
    case 'start-chase':
      startChase();
      break;
    case 'copy-result':
      shareOrCopy(target as HTMLButtonElement, shareText());
      break;
    case 'copy-daily': {
      const text = dailyShareFromStore();
      if (text) shareOrCopy(target as HTMLButtonElement, text);
      break;
    }
    case 'play-again':
      document.querySelector('.overlay')?.remove();
      startSpell();
      break;
    case 'change-setup':
      document.querySelector('.overlay')?.remove();
      state.series = null; // leaving mid-series abandons the gauntlet
      state.phase = 'setup';
      render();
      break;
    case 'stance-defend':
    case 'stance-normal':
    case 'stance-attack':
      state.stance = action.slice('stance-'.length) as Stance;
      refreshControls();
      refreshOddsPanel();
      break;
    case 'toggle-powerplay':
      if (state.ppUsed || !playerBatting()) break;
      state.ppArmed = !state.ppArmed;
      refreshControls();
      refreshOddsPanel();
      break;
    case 'next-match':
      document.querySelector('.overlay')?.remove();
      if (state.series) {
        state.series.matchNumber += 1;
        state.statsRivalBatId = state.nextRivalBatId;
        state.statsRivalBowlId = state.nextRivalBowlId;
      }
      startSpell();
      break;
    case 'new-gauntlet':
      document.querySelector('.overlay')?.remove();
      state.series = null;
      startSpell();
      break;
    case 'go-home': {
      const wasHome = state.phase === 'home';
      state = freshSetup('classic');
      state.phase = 'home';
      if (!wasHome) render();
      break;
    }
    case 'nav-classic':
      state = freshSetup('classic');
      render();
      break;
    case 'nav-stats':
      state = freshSetup('stats');
      render();
      break;
    case 'nav-daily':
      startDaily();
      break;
    case 'reset-data':
      resetAllData();
      break;
  }
}

function handleTabKeydown(e: KeyboardEvent): void {
  const target = (e.target as HTMLElement).closest<HTMLElement>('.mode-btn');
  if (!target || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  e.preventDefault();
  const nextMode: Mode = target.dataset.action === 'mode-classic' ? 'stats' : 'classic';
  if (state.mode !== nextMode) {
    state = freshSetup(nextMode);
    render();
  }
  document.querySelector<HTMLElement>(`.mode-btn[data-action="mode-${nextMode}"]`)?.focus();
}

function handleInput(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.id === 'commentator-select') {
    state.commentatorId = t.value;
    store.data.prefs.commentatorId = t.value;
    store.save();
    return;
  }
  if (t.id === 'book-title') {
    state.bookTitle = t.value; // no re-render: don't steal focus
    refreshStartButton();
  } else if (t.id === 'pages') {
    state.pagesRaw = t.value;
    refreshStartButton();
    refreshPagesError();
  } else if (t.id === 'era-adjust') {
    state.eraAdjust = t.checked;
    render();
  } else if (t.id === 'gauntlet') {
    state.gauntletOn = t.checked;
    render();
  } else if (t.id === 'reduce-motion') {
    state.reduceMotion = t.checked;
    document.body.classList.toggle('no-anim', state.reduceMotion);
  } else if (t.id === 'sound-toggle') {
    state.soundOn = t.checked;
    store.data.prefs.soundOn = t.checked;
    store.save();
  } else if (t.id === 'voice-toggle') {
    state.voiceOn = t.checked;
    store.data.prefs.voiceOn = t.checked;
    store.save();
    const picker = document.querySelector<HTMLSelectElement>('#commentator-select');
    if (picker) picker.disabled = !t.checked;
    document.querySelector('.commentator-picker')?.classList.toggle('dimmed', !t.checked);
  }
}

/** Live odds refresh when the player changes intent between balls. */
function refreshOddsPanel(): void {
  if (state.mode !== 'stats' || state.phase !== 'play' || state.spellOver) return;
  state.probs = probsForBall(state.balls.length);
  const oddsBodyEl = document.querySelector('#odds-body');
  if (oddsBodyEl) oddsBodyEl.innerHTML = oddsBody();
}

function refreshStartButton(): void {
  const btn = document.querySelector<HTMLButtonElement>('.start');
  if (!btn) return;
  const check = state.pagesRaw.trim() === '' ? null : eng.validatePageCount(state.pagesRaw);
  btn.disabled =
    state.mode === 'classic'
      ? !(state.classicBookMode === 'random' || (check && check.ok))
      : !(state.batsmanId && state.bowlerId);
}

function refreshPagesError(): void {
  const existing = document.querySelector('.error');
  const check = state.pagesRaw.trim() === '' ? null : eng.validatePageCount(state.pagesRaw);
  const msg = check && !check.ok ? check.error : null;
  if (existing) existing.remove();
  if (msg) {
    const p = document.createElement('p');
    p.className = 'error';
    p.setAttribute('role', 'alert');
    p.textContent = msg;
    document.querySelector('#pages')!.closest('.field')!.after(p);
  }
}

// ---------- shell ----------

function commentatorPickerHtml(): string {
  const options = COMMENTATORS.map(
    (c) =>
      `<option value="${c.id}" ${state.commentatorId === c.id ? 'selected' : ''}>${c.emoji} ${esc(c.label)}</option>`,
  ).join('');
  const active = COMMENTATORS.find((c) => c.id === state.commentatorId) ?? COMMENTATORS[0];
  // Always rendered (never conditionally omitted) so toggling voice on/off
  // can be a targeted DOM patch rather than a full re-render — a full
  // render() mid-match would wipe the incrementally-built ball log.
  return `
    <label class="motion-toggle commentator-picker ${state.voiceOn ? '' : 'dimmed'}" title="${esc(active.tagline)}">
      Commentator
      <select id="commentator-select" aria-label="Commentator persona" ${state.voiceOn ? '' : 'disabled'}>${options}</select>
    </label>`;
}

function render(): void {
  document.querySelector('.overlay')?.remove();
  const screen =
    state.phase === 'home' ? homeHtml() : state.phase === 'setup' ? setupHtml() : playHtml();
  app.innerHTML = `
    <header class="header">
      <div class="masthead">
        <h1><button class="mast-link" data-action="go-home" aria-label="Back to the pavilion">Book Cricket <span class="tm">Time Machine</span></button></h1>
        <p class="tagline">The schoolyard classic · live simulated coverage</p>
      </div>
      <div class="header-toggles">
        <label class="motion-toggle"><input type="checkbox" id="reduce-motion" ${state.reduceMotion ? 'checked' : ''}/> Reduce animations</label>
        <label class="motion-toggle"><input type="checkbox" id="sound-toggle" ${state.soundOn ? 'checked' : ''}/> Sound effects</label>
        <label class="motion-toggle"><input type="checkbox" id="voice-toggle" ${state.voiceOn ? 'checked' : ''}/> Commentary voice</label>
        ${commentatorPickerHtml()}
      </div>
    </header>
    <main id="screen">${screen}</main>
    <footer class="footer">A nostalgic side project · plays entirely in your browser · your scorebook lives only on this device — no accounts, no tracking${state.mode === 'stats' ? ' · stats mode is a for-fun sim, not a prediction' : ''} · <button class="footer-reset" data-action="reset-data">Reset data</button></footer>
  `;
}

app.addEventListener('click', handleClick);
app.addEventListener('input', handleInput);
app.addEventListener('keydown', handleTabKeydown);
document.body.classList.toggle('no-anim', state.reduceMotion);
render();

// Keep the home screen honest about midnight: tick the countdown, and
// re-render if the day rolls over while the pavilion is on screen.
window.setInterval(() => {
  if (state.phase !== 'home') return;
  if (renderedDayKey !== localDayKey()) {
    render();
    return;
  }
  const el = document.querySelector('#daily-countdown');
  if (el) el.textContent = countdownText();
}, 30000);

// Installable + offline: register the hand-rolled service worker (public/sw.js).
// Silent no-op on browsers without support; failures never affect gameplay.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
