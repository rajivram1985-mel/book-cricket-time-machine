import './style.css';
import { batsmen, bowlers, ROSTER } from './roster';
import { avatarSvg } from './avatar';
import { commentaryFor, verdictFlavor } from './commentary';
import * as eng from './engine';
import type { Ball, Mode, Player, Probabilities } from './types';

interface State {
  mode: Mode;
  reduceMotion: boolean;
  phase: 'setup' | 'play';
  // setup — classic
  bookTitle: string;
  pagesRaw: string;
  classicBatId: string;
  classicBowlId: string;
  // setup — stats
  batsmanId: string | null;
  bowlerId: string | null;
  eraAdjust: boolean;
  eraApplied: boolean;
  // active spell
  pageCount: number;
  spellBookTitle: string;
  probs: Probabilities | null;
  balls: Ball[];
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

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function freshSetup(mode: Mode): State {
  return {
    mode,
    reduceMotion: state?.reduceMotion ?? prefersReducedMotion,
    phase: 'setup',
    bookTitle: '',
    pagesRaw: '',
    classicBatId: randomFrom(batsmen()).id,
    classicBowlId: randomFrom(bowlers()).id,
    batsmanId: null,
    bowlerId: null,
    eraAdjust: false,
    eraApplied: false,
    pageCount: 0,
    spellBookTitle: '',
    probs: null,
    balls: [],
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
    </button>`;
}

function luckyPick(p: Player, label: string): string {
  return `
    <div class="lucky-pick">
      ${avatarSvg(p, 44)}
      <div><span class="lp-label">${label}</span><span class="lp-name">${esc(p.name)}</span></div>
    </div>`;
}

function setupHtml(): string {
  const pagesCheck = state.pagesRaw.trim() === '' ? null : eng.validatePageCount(state.pagesRaw);
  const pagesError = pagesCheck && !pagesCheck.ok ? pagesCheck.error : null;

  const canStart =
    state.mode === 'classic'
      ? pagesCheck !== null && pagesCheck.ok
      : state.batsmanId !== null && state.bowlerId !== null;

  const bat = playerById(state.batsmanId);
  const bowl = playerById(state.bowlerId);
  const crossEra = bat && bowl ? !eng.erasOverlap(bat.era, bowl.era) : false;

  const classicPanel = `
    <section class="panel">
      <h2>📖 Pick your lucky book</h2>
      <label class="field">Book title
        <input id="book-title" type="text" placeholder="e.g. Wuthering Heights (the battered library copy)"
               value="${esc(state.bookTitle)}" autocomplete="off" />
      </label>
      <label class="field">Total pages
        <input id="pages" type="text" inputmode="numeric" placeholder="e.g. 314 (must be more than 20)"
               value="${esc(state.pagesRaw)}" autocomplete="off" />
      </label>
      ${pagesError ? `<p class="error" role="alert">${esc(pagesError)}</p>` : ''}
      <div class="lucky-row">
        ${luckyPick(playerById(state.classicBatId)!, 'Batting, for flavour')}
        <span class="vs">vs</span>
        ${luckyPick(playerById(state.classicBowlId)!, 'Bowling, for flavour')}
        <button class="btn small" data-action="reroll" title="Re-draw the flavour players">🎲 Reroll</button>
      </div>
      <p class="hint">Classic mode is pure page-flip luck — the players are just along for the ride.</p>
    </section>`;

  const statsPanel = `
    <section class="panel">
      <h2>🏏 Pick your matchup</h2>
      <h3>Batsman</h3>
      <div class="player-grid">${batsmen().map((p) => playerCard(p, 'batsman', state.batsmanId)).join('')}</div>
      <h3>Bowler</h3>
      <div class="player-grid">${bowlers().map((p) => playerCard(p, 'bowler', state.bowlerId)).join('')}</div>
      <label class="toggle-row" title="When the two players' careers never overlapped, nudge the wicket odds up — bridging eras is hard, even for legends.">
        <input type="checkbox" id="era-adjust" ${state.eraAdjust ? 'checked' : ''} />
        Era adjustment <span class="tooltip-hint">ⓘ</span>
      </label>
      ${
        state.eraAdjust
          ? `<p class="hint">When careers never overlapped, wicket probability is raised ~35% — time travel is disorienting.</p>`
          : ''
      }
      ${
        crossEra
          ? `<p class="hint cross-era">⏳ ${esc(bat!.shortName)} and ${esc(bowl!.shortName)} never shared an era${state.eraAdjust ? ' — adjustment will apply.' : '. Consider era adjustment!'}</p>`
          : ''
      }
      <p class="disclaimer">Stats mode is a playful simulation for fun — not a factual prediction.</p>
    </section>`;

  return `
    <div class="setup">
      <p class="intro">Flip virtual pages, schoolyard style: <strong>0 is out, 1–6 score runs, 7–9 sneak a single.</strong>
      Classic mode is pure book luck; Stats mode weights every ball by real careers.</p>
      <div class="mode-toggle" role="tablist">
        <button class="mode-btn ${state.mode === 'classic' ? 'active' : ''}" data-action="mode-classic" role="tab" aria-selected="${state.mode === 'classic'}" aria-controls="screen" tabindex="${state.mode === 'classic' ? '0' : '-1'}">📖 Classic</button>
        <button class="mode-btn ${state.mode === 'stats' ? 'active' : ''}" data-action="mode-stats" role="tab" aria-selected="${state.mode === 'stats'}" aria-controls="screen" tabindex="${state.mode === 'stats' ? '0' : '-1'}">📊 Stats</button>
      </div>
      ${state.mode === 'classic' ? classicPanel : statsPanel}
      <button class="btn primary start" data-action="start" ${canStart ? '' : 'disabled'}>▶ Start Spell</button>
      <p class="hint">A spell is ${eng.SPELL.maxBalls} balls — or ${eng.SPELL.maxWickets} wickets, whichever comes first.</p>
    </div>`;
}

// ---------- play screen ----------

function oddsPanel(): string {
  if (!state.probs) return '';
  const p = state.probs;
  const rows = ([1, 2, 3, 4, 5, 6] as const)
    .map((r) => `<tr><td>${r} run${r > 1 ? 's' : ''}</td><td>${pct(p.runs[r])}</td></tr>`)
    .join('');
  return `
    <details class="odds">
      <summary>🔍 How the odds work</summary>
      <p>Each ball is drawn from this distribution — batting average vs bowling average sets the wicket
      odds; strike rate, boundary habits and bowler economy shape the runs.${state.eraApplied ? ' Era adjustment applied: cross-era wicket odds ×1.35.' : ''}</p>
      <table><tr><td>Wicket</td><td>${pct(p.wicket)}</td></tr>${rows}</table>
    </details>`;
}

function playHtml(): string {
  const bat = playerById(state.batsmanId)!;
  const bowl = playerById(state.bowlerId)!;
  return `
    <div class="play">
      <div class="matchup">
        <div class="fighter">${avatarSvg(bat, 56)}<span>${esc(bat.shortName)}</span><em>bat</em></div>
        <div class="score">
          <div id="score-line" class="score-line">0/0</div>
          <div id="balls-line" class="balls-line">0 of ${eng.SPELL.maxBalls} balls</div>
        </div>
        <div class="fighter">${avatarSvg(bowl, 56)}<span>${esc(bowl.shortName)}</span><em>ball</em></div>
      </div>

      <div class="momentum">
        <span class="mom-label">${esc(bowl.shortName)}</span>
        <div class="mom-track"><div id="mom-marker" class="mom-marker" style="left:50%"></div></div>
        <span class="mom-label">${esc(bat.shortName)}</span>
      </div>

      <div class="book-area">
        <p class="book-title">“${esc(state.spellBookTitle)}” · ${state.pageCount} pages</p>
        <div id="flip-card" class="flip-card"><div class="flip-inner">
          <div id="page-face" class="page-face"><span class="page-num">?</span></div>
        </div></div>
        <div id="outcome-badge" class="outcome-badge"></div>
        <p id="commentary" class="commentary">The field is set. Flip when ready…</p>
      </div>

      <div id="ball-log" class="ball-log"></div>

      <button id="flip-btn" class="btn primary" data-action="flip">📖 Flip the page</button>
      ${state.mode === 'stats' ? oddsPanel() : ''}
      ${state.mode === 'stats' ? '<p class="disclaimer">Simulated for fun — not a factual prediction.</p>' : ''}
    </div>`;
}

// ---------- verdict ----------

function showVerdict(): void {
  const bat = playerById(state.batsmanId)!;
  const bowl = playerById(state.bowlerId)!;
  const winner = eng.decideWinner(state.runs, state.wickets);
  const winnerLine =
    winner === 'batsman'
      ? `🏆 ${esc(bat.name)} wins the duel!`
      : winner === 'bowler'
        ? `🏆 ${esc(bowl.name)} wins the duel!`
        : '🤝 Honours shared!';
  const boundaries = state.balls.filter(
    (b) => b.outcome.kind === 'runs' && (b.outcome.runs === 4 || b.outcome.runs === 6),
  ).length;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="verdict" role="alertdialog" aria-modal="true" aria-labelledby="verdict-heading" tabindex="-1">
      <h2 id="verdict-heading">Stumps!</h2>
      <p class="verdict-line">${esc(bat.name)} scores <strong>${state.runs}/${state.wickets}</strong>
        off ${state.balls.length} balls vs ${esc(bowl.name)}!</p>
      <p class="verdict-winner">${winnerLine}</p>
      <p class="verdict-detail">${boundaries} boundar${boundaries === 1 ? 'y' : 'ies'} · book: “${esc(state.spellBookTitle)}”</p>
      <p class="verdict-flavor">${esc(verdictFlavor(winner))}</p>
      ${state.mode === 'stats' ? '<p class="disclaimer">Simulated for fun — not a factual prediction.</p>' : ''}
      <div class="verdict-actions">
        <button class="btn primary" data-action="play-again">🔁 Play Again</button>
        <button class="btn" data-action="change-setup">⚙ Change setup</button>
      </div>
    </div>`;
  app.appendChild(overlay);
  overlay.querySelector<HTMLDivElement>('.verdict')?.focus();
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

  const ball: Ball =
    state.mode === 'classic'
      ? eng.drawClassic(state.pageCount)
      : eng.drawStats(state.probs!, state.pageCount);

  const card = document.querySelector<HTMLDivElement>('#flip-card')!;
  card.classList.remove('flipping');
  void card.offsetWidth; // restart animation
  if (!state.reduceMotion) card.classList.add('flipping');

  window.setTimeout(() => revealBall(ball), flipDuration());
}

function revealBall(ball: Ball): void {
  state.balls.push(ball);
  if (ball.outcome.kind === 'wicket') {
    state.wickets += 1;
    state.consecutiveSixes = 0;
  } else {
    state.runs += ball.outcome.runs;
    state.consecutiveSixes = ball.outcome.runs === 6 ? state.consecutiveSixes + 1 : 0;
  }
  state.momentum = Math.max(-100, Math.min(100, state.momentum + eng.momentumShift(ball.outcome)));
  state.spellOver =
    state.balls.length >= eng.SPELL.maxBalls || state.wickets >= eng.SPELL.maxWickets;

  document.querySelector('#page-face')!.innerHTML =
    `<span class="page-num">p. ${ball.page}</span><span class="page-digit">last digit ${ball.digit}</span>`;

  const badge = document.querySelector<HTMLDivElement>('#outcome-badge')!;
  const isWicket = ball.outcome.kind === 'wicket';
  badge.textContent = isWicket ? 'OUT!' : `${ball.outcome.kind === 'runs' ? ball.outcome.runs : 0} run${!isWicket && ball.outcome.kind === 'runs' && ball.outcome.runs > 1 ? 's' : ''}`;
  badge.className = `outcome-badge show ${isWicket ? 'wicket' : ball.outcome.kind === 'runs' && ball.outcome.runs >= 4 ? 'boundary' : 'runs'}`;

  const comm = document.querySelector<HTMLParagraphElement>('#commentary')!;
  comm.textContent = commentaryFor(ball.outcome, state.consecutiveSixes);
  comm.classList.remove('pop');
  void comm.offsetWidth;
  comm.classList.add('pop');

  document.querySelector('#score-line')!.textContent = `${state.runs}/${state.wickets}`;
  document.querySelector('#balls-line')!.textContent =
    `${state.balls.length} of ${eng.SPELL.maxBalls} balls`;
  document.querySelector<HTMLDivElement>('#mom-marker')!.style.left =
    `${(state.momentum + 100) / 2}%`;

  const chip = document.createElement('span');
  chip.className = `chip ${isWicket ? 'wicket' : ball.outcome.kind === 'runs' && ball.outcome.runs >= 4 ? 'boundary' : ''}`;
  chip.textContent = isWicket ? 'W' : String(ball.outcome.kind === 'runs' ? ball.outcome.runs : 0);
  document.querySelector('#ball-log')!.appendChild(chip);

  state.busy = false;
  const btn = document.querySelector<HTMLButtonElement>('#flip-btn')!;
  if (state.spellOver) {
    btn.textContent = '🏁 Spell complete';
    window.setTimeout(showVerdict, state.reduceMotion ? 0 : 900);
  } else {
    btn.disabled = false;
  }
}

// ---------- actions ----------

function startSpell(): void {
  if (state.mode === 'classic') {
    const v = eng.validatePageCount(state.pagesRaw);
    if (!v.ok) return;
    state.pageCount = v.pages;
    state.spellBookTitle = state.bookTitle.trim() || 'A Battered Library Book';
    state.batsmanId = state.classicBatId;
    state.bowlerId = state.classicBowlId;
    state.probs = null;
  } else {
    const bat = playerById(state.batsmanId);
    const bowl = playerById(state.bowlerId);
    if (!bat || !bowl) return;
    const crossEra = !eng.erasOverlap(bat.era, bowl.era);
    state.eraApplied = state.eraAdjust && crossEra;
    state.probs = eng.computeProbabilities(bat.batting!, bowl.bowling!, state.eraApplied);
    state.pageCount = eng.VIRTUAL_BOOK.pages;
    state.spellBookTitle = eng.VIRTUAL_BOOK.title;
  }
  state.balls = [];
  state.runs = 0;
  state.wickets = 0;
  state.momentum = 0;
  state.consecutiveSixes = 0;
  state.spellOver = false;
  state.busy = false;
  state.phase = 'play';
  render();
  document.querySelector<HTMLButtonElement>('#flip-btn')?.focus();
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
    case 'reroll':
      state.classicBatId = randomFrom(batsmen()).id;
      state.classicBowlId = randomFrom(bowlers()).id;
      render();
      break;
    case 'pick-batsman':
      state.batsmanId = target.dataset.id!;
      render();
      break;
    case 'pick-bowler':
      state.bowlerId = target.dataset.id!;
      render();
      break;
    case 'start':
      startSpell();
      break;
    case 'flip':
      playBall();
      break;
    case 'play-again':
      document.querySelector('.overlay')?.remove();
      startSpell();
      break;
    case 'change-setup':
      document.querySelector('.overlay')?.remove();
      state.phase = 'setup';
      render();
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
  } else if (t.id === 'reduce-motion') {
    state.reduceMotion = t.checked;
    document.body.classList.toggle('no-anim', state.reduceMotion);
  }
}

function refreshStartButton(): void {
  const btn = document.querySelector<HTMLButtonElement>('.start');
  if (!btn) return;
  const check = state.pagesRaw.trim() === '' ? null : eng.validatePageCount(state.pagesRaw);
  btn.disabled = state.mode === 'classic' ? !(check && check.ok) : !(state.batsmanId && state.bowlerId);
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

function render(): void {
  document.querySelector('.overlay')?.remove();
  app.innerHTML = `
    <header class="header">
      <label class="motion-toggle"><input type="checkbox" id="reduce-motion" ${state.reduceMotion ? 'checked' : ''}/> Reduce animations</label>
      <div class="masthead">
        <h1>Book Cricket <span class="tm">Time Machine</span></h1>
        <p class="tagline">The schoolyard classic · live simulated coverage</p>
      </div>
    </header>
    <main id="screen">${state.phase === 'setup' ? setupHtml() : playHtml()}</main>
    <footer class="footer">A nostalgic side project · entirely in your browser · nothing is stored${state.mode === 'stats' ? ' · stats mode is a for-fun sim, not a prediction' : ''}</footer>
  `;
}

app.addEventListener('click', handleClick);
app.addEventListener('input', handleInput);
app.addEventListener('keydown', handleTabKeydown);
document.body.classList.toggle('no-anim', state.reduceMotion);
render();
