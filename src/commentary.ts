import type { Outcome } from './types';
import type { Winner } from './engine';

const POOLS = {
  wicket: [
    'Timber! The page turns cruelly — he’s got to walk back.',
    'Gone! The book has spoken, and it shows no mercy today.',
    'Cleaned him up! Even the librarian winced at that one.',
    'Caught! The story ends mid-sentence for our batsman.',
    'Plumb in front! The umpire’s finger goes up like a bookmark.',
    'Snaffled at slip! That chapter closed in a hurry.',
  ],
  one: [
    'Nudged into the gap — a quiet single to keep things ticking.',
    'Soft hands, quick feet, one more to the tally.',
    'Worked off the pads for a comfortable single.',
    'A gentle push and a jog — the scoreboard shuffles along.',
    'Tip and run! Classic schoolyard stuff.',
  ],
  two: [
    'Driven wide of mid-on — they scamper back for two.',
    'Good running! Two more between the wickets.',
    'Placed into the pocket and they hustle a brace.',
    'Twinkling feet turn one into two. Smart cricket.',
  ],
  three: [
    'Threaded toward the fence — three hard-run!',
    'All the way to deep cover, and they sprint three.',
    'Lovely timing, tired legs — three runs to the good.',
    'That’s three! Someone in the deep did a lot of chasing.',
  ],
  four: [
    'Cracked through the covers — that page had a boundary written all over it!',
    'Four! Threaded the field like a bookmark between chapters.',
    'Glorious! The ball races away and the momentum swings with it.',
    'Slashed past point — the fielder waves it goodbye. Four!',
    'Creamed down the ground. Textbook — literally.',
    'Boundary! The scorer needs a sharper pencil.',
  ],
  five: [
    'Five! Overthrows and chaos — the fielding side is in a flap.',
    'A wild ricochet and they run five! You don’t see that every day.',
    'Five runs! Somewhere, a scorer is double-checking the maths.',
  ],
  six: [
    'SIX! That’s out of the schoolyard and into the neighbour’s garden!',
    'Maximum! He’s flipped the script — and about forty pages with it.',
    'Launched! The ball won’t be back before the next chapter.',
    'Huge! Rows back — fetch that from the reference section!',
    'Six more! The bowler stares at the pitch as if it owes him money.',
    'Into the stands! That one’s overdue at the library forever.',
  ],
  sixStreak: [
    'ANOTHER one! This is getting biblical — the bowler wants a new book!',
    'He can’t stop hitting sixes! Somebody check this book for loaded pages!',
    'Carnage! Sixes raining like loose pages in a storm!',
  ],
} as const;

let lastPhrase = '';

/** For tests. */
export function resetCommentary(): void {
  lastPhrase = '';
}

function pick(pool: readonly string[]): string {
  const options = pool.filter((p) => p !== lastPhrase);
  const phrase = options[Math.floor(Math.random() * options.length)];
  lastPhrase = phrase;
  return phrase;
}

export function commentaryFor(outcome: Outcome, consecutiveSixes = 0): string {
  if (outcome.kind === 'wicket') return pick(POOLS.wicket);
  if (outcome.runs === 6 && consecutiveSixes >= 3) return pick(POOLS.sixStreak);
  const key = (['one', 'two', 'three', 'four', 'five', 'six'] as const)[outcome.runs - 1];
  return pick(POOLS[key]);
}

const VERDICT_FLAVOR: Record<Winner, string[]> = {
  batsman: [
    'The bowler trudges off muttering about the pitch, the ball, and the book.',
    'A masterclass! The pages simply fell his way today.',
    'Bat beats book. Somewhere, a schoolkid is grinning.',
  ],
  bowler: [
    'A ruthless spell — the batsman never read the plot twist coming.',
    'The book giveth, the bowler taketh away.',
    'Devastating stuff. That’s a spell to tell the grandkids about.',
  ],
  shared: [
    'Honours even — a page-turner that deserved a sequel.',
    'Nobody blinked. Rematch, anyone?',
    'A proper arm-wrestle. The book refuses to pick a favourite.',
  ],
};

export function verdictFlavor(winner: Winner): string {
  return pick(VERDICT_FLAVOR[winner]);
}
