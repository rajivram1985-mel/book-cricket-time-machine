import type { Outcome } from './types';
import type { MatchResult } from './engine';

export interface CommentaryContext {
  batsman: string;
  bowler: string;
  page: number;
}

/**
 * Phrase templates. `{batsman}`, `{bowler}` and `{page}` are filled in at
 * pick time so the commentary names the actual matchup — not every phrase
 * uses every placeholder, so generic lines still land.
 */
export const POOLS = {
  wicket: [
    'Timber! The page turns cruelly — {batsman} has to walk back.',
    'Gone! The book has spoken, and it shows {batsman} no mercy today.',
    'Cleaned him up! Even the librarian winced at that one from {bowler}.',
    'Caught! The story ends mid-sentence on page {page}.',
    'Plumb in front! The umpire’s finger goes up like a bookmark.',
    'Snaffled at slip! {bowler} closed that chapter in a hurry.',
  ],
  one: [
    'Nudged into the gap — {batsman} keeps things ticking with a quiet single.',
    'Soft hands, quick feet, one more to the tally.',
    'Worked off the pads for a comfortable single.',
    'A gentle push and a jog — the scoreboard shuffles along.',
    'Tip and run! Classic schoolyard stuff from {batsman}.',
  ],
  two: [
    'Driven wide of mid-on — they scamper back for two.',
    'Good running! Two more between the wickets.',
    'Placed into the pocket — {batsman} hustles a brace.',
    'Twinkling feet turn one into two. Smart cricket.',
  ],
  three: [
    'Threaded toward the fence — three hard-run!',
    'All the way to deep cover, and they sprint three.',
    'Lovely timing, tired legs — three runs to the good.',
    'That’s three! Someone in the deep did a lot of chasing.',
  ],
  four: [
    'Cracked through the covers — page {page} had a boundary written all over it!',
    'Four! {batsman} threads the field like a bookmark between chapters.',
    'Glorious! The ball races away and the momentum swings with it.',
    'Slashed past point — the fielder waves it goodbye. Four!',
    'Creamed down the ground by {batsman}. Textbook — literally.',
    'Boundary! The scorer needs a sharper pencil.',
  ],
  five: [
    'Five! Overthrows and chaos — the fielding side is in a flap.',
    'A wild ricochet and they run five! You don’t see that every day.',
    'Five runs! Somewhere, a scorer is double-checking the maths.',
  ],
  six: [
    'SIX! {batsman} sends it out of the schoolyard and into the neighbour’s garden!',
    'Maximum! {batsman} flips the script — and about forty pages with it.',
    'Launched! The ball won’t be back before the next chapter.',
    'Huge! Rows back — fetch that from the reference section!',
    'Six more! {bowler} stares at the pitch as if it owes him money.',
    'Into the stands! That one’s overdue at the library forever.',
  ],
  sixStreak: [
    'ANOTHER one! This is getting biblical — {bowler} wants a new book!',
    '{batsman} can’t stop hitting sixes! Somebody check this book for loaded pages!',
    'Carnage! Sixes raining like loose pages in a storm!',
  ],
  powerHit: [
    'DOUBLE OR NOTHING pays off! {batsman} banks twice the loot from page {page}!',
    'The gamble lands! Every run counts double and {bowler} knows it!',
    'Power play jackpot! The scorer writes it once and taps the pencil twice!',
    'Riches! {batsman} doubles down and the book pays out in full!',
  ],
  powerWicket: [
    'DISASTER! The double-or-nothing flip comes up empty — {batsman} gambled and lost!',
    'The power play backfires! {bowler} pockets the loudest wicket of the day!',
    'All in, all out! The bench goes silent — that’s the gamble, kids.',
    'The book punishes greed! {batsman} pushed his luck one page too far.',
  ],
  attackWicket: [
    'Live by the sword, die by the sword — {batsman} swung hard and paid for it!',
    'Too brave by half! The attacking stance opened the door and {bowler} kicked it in!',
    'Caught going for glory! Fortune favoured {bowler} this time.',
  ],
  earlyDuck: [
    'Gone early — but every great innings started with someone else’s first-ball nerves.',
    '{batsman} falls cheaply — the classic school-bench special. Happens to the best of them.',
    'Not even settled in! {bowler} strikes early, but the story’s just getting started.',
    'Early trouble for {batsman} — even legends have walked this road.',
  ],
} as const;

const DEFAULT_CTX: CommentaryContext = { batsman: 'The batsman', bowler: 'The bowler', page: 0 };

export function fillTemplate(template: string, ctx: CommentaryContext): string {
  return template
    .replace(/\{batsman\}/g, ctx.batsman)
    .replace(/\{bowler\}/g, ctx.bowler)
    .replace(/\{page\}/g, String(ctx.page));
}

let lastPhrase = '';

/** For tests. */
export function resetCommentary(): void {
  lastPhrase = '';
}

/** Non-repeat guard compares raw templates, so it holds across matchups. */
function pick(pool: readonly string[]): string {
  const options = pool.filter((p) => p !== lastPhrase);
  const phrase = options[Math.floor(Math.random() * options.length)];
  lastPhrase = phrase;
  return phrase;
}

export interface CommentaryFlavor {
  /** This ball was a power play (double or nothing). */
  doubled?: boolean;
  /** The batting side was in attack stance. */
  attacking?: boolean;
  /** A plain (unchosen) dismissal within the first 3 balls faced this innings. */
  earlyDuck?: boolean;
}

export function commentaryFor(
  outcome: Outcome,
  consecutiveSixes = 0,
  ctx: CommentaryContext = DEFAULT_CTX,
  flavor: CommentaryFlavor = {},
): string {
  if (flavor.doubled) {
    const pool = outcome.kind === 'wicket' ? POOLS.powerWicket : POOLS.powerHit;
    return fillTemplate(pick(pool), ctx);
  }
  if (outcome.kind === 'wicket') {
    // A chosen risk (attacking) already has its own more specific story;
    // earlyDuck is the sympathetic fallback for a plain early dismissal.
    const pool = flavor.attacking ? POOLS.attackWicket : flavor.earlyDuck ? POOLS.earlyDuck : POOLS.wicket;
    return fillTemplate(pick(pool), ctx);
  }
  if (outcome.runs === 6 && consecutiveSixes >= 3) return fillTemplate(pick(POOLS.sixStreak), ctx);
  const key = (['one', 'two', 'three', 'four', 'five', 'six'] as const)[outcome.runs - 1];
  return fillTemplate(pick(POOLS[key]), ctx);
}

const VERDICT_FLAVOR: Record<MatchResult, string[]> = {
  defended: [
    'The target proved a page too far — the chase falls short.',
    'Defended! The scorer underlines the total twice, with a flourish.',
    'The book slammed shut on the chase. Some totals are simply enough.',
  ],
  chased: [
    'Chased down! The rival turns the last page and finds a happy ending.',
    'Hunted down with pages to spare — the target never stood a chance.',
    'A chase for the ages. The scorebook gains a new dog-eared favourite.',
  ],
  tied: [
    'A tie! Two innings, one score — the book refuses to pick a favourite.',
    'Scores level! The scorer checks the additions three times. Still level.',
    'Dead heat. A rematch is morally compulsory.',
  ],
};

export function verdictFlavor(result: MatchResult): string {
  return pick(VERDICT_FLAVOR[result]);
}
