# Book Cricket Time Machine

A browser game reviving the Indian schoolyard classic of **book cricket** — flip to a random
page, read the last digit, score the ball — fused with "what if" duels between real cricket
legends. Entirely client-side: no backend, no accounts, nothing stored.

**Rules:** last digit `0` = out · `1–6` = that many runs · `7/8/9` = 1 run.
A spell is 12 balls or 2 wickets, whichever comes first.

## Modes

- **Classic** — pure page-flip luck. Enter your lucky book's title and page count; two
  legends are drawn at random purely for flavour.
- **Stats** — pick a batsman and bowler from the curated roster. Ball outcomes are drawn
  from a distribution weighted by their real career numbers (inspect it via the
  "How the odds work" panel). An optional **era adjustment** raises wicket odds when the
  two careers never overlapped. *All stats-mode results are playful simulation, never
  prediction — the UI says so everywhere.*

## Commands

```bash
npm install
npm run dev      # dev server
npm test         # vitest unit tests (engine + commentary)
npm run build    # type-check + production build
npm run preview  # serve the production build
```

## Extending the roster

Add a player object to [src/roster.ts](src/roster.ts) — nothing in the simulation code
needs to change. Give bowlers a `bowling` block, batsmen a `batting` block (all-rounders
get both, and appear in both pickers). Stats are deliberately approximate, format-blended
numbers tuned for fun. Avatars are generated SVGs (initials + emoji + country colours);
swap in real photos later by replacing `avatarSvg` in [src/avatar.ts](src/avatar.ts).

## Tuning

- Spell length: `SPELL` in [src/engine.ts](src/engine.ts)
- Stats weighting: `computeProbabilities` in [src/engine.ts](src/engine.ts) — pure
  function, covered by tests, surfaced verbatim in the in-game odds panel
- Commentary pools: [src/commentary.ts](src/commentary.ts) (no phrase ever repeats on
  consecutive balls)
