/**
 * Script text for pre-generated commentary clips. Deliberately name-free —
 * dynamic names live in the on-screen commentary (`commentary.ts`); audio
 * adds excitement on top without needing per-name synthesis. This is the
 * single source of truth for `scripts/generate-voice-clips.ts` (array index
 * === clip filename) and for playback in `src/voice.ts` (pool size).
 * Only wickets, boundaries and milestones get a voice — see `resolveBallMoment`
 * in `src/voice.ts` for why singles, twos, threes and fives stay silent.
 */
export const MOMENT_LINES = {
  wicket: [
    'OUT! Timber! The stumps go cartwheeling!',
    'Gone! The book shows no mercy today!',
    'Caught! What a way to lose your wicket!',
    'Plumb in front! Up goes the finger!',
    'Bowled all ends up! Back to the pavilion!',
  ],
  four: [
    'FOUR! Cracked through the covers!',
    'Boundary! Timed to absolute perfection!',
    'Four more! Racing away to the fence!',
    'Glorious shot! No chance for the fielders!',
  ],
  six: [
    'SIX! That is out of the ground!',
    'MAXIMUM! Into the crowd it goes!',
    'Huge hit! That has gone miles!',
    'SIX! Absolutely middled, that one!',
    'Launched! That ball is not coming back!',
  ],
  sixStreak: [
    'ANOTHER SIX! This is carnage!',
    'UNSTOPPABLE! Sixes raining down!',
    'Incredible hitting! Somebody stop this innings!',
  ],
  powerHit: [
    'DOUBLE OR NOTHING PAYS OFF! Jackpot!',
    'The gamble lands! Everything doubled!',
    'RICHES! That bet just paid out in full!',
    'The power play delivers! Take a bow!',
  ],
  powerWicket: [
    'DISASTER! The gamble backfires completely!',
    'ALL IN, ALL OUT! What a way to go!',
    'The power play punishes greed! Gone!',
    'Bust! That double or nothing cost everything!',
  ],
  attackWicket: [
    'Too bold by half! Undone by his own ambition!',
    'Attacking, and out! Fortune favoured the bowler there!',
    'Swinging for glory, and paying the price!',
  ],
  matchWin: [
    'Victory! What a way to win it!',
    "That's the match! Wonderfully played!",
    'Job done! A famous win, that!',
  ],
  matchLoss: [
    'That is the match. The book had other ideas today.',
    'So close, yet so far. Credit to the winning side.',
    'Stumps. Not the result you wanted, but what a contest!',
  ],
  matchTie: [
    "A tie! You don't see that every day!",
    'Level scores! Honours shared, and rightly so!',
  ],
  clutchFinish: [
    'Down to the very last ball! Unbearable tension!',
    'This has gone the distance! What a finish we have here!',
  ],
  gauntletWin: [
    'GAUNTLET CONQUERED! Three matches, one champion!',
    'The Gauntlet falls! What a series that was!',
    'Series won! Every rival, conquered!',
  ],
} as const satisfies Record<string, readonly string[]>;

export type MomentCategory = keyof typeof MOMENT_LINES;
